import decodeIco from "decode-ico";
import fsSync from "fs";
import fs from "fs/promises";
import {IncomingMessage, ServerResponse} from "http";
import {join as joinPath} from "path";
import prettyBytes from "pretty-bytes";
import sharp from "sharp";
import {Readable as ReadableStream, Writable as WritableStream} from "stream";
import {filesBucketName} from "~/server/cloudflare/r2/files_bucket_name.js";
import {
    FileUploader,
    startUploadingAndProcessingFile,
    uploadFileTimeoutMs,
} from "~/server/files/data/files_table.js";
import {
    FileUploadServiceActionContext,
    FileUploadServiceSessionActionContext,
} from "~/server/files/upload/file_upload_service_context.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {withTemporaryDirectory} from "~/server/helpers/node/with_temporary_directory.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {
    CancelledError,
    DeadlineExceededError,
    ErrorBase,
    InternalError,
    InvalidArgumentError,
    PermissionDeniedError,
    UnknownError,
} from "~/shared/error/error.js";
import {getErrorCodes} from "~/shared/error/error_code.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessageSchema, ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {
    FileContentType,
    FileContentTypeSchema,
    FileDocumentContentType,
    FileImageContentType,
    FileWebSafeImageContentType,
    FileWebUnsafeImageContentType,
    getFileContentTypePreferredExtension,
    isFileContentType,
    normalizeContentType,
} from "~/shared/files/file_content_type.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {If} from "~/shared/helpers/types/if.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// Make sure we're using our custom `sharp` `libvips` build built from
// [`cyberworlds/sharp-libvips`][1] by checking that additional modules are
// available. We put this assertion here so production will loudly fail if
// we're using the wrong `sharp` module.
//
// [1]: https://github.com/cyberworlds/sharp-libvips
assert((sharp.versions as any).de265 === "1.0.15");
assert((sharp.versions as any).graphicsmagick === "1.3.45");
assert((sharp.versions as any).pdfium === "chromium/6679");

type UploadFileEvent = SchemaType<typeof UploadFileEventSchema>;

export const UploadFileEventSchema = Schema.union({
    Start: Schema.object({
        type: Schema.value("Start"),
        fileId: Schema.id<FileId>(),
        hasAlternative: Schema.boolean,
        hasPreview: Schema.boolean,
        hasPreviewImage: Schema.boolean,
    }),
    Finish: Schema.object({
        type: Schema.value("Finish"),
    }),
    Alternative: Schema.object({
        type: Schema.value("Alternative"),
        contentType: FileContentTypeSchema,
        contentLength: Schema.integer,
        isPreviewImage: Schema.boolean,
    }),
    PreviewSize: Schema.object({
        type: Schema.value("PreviewSize"),
        width: Schema.integer,
        height: Schema.integer,
        scale: Schema.integer.default(1),
    }),
    PreviewPlaceholder: Schema.object({
        type: Schema.value("PreviewPlaceholder"),
        placeholder: FilePreviewPlaceholder.schema,
    }),
    PreviewImage: Schema.object({
        type: Schema.value("PreviewImage"),
        contentType: FileContentTypeSchema,
        contentLength: Schema.integer,
    }),
    PreviewError: Schema.object({
        type: Schema.value("PreviewError"),
        error: Schema.object({
            code: Schema.enum(getErrorCodes()),
            displayMessage: ErrorDisplayMessageSchema,
        }),
    }),
    Error: Schema.object({
        type: Schema.value("Error"),
        error: ErrorSchema,
    }),
});

export async function uploadFile(
    context: FileUploadServiceActionContext,
    span: TracerSpan,
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
    options: {
        url: URL;
        spaceId: SpaceId;
        headers: Headers;
        temporaryDirectoryPath: string;
    },
): Promise<void> {
    const sendEvent = (event: UploadFileEvent) => {
        if (!res.headersSent) {
            res.writeHead(200, {"content-type": "application/x-ndjson"});
        }

        if (!res.writableEnded) {
            res.write(JSON.stringify(UploadFileEventSchema.serialize(event)) + "\n");
        }
    };

    try {
        const promise = actuallyUploadFile(context, span, req, sendEvent, options);

        // Make sure the server doesn't shutdown while we're uploading and processing a
        // file. Otherwise we may leave the database in a bad state if we don't finish
        // cleaning up after an error, for instance.
        context.process.waitUntil(
            promise.catch(() => {
                // Ignore any errors. Errors from this promise will be handled by our
                // catch below.
            }),
        );

        await promise;

        if (!res.writableEnded) {
            res.end();
        }
    } catch (error) {
        span.addException(error);

        // If we haven't sent headers yet, make sure we write the head with an error
        // status code. If we've already sent an event we're unfortunately stuck with
        // a 200 status code. Clients will still read the error event and interpret the
        // response appropriately.
        if (!res.headersSent) {
            const status = isSystemError(error) ? 500 : 400;
            res.writeHead(status, {"content-type": "application/x-ndjson"});
        }

        if (!res.writableEnded) {
            sendEvent({type: "Error", error});
            res.end();
        }
    }
}

/**
 * Maximum size for a file uploaded to our service: 1 GB. This is the same
 * maximum file size as Slack.
 */
const maxFileByteSize = 1e9;

