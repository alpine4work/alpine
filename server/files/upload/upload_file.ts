import decodeIco from "decode-ico";
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
    ImageFileContentType,
    WebSafeImageFileContentType,
    WebUnsafeImageFileContentType,
    getFileContentTypePreferredExtension,
    isFileContentType,
    normalizeContentType,
} from "~/shared/files/file_content_type.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
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
        hasPreview: Schema.boolean,
        hasPreviewImage: Schema.boolean,
    }),
    Finish: Schema.object({
        type: Schema.value("Finish"),
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
    route: {spaceId: SpaceId},
    url: URL,
    headers: Headers,
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
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
        const promise = actuallyUploadFile(context, span, route, url, headers, req, sendEvent);

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
    {spaceId}: {spaceId: SpaceId},
    url: URL,
    headers: Headers,
    req: IncomingMessage,
    sendEvent: (event: UploadFileEvent) => void,
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
            abortSignal: abortController.signal,
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
        abortSignal,
        createAbortCatcher,
    }: {
        spaceId: SpaceId;
        contentType: FileContentType;
        contentLength: number;
        fileProcessor: FileProcessor;
        fileUploader: FileUploader;
        stream: ReadableStream;
        sendEvent: (event: UploadFileEvent) => void;
        abortSignal: AbortSignal;
        createAbortCatcher: (message: string) => (error: unknown) => never;
    },
) {
    sendEvent({
        type: "Start",
        fileId: fileUploader.fileId,
        hasPreview: fileProcessor.hasPreview,
        hasPreviewImage: fileProcessor.hasPreviewImage,
    });

    const dataPromise = new Promise<Buffer>((resolve, reject) => {
        if (abortSignal.aborted) {
            reject(abortSignal.reason);
            return;
        }

        let chunks: Array<Buffer> = [];

        const handleData = (data: Buffer) => {
            chunks.push(data);
        };

        const handleEnd = () => {
            const data = Buffer.concat(chunks);

            chunks = [];
            stream.off("data", handleData);
            stream.off("end", handleEnd);
            abortSignal.removeEventListener("abort", handleAbort);

            resolve(data);
        };

        const handleAbort = () => {
            chunks = [];
            stream.off("data", handleData);
            stream.off("end", handleEnd);
            abortSignal.removeEventListener("abort", handleAbort);

            reject(abortSignal.reason);
        };

        stream.on("data", handleData);
        stream.on("end", handleEnd);
        abortSignal.addEventListener("abort", handleAbort);
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
        // `waitForAbort(abortSignal)` since we need to wait for the `PutObject()` to
        // finish in order for `fileUploader.cleanupAfterError()` to successfully
        // cleanup the object.
        //
        // `PutObject()` should respect `signal` so we can handle the case where the
        // request closes before it ends.
        await context.r2.PutObject(
            {
                Bucket: filesBucketName,
                Key: `${spaceId}/${fileUploader.fileId}.${getFileContentTypePreferredExtension(
                    contentType,
                )}`,
                ContentType: contentType,
                Body: stream,
            },
            {signal: abortSignal},
        );

        if (abortSignal.aborted) throw abortSignal.reason;

        await fileUploader.finishUploading(context);
    })().catch(createAbortCatcher("File uploading failed"));

    const processPromise = fileProcessor.hasPreview
        ? context.tracer.withSpan("Process file preview", async (context, span) => {
              span.addData({file: {contentType, contentLength}});

              const {sizePromise, placeholderPromise, imagePromise} = fileProcessor.process(
                  stream,
                  dataPromise,
                  abortSignal,
              );

              let hasAcceptedPreviewError = false;

              const createPreviewAbortCatcher = (message: string) => {
                  const abortCatcher = createAbortCatcher(message);

                  return async (error: unknown) => {
                      if (hasAcceptedPreviewError) throw error;

                      if (
                          !abortSignal.aborted &&
                          error instanceof ErrorBase &&
                          error.displayMessage
                      ) {
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

              const actualSizePromise = (async () => {
                  const {width, height, scale} = await sizePromise;
                  if (abortSignal.aborted) throw abortSignal.reason;
                  if (hasAcceptedPreviewError) return;

                  await fileUploader.finishProcessingPreviewSize(context, {width, height, scale});

                  sendEvent({
                      type: "PreviewSize",
                      width,
                      height,
                      scale,
                  });
              })().catch(createPreviewAbortCatcher("File preview size processing failed"));

              const actualPlaceholderPromise = (async () => {
                  const placeholder = await placeholderPromise;
                  if (abortSignal.aborted) throw abortSignal.reason;
                  if (hasAcceptedPreviewError) return;

                  await fileUploader.finishProcessingPreviewPlaceholder(context, placeholder);

                  sendEvent({
                      type: "PreviewPlaceholder",
                      placeholder,
                  });
              })().catch(createPreviewAbortCatcher("File preview placeholder processing failed"));

              const actualImagePromise = imagePromise
                  ? (async () => {
                        const image = await imagePromise;
                        if (abortSignal.aborted) throw abortSignal.reason;
                        if (hasAcceptedPreviewError) return;

                        // NOTE: We don't `Promise.race()` `PutObject()` with
                        // `waitForAbort(abortSignal)` since we need to wait for the `PutObject()` to
                        // finish in order for `fileUploader.cleanupAfterError()` to successfully
                        // cleanup the object.
                        await context.r2.PutObject(
                            {
                                Bucket: filesBucketName,
                                Key: `${spaceId}/${
                                    fileUploader.fileId
                                }.preview.${getFileContentTypePreferredExtension(
                                    image.contentType,
                                )}`,
                                ContentType: image.contentType,
                                Body: image.data,
                            },
                            {signal: abortSignal},
                        );

                        if (abortSignal.aborted) throw abortSignal.reason;
                        if (hasAcceptedPreviewError) return;

                        await fileUploader.finishProcessingPreviewImage(context, {
                            contentType: image.contentType,
                            contentLength: image.data.length,
                        });

                        sendEvent({
                            type: "PreviewImage",
                            contentType: image.contentType,
                            contentLength: image.data.length,
                        });
                    })().catch(createPreviewAbortCatcher("File preview image processing failed"))
                  : null;

              await runAllPromises([
                  span.withSpan("Process file preview size", span => {
                      span.addData({file: {contentType, contentLength}});
                      return actualSizePromise;
                  }),
                  span.withSpan("Process file preview placeholder", span => {
                      span.addData({file: {contentType, contentLength}});
                      return actualPlaceholderPromise;
                  }),
                  actualImagePromise
                      ? span.withSpan("Process file preview image", span => {
                            span.addData({file: {contentType, contentLength}});
                            return actualImagePromise;
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
 * `stream` and `dataPromise` which represents the data in two different
 * forms. `stream` is a Node.js stream, use this if your processor supports
 * efficient stream processing. Otherwise you may use `dataPromise` which
 * resolves once `stream` ends with the file's full data. `dataPromise` also
 * rejects with `CancelledError` if the upload is aborted.
 *
 * If you're using `stream`, make sure to cancel your stream processing if the
 * upload is aborted. Since `stream` may not end after an abort. You can find
 * out if the upload is aborted with `abortSignal`.
 *
 * If `acceptError` is provided and you return true for an error we won't
 * cancel the file upload when processing throws but instead save the provided
 * error's `displayMessage` in the database. Then when the user tries to
 * view the preview we'll show them the error message. So the upload will be
 * successful but the user won't be able to preview the file. `acceptError`
 * will only be called for errors with a `displayMessage`.
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
    | {
          readonly hasPreview: false;
          readonly hasPreviewImage: false;
      }
    | {
          readonly hasPreview: true;
          readonly hasPreviewImage: false;
          readonly process: (
              stream: ReadableStream,
              dataPromise: Promise<Buffer>,
              abortSignal: AbortSignal,
          ) => {
              sizePromise: Promise<{width: number; height: number; scale: number}>;
              placeholderPromise: Promise<FilePreviewPlaceholder>;
              imagePromise?: undefined;
          };
          readonly acceptError?: (
              error: ErrorBase,
              displayMessage: ErrorDisplayMessage,
          ) => boolean | undefined;
      }
    | {
          readonly hasPreview: true;
          readonly hasPreviewImage: true;
          readonly process: (
              stream: ReadableStream,
              dataPromise: Promise<Buffer>,
              abortSignal: AbortSignal,
          ) => {
              sizePromise: Promise<{width: number; height: number; scale: number}>;
              placeholderPromise: Promise<FilePreviewPlaceholder>;
              imagePromise: Promise<{contentType: FileContentType; data: Buffer}>;
          };
          readonly acceptError?: (
              error: ErrorBase,
              displayMessage: ErrorDisplayMessage,
          ) => boolean | undefined;
      };

const noFileProcessor: FileProcessor = {hasPreview: false, hasPreviewImage: false};

const fileProcessorByContentType: {
    [Key in FileContentType]: FileProcessor;
} = {
    "application/octet-stream": noFileProcessor,
    "image/apng": createWebSafeImageFileProcessor("image/apng"),
    "image/avif": createWebSafeImageFileProcessor("image/avif"),
    "image/gif": createWebSafeImageFileProcessor("image/gif"),
    "image/jpeg": createWebSafeImageFileProcessor("image/jpeg"),
    "image/png": createWebSafeImageFileProcessor("image/png"),
    "image/svg+xml": createWebSafeImageFileProcessor("image/svg+xml"),
    "image/webp": createWebSafeImageFileProcessor("image/webp"),
    "image/bmp": createWebUnsafeImageFileProcessor("image/bmp"),
    "image/ico": createIcoImageFileProcessor(),
    "image/tiff": createWebUnsafeImageFileProcessor("image/tiff"),
    "image/heif": createWebUnsafeImageFileProcessor("image/heif"),
    "image/heic": createWebUnsafeImageFileProcessor("image/heic"),
    "application/pdf": createPdfDocumentFileProcessor(),
};

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
    contentType: Exclude<ImageFileContentType, "image/ico">,
    dataPromise: Promise<Buffer>,
) {
    const sizePromise = (async () => {
        // Unfortunately, `sharp` doesn't support efficient stream processing so it's
        // more efficient to await `dataPromise` than to use `stream`. See our comment
        // on `FileProcessor`.
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
    const placeholderPromise = (async () => {
        // Unfortunately, `sharp` doesn't support efficient stream processing so it's
        // more efficient to await `dataPromise` than to use `stream`. See our comment
        // on `FileProcessor`.
        const inputData = await dataPromise;

        return processFilePreviewPlaceholder(inputData);
    })();

    return {sizePromise, placeholderPromise};
}

function createWebSafeImageFileProcessor(contentType: WebSafeImageFileContentType): FileProcessor {
    return {
        hasPreview: true,
        hasPreviewImage: false,
        process: (stream, dataPromise) => processImageFile(contentType, dataPromise),
    };
}

function createWebUnsafeImageFileProcessor(
    contentType: Exclude<WebUnsafeImageFileContentType, "image/ico">,
): FileProcessor {
    return {
        hasPreview: true,
        hasPreviewImage: true,
        process: (stream, dataPromise) => {
            const {sizePromise, placeholderPromise} = processImageFile(contentType, dataPromise);

            const imagePromise = (async (): Promise<{
                contentType: FileContentType;
                data: Buffer;
            }> => {
                // Unfortunately, `sharp` doesn't support efficient stream processing so it's
                // more efficient to await `dataPromise` than to use `stream`. See our comment
                // on `FileProcessor`.
                const inputData = await dataPromise;

                const outputData = await sharp(inputData, {pages: 1})
                    .timeout({seconds: sharpTimeoutSeconds})
                    // AVIF is our preferred format for generating preview images. AVIF has full
                    // browser support, provides better compression than JPEG and WebP, and has
                    // alpha channel support (unlike JPEG).
                    //
                    // Some sources:
                    //
                    // - https://medium.com/@julienetienne/why-you-should-use-avif-over-jpeg-webp-png-and-gif-in-2024-5603ac9d8781
                    // - https://jakearchibald.com/2020/avif-has-landed
                    //
                    // Quality 90 since we don't want to remove detail from the source file in our
                    // preview (which may already be compressed) but we also want some compression
                    // since the extra storage cost of the preview file is on us. We could probably
                    // get away with lower quality without a perceptible difference.
                    .toFormat("avif", {quality: 90})
                    .toBuffer()
                    .catch(rethrowClassifiedSharpError);

                return {contentType: "image/avif", data: outputData};
            })();

            return {sizePromise, placeholderPromise, imagePromise};
        },
    };
}

/**
 * Special handling for `image/ico` files that selects the largest image from the
 * `.ico` container format and creates a preview from that.
 */
function createIcoImageFileProcessor(): FileProcessor {
    return {
        hasPreview: true,
        hasPreviewImage: true,
        process: (stream, dataPromise) => {
            const promise = (async () => {
                const data = await dataPromise;

                const bestImage = decodeIco(data).sort(
                    (image1, image2) => image2.width * image2.height - image1.width * image1.height,
                )[0];
                if (!bestImage) {
                    throw new InvalidArgumentError('No images in ".ico" file');
                }

                const bestImageData = Buffer.from(bestImage.data);

                const sizePromise = Promise.resolve({
                    width: bestImage.width,
                    height: bestImage.height,
                    scale: 1,
                });

                let placeholderPromise: Promise<FilePreviewPlaceholder>;
                let imagePromise: Promise<{contentType: FileContentType; data: Buffer}>;
                switch (bestImage.type) {
                    case "png": {
                        placeholderPromise = processFilePreviewPlaceholder(bestImageData);

                        imagePromise = Promise.resolve({
                            contentType: "image/png",
                            data: bestImageData,
                        });
                        break;
                    }
                    case "bmp": {
                        placeholderPromise = processFilePreviewPlaceholder(bestImageData, {
                            raw: {
                                width: bestImage.width,
                                height: bestImage.height,
                                channels: 4,
                            },
                        });

                        imagePromise = (async () => {
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

                return {sizePromise, placeholderPromise, imagePromise};
            })();

            return {
                sizePromise: promise.then(({sizePromise}) => sizePromise),
                placeholderPromise: promise.then(({placeholderPromise}) => placeholderPromise),
                imagePromise: promise.then(({imagePromise}) => imagePromise),
            };
        },
    };
}

function createPdfDocumentFileProcessor(): FileProcessor {
    return {
        hasPreview: true,
        hasPreviewImage: true,
        process: (stream, dataPromise) => {
            const sizePromise = (async () => {
                // Unfortunately, `sharp` doesn't support efficient stream processing so it's
                // more efficient to await `dataPromise` than to use `stream`. See our comment
                // on `FileProcessor`.
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

            return {
                sizePromise,
                placeholderPromise: (async () => {
                    // Unfortunately, `sharp` doesn't support efficient stream processing so it's
                    // more efficient to await `dataPromise` than to use `stream`. See our comment
                    // on `FileProcessor`.
                    const data = await dataPromise;
                    return processFilePreviewPlaceholder(data);
                })(),
                imagePromise: (async () => {
                    const [{width, height}, inputData] = await runAllPromises([
                        sizePromise,
                        // Unfortunately, `sharp` doesn't support efficient stream processing so it's
                        // more efficient to await `dataPromise` than to use `stream`. See our comment
                        // on `FileProcessor`.
                        dataPromise,
                    ]);

                    const outputData = await sharp(inputData, {pages: 1})
                        .timeout({seconds: sharpTimeoutSeconds})
                        // AVIF is our preferred format for generating preview images. AVIF has full
                        // browser support, provides better compression than JPEG and WebP, and has
                        // alpha channel support (unlike JPEG).
                        //
                        // Some sources:
                        //
                        // - https://medium.com/@julienetienne/why-you-should-use-avif-over-jpeg-webp-png-and-gif-in-2024-5603ac9d8781
                        // - https://jakearchibald.com/2020/avif-has-landed
                        //
                        // Quality 90 since we don't want to remove detail from the source file in our
                        // preview (which may already be compressed) but we also want some compression
                        // since the extra storage cost of the preview file is on us. We could probably
                        // get away with lower quality without a perceptible difference.
                        .toFormat("avif", {quality: 90})
                        .resize(width, height)
                        .toBuffer()
                        .catch(rethrowClassifiedSharpError);

                    return {contentType: "image/avif", data: outputData};
                })(),
            };
        },
        acceptError: error => error.displayMessage === pdfPasswordRequiredErrorDisplayMessage,
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
