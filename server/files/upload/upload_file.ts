import {IncomingMessage, ServerResponse} from "http";
import prettyBytes from "pretty-bytes";
import sharp from "sharp";
import {Readable as ReadableStream} from "stream";
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
import {createFileIcoImageProcessor} from "~/server/files/upload/processors/file_ico_image_processor.js";
import {createFileMicrosoftOfficeDocumentProcessor} from "~/server/files/upload/processors/file_microsoft_office_document_file_processor.js";
import {createFilePdfDocumentProcessor} from "~/server/files/upload/processors/file_pdf_document_processor.js";
import {FileProcessor, fileNoopProcessor} from "~/server/files/upload/processors/file_processor.js";
import {createFileWebSafeImageProcessor} from "~/server/files/upload/processors/file_web_safe_image_processor.js";
import {createFileWebUnsafeImageProcessor} from "~/server/files/upload/processors/file_web_unsafe_image_processor.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {
    CancelledError,
    DeadlineExceededError,
    ErrorBase,
    InvalidArgumentError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {getErrorCodes} from "~/shared/error/error_code.js";
import {ErrorDisplayMessageSchema, ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {
    FileContentType,
    FileContentTypeSchema,
    isFileContentType,
    normalizeContentType,
} from "~/shared/files/file_content_type.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {quote} from "~/shared/helpers/string/quote.js";
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

    const fileProcessor = fileProcessorByContentType[contentType];

    span.addData({
        file: {
            contentType,
            contentLength,
            processorType: fileProcessor.type,
        },
    });

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
              span.addData({
                  file: {
                      contentType,
                      contentLength,
                      processorType: fileProcessor.type,
                  },
              });

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

                              // eslint-disable-next-line no-commit-blockers
                              // NOCOMMIT: Debugging CI tests
                              // eslint-disable-next-line no-console
                              console.log("YOYOYO: Has accepted preview error");

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

              const commonSpanData = {
                  file: {
                      contentType,
                      contentLength,
                      processorType: fileProcessor.type,
                  },
              };

              // Specific file processors often have dependencies on one another, e.g.
              // "Process file preview size" depends on "Process file alternative" for Microsoft Word
              // documents. However, we intentionally measure spans from the start of file processing
              // so that when we look at the duration we get the user duration perceived by the user
              // (since as each of these resolves we `sendEvent()` to the user).
              await runAllPromises([
                  actualAlternativePromise
                      ? span.withSpan("Process file alternative", async span => {
                            span.addData(commonSpanData);
                            const spanData = await actualAlternativePromise;
                            span.addData(spanData);
                        })
                      : null,
                  span.withSpan("Process file preview size", async span => {
                      span.addData(commonSpanData);
                      const spanData = await actualPreviewSizePromise;
                      if (spanData) span.addData(spanData);
                  }),
                  span.withSpan("Process file preview placeholder", span => {
                      span.addData(commonSpanData);
                      return actualPreviewPlaceholderPromise;
                  }),
                  actualPreviewImagePromise
                      ? span.withSpan("Process file preview image", async span => {
                            span.addData(commonSpanData);
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

const createFileProcessorByContentType: {
    [Key in FileContentType]: (contentType: Key) => FileProcessor;
} = {
    "application/octet-stream": () => fileNoopProcessor,
    "image/apng": createFileWebSafeImageProcessor,
    "image/avif": createFileWebSafeImageProcessor,
    "image/gif": createFileWebSafeImageProcessor,
    "image/jpeg": createFileWebSafeImageProcessor,
    "image/png": createFileWebSafeImageProcessor,
    "image/svg+xml": createFileWebSafeImageProcessor,
    "image/webp": createFileWebSafeImageProcessor,
    "image/bmp": createFileWebUnsafeImageProcessor,
    "image/ico": createFileIcoImageProcessor,
    "image/tiff": createFileWebUnsafeImageProcessor,
    "image/heif": createFileWebUnsafeImageProcessor,
    "image/heic": createFileWebUnsafeImageProcessor,
    "application/pdf": createFilePdfDocumentProcessor,
    "application/msword": createFileMicrosoftOfficeDocumentProcessor,
    "application/vnd.ms-excel": createFileMicrosoftOfficeDocumentProcessor,
    "application/vnd.ms-powerpoint": createFileMicrosoftOfficeDocumentProcessor,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        createFileMicrosoftOfficeDocumentProcessor,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        createFileMicrosoftOfficeDocumentProcessor,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        createFileMicrosoftOfficeDocumentProcessor,
};

const fileProcessorByContentType: {
    [Key in FileContentType]: FileProcessor;
} = mapObjectValues(createFileProcessorByContentType, (createFileProcessor, contentType) =>
    (createFileProcessor as any)(contentType),
);