async function actuallyUploadFile(
    originalContext: FileUploadServiceActionContext,
    span: TracerSpan,
    req: IncomingMessage,
    sendEvent: (event: UploadFileEvent) => void,
    {
        spaceId,
        headers,
        temporaryDirectoryPath,
    }: {
        url: URL;
        spaceId: SpaceId;
        headers: Headers;
        temporaryDirectoryPath: string;
    },
): Promise<void> {
    // Make sure we've been proxied through `EdgeService` when uploading a file. We
    // don't support uploading directly from other services like `JobQueueService`.
    if (originalContext.actor.serviceName !== "EdgeService")
        throw new PermissionDeniedError("Only `EdgeService` can upload a file");

    const context = originalContext.actor.authorizeSession();

    await authorizeSpaceAccess(context, spaceId);

    if (req.method !== "POST") throw new InvalidArgumentError('Must use "POST" method');

    const originalContentType = headers.get("content-type");
    if (originalContentType === null)
        throw new InvalidArgumentError('"Content-Type" header is required');

    const normalizedContentType = normalizeContentType(originalContentType);

    if (!isFileContentType(normalizedContentType)) {
        throw new InvalidArgumentError(
            quote`Unsupported "Content-Type" header ${originalContentType}`,
        );
    }

    const contentType = normalizedContentType;

    const contentLengthString = headers.get("content-length");
    if (contentLengthString === null) {
        throw new InvalidArgumentError('"Content-Length" header is required');
    }

    const contentLength = parseInt(contentLengthString, 10);
    if (isNaN(contentLength) || !/^\d+$/.test(contentLengthString)) {
        throw new InvalidArgumentError('"Content-Length" header must be an integer');
    }

    // If the client sends more bytes than what they declared in `Content-Length`
    // then Node.js will truncate the data to `Content-Length` bytes. This behavior
    // from Node.js is important to make sure attackers can't upload files bigger
    // than 1 GB. We have a test that exercises this behavior from Node.js.
    if (contentLength > maxFileByteSize) {
        throw new InvalidArgumentError(
            `"Content-Length" of ${prettyBytes(
                contentLength,
            )} is more than our maximum file size of ${prettyBytes(maxFileByteSize)}`,
        );
    }

    span.addData({file: {contentType, contentLength}});

    const fileProcessor = fileProcessorByContentType[contentType];

    const abortController = new AbortController();

    const abortTimeout = createTimeout(() => {
        if (!abortController.signal.aborted) {
            abortController.abort(new DeadlineExceededError("Upload file timeout exceeded"));
        }
    }, uploadFileTimeoutMs);

    // If the request receives the `close` event before the `end` event then abort
    // the file upload since the client didn't finish sending us data.
    const handleEnd = () => {
        req.off("end", handleEnd);
        req.off("close", handleClose);
    };
    const handleClose = () => {
        if (!abortController.signal.aborted) {
            abortController.abort(new CancelledError("Upload file request closed prematurely"));
        }
    };
    req.on("end", handleEnd);
    req.on("close", handleClose);

    try {
        const fileUploader = await startUploadingAndProcessingFile(context, {
            spaceId,
            contentType,
            contentLength,
            hasAlternative: !!fileProcessor.hasAlternative,
            hasPreview: fileProcessor.hasPreview,
            hasPreviewImage: fileProcessor.hasPreviewImage,
        });

        span.addPropagatedData({context: {fileId: fileUploader.fileId}});

        await uploadAndProcessFile(context, {
            spaceId,
            contentType,
            contentLength,
            fileProcessor,
            fileUploader,
            stream: req,
            sendEvent,
            signal: abortController.signal,
            temporaryDirectoryPath,
            createAbortCatcher: message => error => {
                if (!abortController.signal.aborted) {
                    abortController.abort(new CancelledError(message, {cause: error}));
                }
                throw error;
            },
        });
    } finally {
        abortTimeout.clear();
        req.off("end", handleEnd);
        req.off("close", handleClose);
    }
}

async function uploadAndProcessFile(
    context: FileUploadServiceSessionActionContext,
    {
        spaceId,
        contentType,
        contentLength,
        fileProcessor,
        fileUploader,
        stream,
        sendEvent,
        temporaryDirectoryPath,
        signal,
        createAbortCatcher,
    }: {
        spaceId: SpaceId;
        contentType: FileContentType;
        contentLength: number;
        fileProcessor: FileProcessor;
        fileUploader: FileUploader;
        stream: ReadableStream;
        sendEvent: (event: UploadFileEvent) => void;
        temporaryDirectoryPath: string;
        signal: AbortSignal;
        createAbortCatcher: (message: string) => (error: unknown) => never;
    },
) {
    sendEvent({
        type: "Start",
        fileId: fileUploader.fileId,
        hasAlternative: !!fileProcessor.hasAlternative,
        hasPreview: fileProcessor.hasPreview,
        hasPreviewImage: fileProcessor.hasPreviewImage,
    });

    // NOTE(calebmer, 2024-08-26): May be worth considering multipart uploads
    // someday if we want to support users on spotty internet connections or speed
    // up large file uploads (for files >100 MB). For now, the simplicity of doing
    // all processing in one shot within `FileUploadService` is nice.
    const uploadPromise = (async () => {
        // TODO(calebmer, #files): Consider transitioning objects to infrequent access
        // after 1-3 months?
        // https://developers.cloudflare.com/r2/buckets/object-lifecycles

        // NOTE: We don't `Promise.race()` `PutObject()` with
        // `waitForAbort(signal)` since we need to wait for the `PutObject()` to
        // finish in order for `fileUploader.cleanupAfterUnacceptableError()` to
        // successfully cleanup the object.
        //
        // `PutObject()` should respect `signal` so we can handle the case where the
        // request closes before it ends.
        await context.r2.PutObject(
            {
                Bucket: filesBucketName,
                Key: `${spaceId}/${fileUploader.fileId}`,
                ContentType: contentType,
                Body: stream,
            },
            {signal: signal},
        );

        if (signal.aborted) throw signal.reason;

        await fileUploader.finishUploading(context);
    })().catch(createAbortCatcher("File uploading failed"));

    const processPromise = fileProcessor.hasPreview
        ? context.tracer.withSpan("Process file", async (context, span) => {
              span.addData({file: {contentType, contentLength}});

              const {
                  previewSizePromise,
                  previewPlaceholderPromise,
                  previewImagePromise,
                  alternativePromise,
              } = fileProcessor.process(stream, signal, {
                  span,
                  fileId: fileUploader.fileId,
                  contentLength,
                  temporaryDirectoryPath,
              });

              let hasAcceptedPreviewError = false;

              const createPreviewAbortCatcher = (message: string) => {
                  const abortCatcher = createAbortCatcher(message);

                  return async (error: unknown) => {
                      if (hasAcceptedPreviewError) throw error;

                      if (!signal.aborted && error instanceof ErrorBase && error.displayMessage) {
                          const acceptError = fileProcessor.acceptError?.(
                              error,
                              error.displayMessage,
                          );

                          if (acceptError) {
                              hasAcceptedPreviewError = true;

                              await fileUploader.finishProcessingPreviewAfterAcceptableError(
                                  context,
                                  {
                                      code: error.code,
                                      displayMessage: error.displayMessage,
                                  },
                              );

                              sendEvent({
                                  type: "PreviewError",
                                  error: {
                                      code: error.code,
                                      displayMessage: error.displayMessage,
                                  },
                              });
                              throw error;
                          }
                      }

                      return abortCatcher(error);
                  };
              };

              const actualAlternativePromise = alternativePromise
                  ? (async () => {
                        const alternative = await alternativePromise;
                        if (signal.aborted) throw signal.reason;

                        let alternativeContentLength = 0;

                        alternative.stream.on("data", (chunk: Buffer) => {
                            alternativeContentLength += chunk.length;
                        });

                        // NOTE: We don't `Promise.race()` `PutObject()` with
                        // `waitForAbort(signal)` since we need to wait for the `PutObject()` to
                        // finish in order for `fileUploader.cleanupAfterUnacceptableError()` to
                        // successfully cleanup the object.
                        await context.r2.PutObject(
                            {
                                Bucket: filesBucketName,
                                Key: `${spaceId}/${fileUploader.fileId}-alternative`,
                                ContentType: alternative.contentType,
                                Body: alternative.stream,
                            },
                            {signal},
                        );

                        await fileUploader.finishProcessingAlternative(context, {
                            contentType: alternative.contentType,
                            contentLength: alternativeContentLength,
                        });

                        sendEvent({
                            type: "Alternative",
                            contentType: alternative.contentType,
                            contentLength: alternativeContentLength,
                            isPreviewImage: false,
                        });

                        return {
                            file: {
                                alternative: {
                                    contentType: alternative.contentType,
                                    contentLength: alternativeContentLength,
                                    contentLengthRatio: alternativeContentLength / contentLength,
                                },
                            },
                        };
                    })().catch(createAbortCatcher("File alternative processing failed"))
                  : null;

              const actualPreviewSizePromise = (async () => {
                  const {width, height, scale} = await previewSizePromise;
                  if (signal.aborted) throw signal.reason;
                  if (hasAcceptedPreviewError) return;

                  await fileUploader.finishProcessingPreviewSize(context, {width, height, scale});

                  sendEvent({
                      type: "PreviewSize",
                      width,
                      height,
                      scale,
                  });

                  return {
                      file: {
                          preview: {
                              width,
                              height,
                              scale,
                          },
                      },
                  };
              })().catch(createPreviewAbortCatcher("File preview size processing failed"));

              const actualPreviewPlaceholderPromise = (async () => {
                  const placeholder = await previewPlaceholderPromise;
                  if (signal.aborted) throw signal.reason;
                  if (hasAcceptedPreviewError) return;

                  await fileUploader.finishProcessingPreviewPlaceholder(context, placeholder);

                  sendEvent({
                      type: "PreviewPlaceholder",
                      placeholder,
                  });
              })().catch(createPreviewAbortCatcher("File preview placeholder processing failed"));

              const actualPreviewImagePromise = previewImagePromise
                  ? (async () => {
                        const previewImage = await previewImagePromise;
                        if (signal.aborted) throw signal.reason;
                        if (hasAcceptedPreviewError) return;

                        // NOTE: We don't `Promise.race()` `PutObject()` with
                        // `waitForAbort(signal)` since we need to wait for the `PutObject()` to
                        // finish in order for `fileUploader.cleanupAfterUnacceptableError()` to
                        // successfully cleanup the object.
                        await context.r2.PutObject(
                            {
                                Bucket: filesBucketName,
                                Key: `${spaceId}/${fileUploader.fileId}-preview`,
                                ContentType: previewImage.contentType,
                                Body: previewImage.data,
                            },
                            {signal},
                        );

                        if (signal.aborted) throw signal.reason;
                        if (hasAcceptedPreviewError) return;

                        await fileUploader.finishProcessingPreviewImage(context, {
                            contentType: previewImage.contentType,
                            contentLength: previewImage.data.length,
                            isAlternative: fileProcessor.hasAlternative === "PreviewImage",
                        });

                        sendEvent({
                            type: "PreviewImage",
                            contentType: previewImage.contentType,
                            contentLength: previewImage.data.length,
                        });

                        if (fileProcessor.hasAlternative === "PreviewImage") {
                            sendEvent({
                                type: "Alternative",
                                contentType: previewImage.contentType,
                                contentLength: previewImage.data.length,
                                isPreviewImage: true,
                            });
                        }

                        return {
                            file: {
                                preview: {
                                    contentType: previewImage.contentType,
                                    contentLength: previewImage.data.length,
                                    contentLengthRatio: previewImage.data.length / contentLength,
                                },
                                alternative:
                                    fileProcessor.hasAlternative === "PreviewImage"
                                        ? {
                                              contentType: previewImage.contentType,
                                              contentLength: previewImage.data.length,
                                              contentLengthRatio:
                                                  previewImage.data.length / contentLength,
                                          }
                                        : undefined,
                            },
                        };
                    })().catch(createPreviewAbortCatcher("File preview image processing failed"))
                  : null;

              // Specific file processors often have dependencies on one another, e.g.
              // "Process file preview size" depends on "Process file alternative" for Microsoft Word
              // documents. However, we intentionally measure spans from the start of file processing
              // so that when we look at the duration we get the user duration perceived by the user
              // (since as each of these resolves we `sendEvent()` to the user).
              await runAllPromises([
                  actualAlternativePromise
                      ? span.withSpan("Process file alternative", async span => {
                            span.addData({file: {contentType, contentLength}});
                            const spanData = await actualAlternativePromise;
                            span.addData(spanData);
                        })
                      : null,
                  span.withSpan("Process file preview size", async span => {
                      span.addData({file: {contentType, contentLength}});
                      const spanData = await actualPreviewSizePromise;
                      if (spanData) span.addData(spanData);
                  }),
                  span.withSpan("Process file preview placeholder", span => {
                      span.addData({file: {contentType, contentLength}});
                      return actualPreviewPlaceholderPromise;
                  }),
                  actualPreviewImagePromise
                      ? span.withSpan("Process file preview image", async span => {
                            span.addData({file: {contentType, contentLength}});
                            const spanData = await actualPreviewImagePromise;
                            if (spanData) span.addData(spanData);
                        })
                      : null,
              ]).catch(error => {
                  // If we caught the processing error, then don't fail our entire upload job. We
                  // finished processing but stored an error in the database.
                  if (hasAcceptedPreviewError) return;

                  throw error;
              });
          })
        : null;

    await runAllPromises([uploadPromise, processPromise]).catch(async error => {
        await fileUploader.cleanupAfterUnacceptableError(context);
        throw error;
    });

    sendEvent({type: "Finish"});
}

/**
 * Resolves once the provided `stream` has ended with a `Buffer` representing
 * all data from the stream. If aborted while waiting on the stream the promise
 * will reject with the `AbortSignal`'s reason.
 */
function waitForReadableStreamData(stream: ReadableStream, signal: AbortSignal): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason);
            return;
        }

        let chunks: Array<Buffer> = [];

        if (stream.readableEnded) {
            resolve(Buffer.concat(chunks));
            return;
        }

        const handleData = (data: Buffer) => {
            chunks.push(data);
        };

        const handleEnd = () => {
            const data = Buffer.concat(chunks);

            chunks = [];
            stream.off("data", handleData);
            stream.off("end", handleEnd);
            signal.removeEventListener("abort", handleAbort);

            resolve(data);
        };

        const handleAbort = () => {
            chunks = [];
            stream.off("data", handleData);
            stream.off("end", handleEnd);
            signal.removeEventListener("abort", handleAbort);

            reject(signal.reason);
        };

        stream.on("data", handleData);
        stream.on("end", handleEnd);
        signal.addEventListener("abort", handleAbort);
    });
}

/**
 * Resolves once the provided `stream` has ended. Does not keep track of data
 * from the stream. If aborted while waiting on the stream the promise will
 * reject with the `AbortSignal`'s reason.
 */
function waitForWritableStreamClose(stream: WritableStream, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason);
            return;
        }

        if (stream.closed) {
            resolve();
            return;
        }

        const handleClose = () => {
            stream.off("close", handleClose);
            signal.removeEventListener("abort", handleAbort);

            resolve();
        };

        const handleAbort = () => {
            stream.off("close", handleClose);
            signal.removeEventListener("abort", handleAbort);

            reject(signal.reason);
        };

        stream.on("close", handleClose);
        signal.addEventListener("abort", handleAbort);
    });
}

const sharpTimeoutSeconds = 20;

/**
 * File processor object.
 *
 * Currently file processing only generates the file's preview. Basically all
 * files have a preview (except audio files or opaque binary data). Any file
 * that's not a web safe image will generate a preview image. If the file has
 * a preview `hasPreview` will be true and if the file generates a preview
 * image then `hasPreviewImage` will be true.
 *
 * The `process` function actually performs the file processing. It takes
 * `stream` which provides file data. You must synchronously start listening to
 * the `stream` or you may miss data! You may use `waitForReadableStreamData()`
 * to wait until we've received all data from the readable stream.
 *
 * Make sure to cancel your stream processing if the upload is aborted (see
 * `signal`). Since `stream` may not end after an abort! e.g. When the
 * connection times out.
 *
 * ## Sharp and stream processing
 *
 * Unfortunately, `sharp` (which we use for processing many of our files) does
 * not support efficient stream processing despite having a stream API. `sharp`
 * in stream mode [waits for the stream to finish][1] instead of pushing data
 * to `libvips` as it becomes available. So it makes no difference whether we
 * use `const sharpInstance = sharp(); stream.pipe(sharpInstance)` or
 * `sharp(await dataPromise)`. If anything `sharp(await dataPromise)` is more
 * efficient since we only need to call `Buffer.concat()` to create the final
 * file data once.
 *
 * Ideally `sharp` would take advantage of streaming when processing metadata
 * since all it needs is the file header in most cases (though it's unclear if
 * `libvips` itself can handle file streaming). We'll upgrade our
 * implementation to use streaming if `sharp`'s implementation changes.
 *
 * [1]: https://github.com/lovell/sharp/blob/fc32e0bd3f9111b80cf078df7b0cfc355695674e/lib/input.js#L489-L500
 */
type FileProcessor =
    | NoopFileProcessor
    | FileProcessorTemplate<false, false>
    | FileProcessorTemplate<true, false>
    | FileProcessorTemplate<true, true>
    | FileProcessorTemplate<true, "PreviewImage">;

interface NoopFileProcessor {
    readonly hasPreview: false;
    readonly hasPreviewImage: false;
    readonly hasAlternative: false;
}

interface FileProcessorTemplate<
    HasPreviewImage extends boolean,
    HasAlternative extends boolean | "PreviewImage",
> {
    readonly hasPreview: true;
    readonly hasPreviewImage: HasPreviewImage;
    readonly hasAlternative: HasAlternative;

    process(
        stream: ReadableStream,
        abortSignal: AbortSignal,
        options: {
            span: TracerSpan;
            fileId: FileId;
            contentLength: number;
            temporaryDirectoryPath: string;
        },
    ): MergeObjectIntersection<
        {
            previewSizePromise: Promise<{width: number; height: number; scale: number}>;
            previewPlaceholderPromise: Promise<FilePreviewPlaceholder>;
        } & If<
            HasPreviewImage,
            {previewImagePromise: Promise<{contentType: FileContentType; data: Buffer}>},
            {previewImagePromise?: undefined}
        > &
            (HasAlternative extends "PreviewImage"
                ? {
                      previewImagePromise: Promise<{contentType: FileContentType; data: Buffer}>;
                      alternativePromise?: undefined;
                  }
                : If<
                      HasAlternative & boolean,
                      {
                          alternativePromise: Promise<{
                              contentType: FileContentType;
                              stream: ReadableStream;
                          }>;
                      },
                      {alternativePromise?: undefined}
                  >)
    >;

    /**
     * If `acceptError` is implemented and you return true for an error we won't
     * cancel the file upload when processing throws but instead save the provided
     * error's `displayMessage` in the database. Then when the user tries to
     * view the preview we'll show them the error message. So the upload will be
     * successful but the user won't be able to preview the file. `acceptError`
     * will only be called for errors with a `displayMessage`.
     */
    acceptError?(error: ErrorBase, displayMessage: ErrorDisplayMessage): boolean | undefined;
}

const noopFileProcessor: FileProcessor = {
    hasPreview: false,
    hasPreviewImage: false,
    hasAlternative: false,
};

const createFileProcessorByContentType: {
    [Key in FileContentType]: (contentType: Key) => FileProcessor;
} = {
    "application/octet-stream": () => noopFileProcessor,
    "image/apng": createWebSafeImageFileProcessor,
    "image/avif": createWebSafeImageFileProcessor,
    "image/gif": createWebSafeImageFileProcessor,
    "image/jpeg": createWebSafeImageFileProcessor,
    "image/png": createWebSafeImageFileProcessor,
    "image/svg+xml": createWebSafeImageFileProcessor,
    "image/webp": createWebSafeImageFileProcessor,
    "image/bmp": createWebUnsafeImageFileProcessor,
    "image/ico": createIcoImageFileProcessor,
    "image/tiff": createWebUnsafeImageFileProcessor,
    "image/heif": createWebUnsafeImageFileProcessor,
    "image/heic": createWebUnsafeImageFileProcessor,
    "application/pdf": createPdfDocumentFileProcessor,
    "application/msword": createDocumentFileProcessor,
    "application/vnd.ms-excel": createDocumentFileProcessor,
    "application/vnd.ms-powerpoint": createDocumentFileProcessor,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        createDocumentFileProcessor,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        createDocumentFileProcessor,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        createDocumentFileProcessor,
};

const fileProcessorByContentType: {
    [Key in FileContentType]: FileProcessor;
} = mapObjectValues(createFileProcessorByContentType, (createFileProcessor, contentType) =>
    (createFileProcessor as any)(contentType),
);

async function processFilePreviewPlaceholder(
    input: Buffer | ArrayBuffer | Uint8Array,
    options?: sharp.SharpOptions,
): Promise<FilePreviewPlaceholder> {
    // A placeholder of size 5 generates 25 pixels and is encoded to <700 bytes.
    const placeholderSize = 5;

    const {
        data: outputData,
        info: {channels, width},
    } = await sharp(input, {...options, pages: 1})
        .timeout({seconds: sharpTimeoutSeconds})
        .resize(placeholderSize, placeholderSize, {fit: "inside"})
        .toFormat("png")
        .modulate({brightness: 1, saturation: 1.2})
        .raw()
        .toBuffer({resolveWithObject: true})
        .catch(rethrowClassifiedSharpError);

    assert(channels === 3 || channels === 4);

    return FilePreviewPlaceholder.fromSerialized([channels === 4, width, outputData]);
}

function processImageFile(
    contentType: Exclude<FileImageContentType, "image/ico">,
    dataPromise: Promise<Buffer>,
) {
    const previewSizePromise = (async () => {
        const data = await dataPromise;

        const metadata = await sharp(data, {pages: 1})
            .timeout({seconds: sharpTimeoutSeconds})
            .metadata()
            .catch(rethrowClassifiedSharpError);

        let expectedFormat: keyof sharp.FormatEnum;
        let expectedCompression: sharp.Metadata["compression"];
        let expectedFormatMagick: sharp.Metadata["formatMagick"];

        switch (contentType) {
            case "image/apng":
                expectedFormat = "png";
                break;
            case "image/avif":
                // See: https://github.com/lovell/sharp/issues/2504
                expectedFormat = "heif";
                expectedCompression = "av1";
                break;
            case "image/gif":
                expectedFormat = "gif";
                break;
            case "image/jpeg":
                expectedFormat = "jpeg";
                break;
            case "image/png":
                expectedFormat = "png";
                break;
            case "image/svg+xml":
                expectedFormat = "svg";
                break;
            case "image/webp":
                expectedFormat = "webp";
                break;
            case "image/bmp":
                expectedFormat = "magick";
                expectedFormatMagick = "BMP";
                break;
            case "image/tiff":
                expectedFormat = "tiff";
                break;
            case "image/heif":
                expectedFormat = "heif";
                expectedCompression = "hevc";
                break;
            case "image/heic":
                expectedFormat = "heif";
                expectedCompression = "hevc";
                break;
            default:
                throw exhaustive(contentType);
        }

        if (metadata.format !== expectedFormat) {
            throw new InvalidArgumentError(
                quote`Expected file in ${expectedFormat} format but received file in ${metadata.format} format`,
            );
        }

        if (metadata.compression !== expectedCompression) {
            throw new InvalidArgumentError(
                quote`Expected file in ${expectedFormat} format to use ${expectedCompression} compression but received file with ${metadata.compression} compression`,
            );
        }

        if (metadata.formatMagick !== expectedFormatMagick) {
            throw new InvalidArgumentError(
                quote`Expected file in ${expectedFormat} format to use ${expectedFormatMagick} magick format but received file with ${metadata.formatMagick} magick format`,
            );
        }

        if (metadata.width === undefined || metadata.height === undefined) {
            throw new InternalError('Couldn\'t find "width" or "height" of image file');
        }

        return {
            width: metadata.width,
            height: metadata.height,
            scale: 1,
        };
    })();

    // Generate a placeholder image which we'll render before the browser has
    // downloaded the full image. The code below is derived from the
    // [`plaiceholder`][1] project. We don't use `plaiceholder` directly since it's
    // fundamentally pretty simple and the implementation is inefficient. (It
    // unconditionally generates a color and `base64` placeholder.)
    //
    // [1]: https://github.com/joe-bell/plaiceholder/blob/36d4518301c6512957c63977133f6224f491c7f2/packages/plaiceholder/src/index.ts#L219-L334
    const previewPlaceholderPromise = (async () => {
        const inputData = await dataPromise;
        return processFilePreviewPlaceholder(inputData);
    })();

    return {previewSizePromise, previewPlaceholderPromise};
}

function createWebSafeImageFileProcessor(contentType: FileWebSafeImageContentType): FileProcessor {
    return {
        hasPreview: true,
        hasPreviewImage: false,
        hasAlternative: false,
        process: (stream, signal) => {
            // Unfortunately, `sharp` doesn't support efficient stream processing so it's
            // more efficient to await `dataPromise` than to use `stream`. See our comment
            // on `FileProcessor`.
            const dataPromise = waitForReadableStreamData(stream, signal);

            return processImageFile(contentType, dataPromise);
        },
    };
}

function createWebUnsafeImageFileProcessor(
    contentType: Exclude<FileWebUnsafeImageContentType, "image/ico">,
): FileProcessor {
    return {
        hasPreview: true,
        hasPreviewImage: true,
        hasAlternative: "PreviewImage",
        process: (stream, signal) => {
            const dataPromise = waitForReadableStreamData(stream, signal);
            const {previewSizePromise, previewPlaceholderPromise} = processImageFile(
                contentType,
                dataPromise,
            );

            const previewImagePromise = (async (): Promise<{
                contentType: FileContentType;
                data: Buffer;
            }> => {
                // Unfortunately, `sharp` doesn't support efficient stream processing so it's
                // more efficient to await `dataPromise` than to use `stream`. See our comment
                // on `FileProcessor`.
                const inputData = await dataPromise;

                const outputData = await sharp(inputData, {pages: 1})
                    .timeout({seconds: sharpTimeoutSeconds})
                    // AVIF is our preferred format for generating preview images ([source][1],
                    // [source][2]). AVIF has full browser support, provides better compression
                    // than JPEG and WebP, and has alpha channel support (unlike JPEG).
                    //
                    // Ideally we'd produce an image with lossless compression here since this file
                    // will be used as an alternative for the file in our image viewer. However,
                    // producing an image with lossless compression from an image with some
                    // compression (e.g. an `.heic` image) creates a much bigger file. So instead
                    // we opt for some compression but set our quality level really high (93). We
                    // don't want to produce a file too much larger than our input file and we also
                    // want to maintain as much detail as possible.
                    //
                    // Quality level of 93 was picked so that an `.heic` photo taken from my
                    // (@calebmer's) iPhone exported at high quality is about the same file size as
                    // the generated preview image.
                    //
                    // If we decide to switch this to lossless images we should use WebP instead
                    // since [AVIF is worse at lossless compression][3].
                    //
                    // [1]: https://medium.com/@julienetienne/why-you-should-use-avif-over-jpeg-webp-png-and-gif-in-2024-5603ac9d8781
                    // [2]: https://jakearchibald.com/2020/avif-has-landed
                    // [3]: https://github.com/AOMediaCodec/av1-avif/issues/111#issuecomment-717710961
                    .toFormat("avif", {quality: 93})
                    .toBuffer()
                    .catch(rethrowClassifiedSharpError);

                return {contentType: "image/avif", data: outputData};
            })();

            return {previewSizePromise, previewPlaceholderPromise, previewImagePromise};
        },
    };
}

/**
 * Special handling for `image/ico` files that selects the largest image from the
 * `.ico` container format and creates a preview from that. `.ico` files are a
 * container format that include images in either `png` or `bmp` format.
 */
function createIcoImageFileProcessor(): FileProcessor {
    return {
        hasPreview: true,
        hasPreviewImage: true,
        hasAlternative: "PreviewImage",
        process: (stream, signal) => {
            const dataPromise = waitForReadableStreamData(stream, signal);

            const promise = (async () => {
                const data = await dataPromise;

                const bestImage = decodeIco(data).sort(
                    (image1, image2) => image2.width * image2.height - image1.width * image1.height,
                )[0];
                if (!bestImage) {
                    throw new InvalidArgumentError('No images in ".ico" file');
                }

                const bestImageData = Buffer.from(bestImage.data);

                const previewSizePromise = Promise.resolve({
                    width: bestImage.width,
                    height: bestImage.height,
                    scale: 1,
                });

                let previewPlaceholderPromise: Promise<FilePreviewPlaceholder>;
                let previewImagePromise: Promise<{contentType: FileContentType; data: Buffer}>;
                switch (bestImage.type) {
                    case "png": {
                        previewPlaceholderPromise = processFilePreviewPlaceholder(bestImageData);

                        previewImagePromise = Promise.resolve({
                            contentType: "image/png",
                            data: bestImageData,
                        });
                        break;
                    }
                    case "bmp": {
                        previewPlaceholderPromise = processFilePreviewPlaceholder(bestImageData, {
                            raw: {
                                width: bestImage.width,
                                height: bestImage.height,
                                channels: 4,
                            },
                        });

                        previewImagePromise = (async () => {
                            const data = await sharp(bestImage.data, {
                                raw: {
                                    width: bestImage.width,
                                    height: bestImage.height,
                                    channels: 4,
                                },
                            })
                                .timeout({seconds: sharpTimeoutSeconds})
                                .toFormat("png")
                                .toBuffer()
                                .catch(rethrowClassifiedSharpError);

                            return {contentType: "image/png", data};
                        })();
                        break;
                    }
                    default:
                        throw exhaustive(bestImage);
                }

                return {previewSizePromise, previewPlaceholderPromise, previewImagePromise};
            })();

            return {
                previewSizePromise: promise.then(({previewSizePromise}) => previewSizePromise),
                previewPlaceholderPromise: promise.then(
                    ({previewPlaceholderPromise}) => previewPlaceholderPromise,
                ),
                previewImagePromise: promise.then(({previewImagePromise}) => previewImagePromise),
            };
        },
    };
}

/**
 * Create a file processor for PDF files. We process PDF files with `sharp`. We
 * use a [custom `sharp` build][1] that includes [PDFium from Chrome][2] to
 * render PDFs. Only the first page of the PDF is rendered.
 *
 * [1]: https://github.com/cyberworlds/sharp-libvips
 * [2]: https://pdfium.googlesource.com/pdfium
 */
function createPdfDocumentFileProcessor(): FileProcessor {
    return {
        hasPreview: true,
        hasPreviewImage: true,
        hasAlternative: false,

        // If the PDF is password protected then it's ok to finish the upload. We won't
        // be able to render the PDF but the user should still be able to download it
        // and view the PDF on their local machine.
        acceptError: error => error.displayMessage === pdfPasswordRequiredErrorDisplayMessage,

        process: (stream, signal) => processPdfDocumentFile(stream, signal),
    };
}

function processPdfDocumentFile(
    stream: ReadableStream,
    signal: AbortSignal,
    {extractPreview}: {extractPreview?: sharp.Region} = {},
): ReturnType<FileProcessorTemplate<true, false>["process"]> {
    // Unfortunately, `sharp` doesn't support efficient stream processing so it's
    // more efficient to await `dataPromise` than to use `stream`. See our comment
    // on `FileProcessor`.
    const dataPromise = waitForReadableStreamData(stream, signal);

    const previewSizeWithoutExtractPromise = (async () => {
        const data = await dataPromise;

        const metadata = await sharp(data, {pages: 1})
            .timeout({seconds: sharpTimeoutSeconds})
            .metadata()
            .catch(rethrowClassifiedSharpError);

        const expectedFormat = "pdf";
        if (metadata.format !== expectedFormat) {
            throw new InvalidArgumentError(
                quote`Expected file in ${expectedFormat} format but received file in ${metadata.format} format`,
            );
        }

        if (metadata.width === undefined || metadata.height === undefined) {
            throw new InternalError('Couldn\'t find "width" or "height" of image file');
        }

        // We produce a JPEG preview image that's 2x bigger than the source PDF. This
        // is so when viewing the preview image on a retina display with a scale factor
        // of 2 it looks the same as if we directly rendered the document. Zooming in
        // on the preview image won't look good since fundamentally we're taking a
        // vector format (PDF) and converting it to a raster format (JPEG).
        const scale = 2;

        return {
            width: metadata.width * scale,
            height: metadata.height * scale,
            scale,
        };
    })();

    const previewImagePromise = (async (): Promise<{
        contentType: FileContentType;
        data: Buffer;
    }> => {
        const [{width, height, scale}, inputData] = await runAllPromises([
            previewSizeWithoutExtractPromise,
            dataPromise,
        ]);

        let sharpInstance = sharp(inputData, {pages: 1})
            .timeout({seconds: sharpTimeoutSeconds})
            // AVIF is our preferred format for generating preview images ([source][1],
            // [source][2]). AVIF has full browser support, provides better compression
            // than JPEG and WebP, and has alpha channel support (unlike JPEG).
            //
            // Quality 80 since:
            //
            // - The preview's dimensions are already 2x the original file's
            // - We only use this when previewing the file, when viewing the file we use a
            //   full PDF renderer
            //
            // We want some compression since the extra storage cost of the preview file is
            // bourne by us.
            //
            // If we need lossless images we should use WebP instead since [AVIF is worse
            // at lossless compression][3].
            //
            // [1]: https://medium.com/@julienetienne/why-you-should-use-avif-over-jpeg-webp-png-and-gif-in-2024-5603ac9d8781
            // [2]: https://jakearchibald.com/2020/avif-has-landed
            // [3]: https://github.com/AOMediaCodec/av1-avif/issues/111#issuecomment-717710961
            .toFormat("avif", {quality: 80})
            .resize(width, height);

        if (extractPreview) {
            const extractLeft = clamp(0, extractPreview.left * scale, width);
            const extractTop = clamp(0, extractPreview.top * scale, height);

            sharpInstance = sharpInstance.extract({
                left: extractLeft,
                width: clamp(0, extractPreview.width * scale, width - extractLeft),
                top: extractTop,
                height: clamp(0, extractPreview.height * scale, height - extractTop),
            });
        }

        const outputData = await sharpInstance.toBuffer().catch(rethrowClassifiedSharpError);

        return {contentType: "image/avif", data: outputData};
    })();

    const previewPlaceholderPromise = (async () => {
        if (extractPreview) {
            const {data} = await previewImagePromise;
            return processFilePreviewPlaceholder(data);
        } else {
            const data = await dataPromise;
            return processFilePreviewPlaceholder(data);
        }
    })();

    return {
        previewSizePromise: extractPreview
            ? previewSizeWithoutExtractPromise.then(({width, height, scale}) => ({
                  width: clamp(0, width, extractPreview.width * scale),
                  height: clamp(0, height, extractPreview.height * scale),
                  scale,
              }))
            : previewSizeWithoutExtractPromise,
        previewPlaceholderPromise,
        previewImagePromise,
    };
}

/**
 * Lookup system installed [LibreOffice][1] executable path using common
 * installation locations. If you add a path here you should also update
 * `dev test` which also needs to check if LibreOffice is installed.
 *
 * [1]: https://www.libreoffice.org
 */
const libreofficeExecutablePath = new Lazy(async () => {
    let paths: Array<string>;

    // Derived from:
    // https://github.com/elwerene/libreoffice-convert/blob/c47f41de41910fcec077dabaae6f8ed7925605b5/index.js#L20-L34
    switch (process.platform) {
        case "darwin": {
            paths = ["/Applications/LibreOffice.app/Contents/MacOS/soffice"];
            break;
        }
        case "linux": {
            paths = [
                "/usr/bin/libreoffice",
                "/usr/bin/soffice",
                "/snap/bin/libreoffice",
                "/opt/libreoffice/program/soffice",
            ];
            break;
        }
        default: {
            throw new InternalError(
                quote`Haven't implemented finding LibreOffice executable on platform ${process.platform}`,
            );
        }
    }

    const errors: Array<unknown> = [];

    for (const path of paths) {
        try {
            await fs.access(path, fs.constants.X_OK);
            return path;
        } catch (error) {
            errors.push(error);
        }
    }

    throw new InternalError(
        "Couldn't find LibreOffice executable. For features that require LibreOffice to " +
            "work (e.g. converting Microsoft Word documents to PDF) you need to install " +
            "LibreOffice on the machine running `FileUploadService`: " +
            "https://www.libreoffice.org/download/download-libreoffice",
        {cause: errors},
    );
});

function createDocumentFileProcessor(
    contentType: Exclude<FileDocumentContentType, "application/pdf">,
): FileProcessor {
    return {
        hasPreview: true,
        hasPreviewImage: true,
        hasAlternative: true,
        process: (
            inputStream,
            signal,
            {span, fileId, contentLength, temporaryDirectoryPath: temporaryDirectoryParentPath},
        ) => {
            const alternativePromiseResolver = createPromiseResolver<{
                contentType: FileContentType;
                stream: ReadableStream;
            }>();

            const previewSizePromiseResolver = createPromiseResolver<{
                width: number;
                height: number;
                scale: number;
            }>();

            const previewPlaceholderPromiseResolver =
                createPromiseResolver<FilePreviewPlaceholder>();

            let pendingChunks: Array<Buffer> = [];
            const handleDataWhilePending = (chunk: Buffer) => pendingChunks.push(chunk);
            inputStream.on("data", handleDataWhilePending);

            const previewImagePromise: Promise<{contentType: FileContentType; data: Buffer}> =
                withTemporaryDirectory(
                    temporaryDirectoryParentPath,
                    `${fileId}_`,
                    async temporaryDirectoryPath => {
                        const userInstallationPath = joinPath(temporaryDirectoryPath, "user");

                        const inputPath = joinPath(
                            temporaryDirectoryPath,
                            `file.${getFileContentTypePreferredExtension(contentType)}`,
                        );
                        const inputWriteStream = fsSync.createWriteStream(inputPath);

                        // See the LibreOffice documentation for more information on filters:
                        // https://help.libreoffice.org/latest/en-US/text/shared/guide/convertfilters.html
                        let outputFilter: string;
                        let shouldCropPreviewImage: boolean;
                        switch (contentType) {
                            case "application/msword":
                            case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                                outputFilter = "writer_pdf_Export";
                                shouldCropPreviewImage = false;
                                break;
                            case "application/vnd.ms-excel":
                            case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                                // Output the Excel sheet onto a single page. See:
                                // https://ask.libreoffice.org/t/libreoffice-xls-to-pdf-conversion-breaks-single-page-content-into-multiple-pages-on-ubuntu-18-04/49104/2
                                outputFilter =
                                    'calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"true"}}';

                                // Spreadsheets are an infinite canvas and aren't typically restricted by any
                                // page size. So we want to crop our preview image to the top-left corner of
                                // the sheet. Otherwise the preview image could be so large as to not be
                                // particularly useful.
                                shouldCropPreviewImage = true;
                                break;
                            case "application/vnd.ms-powerpoint":
                            case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
                                outputFilter = "impress_pdf_Export";
                                shouldCropPreviewImage = false;
                                break;
                            default:
                                throw exhaustive(contentType);
                        }

                        try {
                            await span.withSpan("LibreOffice convert to PDF", async span => {
                                span.addData({
                                    file: {contentType, contentLength},
                                    libreoffice: {outputFilter},
                                });

                                // Write any chunks we received while waiting to create our temporary
                                // directory. Then continue piping
                                {
                                    const chunks = pendingChunks;
                                    pendingChunks = [];
                                    inputStream.off("data", handleDataWhilePending);
                                    for (const chunk of chunks) {
                                        inputWriteStream.write(chunk);
                                    }
                                }

                                inputStream.pipe(inputWriteStream);

                                // Wait for us to finish writing to our file. Also listen to the abort
                                // signal. If we abort before finishing the stream we shouldn't continue.
                                await waitForWritableStreamClose(inputWriteStream, signal);

                                const executablePath = await libreofficeExecutablePath.get();

                                const startTime = span.clock.now();

                                // Pass all the same flags as `unoserver` and `libreoffice-convert`:
                                //
                                // - https://github.com/unoconv/unoserver/blob/dc4c0168d2bfa7b055fd0937071dcab5952da22e/src/unoserver/server.py#L73-L79
                                // - https://github.com/elwerene/libreoffice-convert/blob/c47f41de41910fcec077dabaae6f8ed7925605b5/index.js#L53-L59
                                await runProcess(
                                    executablePath,
                                    [
                                        "--headless",
                                        "--invisible",
                                        "--nocrashreport",
                                        "--nodefault",
                                        "--nologo",
                                        "--nofirststartwizard",
                                        "--norestore",
                                        `-env:UserInstallation=file://${userInstallationPath}`,
                                        ["--convert-to", `pdf:${outputFilter}`],
                                        ["--outdir", temporaryDirectoryPath],
                                        inputPath,
                                    ],
                                    {
                                        cwd: runfilesPath,
                                        signal,
                                    },
                                );

                                const processDurationMs = span.clock.now() - startTime;

                                // Record just the process duration since waiting on the input stream depends
                                // on client network performance.
                                span.addData({common: {processDurationMs}});
                            });
                        } finally {
                            inputWriteStream.destroy();
                        }

                        const outputReadStream = fsSync.createReadStream(
                            joinPath(temporaryDirectoryPath, "file.pdf"),
                        );

                        alternativePromiseResolver.resolve({
                            contentType: "application/pdf",
                            stream: outputReadStream,
                        });

                        const {previewSizePromise, previewPlaceholderPromise, previewImagePromise} =
                            processPdfDocumentFile(outputReadStream, signal, {
                                extractPreview: shouldCropPreviewImage
                                    ? // Extract to the size of a default 4:3 Microsoft PowerPoint slide.
                                      {left: 0, top: 0, width: 720, height: 540}
                                    : undefined,
                            });

                        previewSizePromise.then(
                            previewSizePromiseResolver.resolve,
                            previewSizePromiseResolver.reject,
                        );

                        previewPlaceholderPromise.then(
                            previewPlaceholderPromiseResolver.resolve,
                            previewPlaceholderPromiseResolver.reject,
                        );

                        const [image] = await runAllPromises([
                            previewImagePromise,
                            // Wait for these promises before returning even though we don't use their data
                            // so we only cleanup our temporary directory after all promises have been
                            // resolved.
                            previewSizePromise,
                            previewPlaceholderPromise,
                        ]);

                        return image;
                    },
                ).catch(error => {
                    alternativePromiseResolver.reject(error);
                    previewSizePromiseResolver.reject(error);
                    previewPlaceholderPromiseResolver.reject(error);
                    throw error;
                });

            return {
                alternativePromise: alternativePromiseResolver.promise,
                previewSizePromise: previewSizePromiseResolver.promise,
                previewPlaceholderPromise: previewPlaceholderPromiseResolver.promise,
                previewImagePromise,
            };
        },
    };
}

function rethrowClassifiedSharpError(error: unknown): never {
    throw classifySharpError(error);
}

const pdfPasswordRequiredErrorDisplayMessage = errorDisplayMessage`A password is required to read this file. Try opening the file in a PDF reader that supports password protected files.`;

function classifySharpError(error: unknown): ErrorBase {
    if (!isObject(error) || typeof error.message !== "string") {
        return classifySharpError({message: String(error)});
    }

    // If our timeout was exceeded while processing the file. See:
    // https://sharp.pixelplumbing.com/api-output#timeout
    if (error.message.includes("timeout")) {
        return new DeadlineExceededError(formatSharpErrorMessage(error.message));
    }

    // Kinda hacky, but treat any error from `sharp` that refers to an "input" or
    // an "image" as a user error not a system error.
    //
    // e.g. This error:
    // https://github.com/lovell/sharp/blob/fc32e0bd3f9111b80cf078df7b0cfc355695674e/src/common.cc#L413
    if (/(input|image)/i.test(error.message)) {
        if (error.message.includes("pdf") && error.message.includes("password required")) {
            return new PermissionDeniedError(formatSharpErrorMessage(error.message), {
                displayMessage: pdfPasswordRequiredErrorDisplayMessage,
            });
        } else {
            return new InvalidArgumentError(formatSharpErrorMessage(error.message));
        }
    }

    // Unclassified `sharp` error. We've observed that errors from `sharp` often
    // don't use the JavaScript error subclass! So make sure to create an error
    // object.
    return new UnknownError(formatSharpErrorMessage(error.message));
}

function formatSharpErrorMessage(message: string): string {
    return (
        message
            // Security through obscurity: Don't disclose that we use GraphicsMagick in
            // error messages so attackers don't know to try GraphicsMagick exploits. We
            // use GraphicsMagick instead of ImageMagick which has fewer CVEs but since
            // the attack surface is still broad we think it's worth not clearly disclosing
            // the library we use. Replace "magick" with "x".
            .replaceAll(/magick/gi, substring =>
                substring[0]! === substring[0]!.toLowerCase() ? "x" : "X",
            )
    );
}
