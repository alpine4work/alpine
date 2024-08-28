import {IncomingMessage, ServerResponse} from "http";
import prettyBytes from "pretty-bytes";
import createSharp from "sharp";
import {Readable} from "stream";
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
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
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
import {waitForAbort} from "~/shared/helpers/async/wait_for_abort.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

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
        stream: Readable;
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
                  abortSignal,
              );

              const actualSizePromise = (async () => {
                  const size = await sizePromise;
                  if (abortSignal.aborted) throw abortSignal.reason;

                  await fileUploader.finishProcessingPreviewSize(context, size);

                  sendEvent({
                      type: "PreviewSize",
                      width: size.width,
                      height: size.height,
                  });
              })().catch(createAbortCatcher("File preview size processing failed"));

              const actualPlaceholderPromise = (async () => {
                  const placeholder = await placeholderPromise;
                  if (abortSignal.aborted) throw abortSignal.reason;

                  await fileUploader.finishProcessingPreviewPlaceholder(context, placeholder);

                  sendEvent({
                      type: "PreviewPlaceholder",
                      placeholder,
                  });
              })().catch(createAbortCatcher("File preview placeholder processing failed"));

              const actualImagePromise = imagePromise
                  ? (async () => {
                        const image = await imagePromise;
                        if (abortSignal.aborted) throw abortSignal.reason;

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

                        await fileUploader.finishProcessingPreviewImage(context, {
                            contentType: image.contentType,
                            contentLength: image.data.length,
                        });

                        sendEvent({
                            type: "PreviewImage",
                            contentType: image.contentType,
                            contentLength: image.data.length,
                        });
                    })().catch(createAbortCatcher("File preview image processing failed"))
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
              ]);
          })
        : null;

    await runAllPromises([uploadPromise, processPromise]).catch(async error => {
        await fileUploader.cleanupAfterError(context);
        throw error;
    });

    sendEvent({type: "Finish"});
}

type FileProcessor =
    | {
          readonly hasPreview: false;
          readonly hasPreviewImage: false;
      }
    | {
          readonly hasPreview: true;
          readonly hasPreviewImage: false;
          readonly process: (
              stream: Readable,
              abortSignal: AbortSignal,
          ) => {
              sizePromise: Promise<{width: number; height: number}>;
              placeholderPromise: Promise<FilePreviewPlaceholder>;
              imagePromise?: undefined;
          };
      }
    | {
          readonly hasPreview: true;
          readonly hasPreviewImage: true;
          readonly process: (
              stream: Readable,
              abortSignal: AbortSignal,
          ) => {
              sizePromise: Promise<{width: number; height: number}>;
              placeholderPromise: Promise<FilePreviewPlaceholder>;
              imagePromise: Promise<{contentType: FileContentType; data: Buffer}>;
          };
      };

const fileProcessorByContentType: {
    [Key in FileContentType]: FileProcessor;
} = {
    "image/apng": createWebSafeImageFileProcessor("image/apng"),
    "image/avif": createWebSafeImageFileProcessor("image/avif"),
    "image/gif": createWebSafeImageFileProcessor("image/gif"),
    "image/jpeg": createWebSafeImageFileProcessor("image/jpeg"),
    "image/png": createWebSafeImageFileProcessor("image/png"),
    "image/svg+xml": createWebSafeImageFileProcessor("image/svg+xml"),
    "image/webp": createWebSafeImageFileProcessor("image/webp"),
    "image/bmp": createWebUnsafeImageFileProcessor("image/bmp", "image/jpeg"),
    "image/tiff": createWebUnsafeImageFileProcessor("image/tiff", "image/png"),
};

function processImageFile(
    contentType: ImageFileContentType,
    stream: Readable,
    abortSignal: AbortSignal,
) {
    const sizePromise = (async () => {
        const sharp = createSharp({pages: 1});

        stream.pipe(sharp);

        const metadata = await Promise.race([
            sharp.metadata().catch(rethrowClassifiedSharpError),
            // Sharp will never resolve in some abort scenarios since `req` will close but
            // the stream won't end.
            waitForAbort(abortSignal),
        ]);

        let expectedFormat: keyof createSharp.FormatEnum;
        let expectedCompression: createSharp.Metadata["compression"];

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
                expectedFormat = "bmp";
                break;
            case "image/tiff":
                expectedFormat = "tiff";
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

        if (metadata.width === undefined || metadata.height === undefined) {
            throw new InternalError('Couldn\'t find "width" or "height" of image file');
        }

        return {
            width: metadata.width,
            height: metadata.height,
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
        const sharp = createSharp({pages: 1});

        stream.pipe(sharp);

        // A placeholder of size 5 generates 25 pixels and is encoded to <700 bytes.
        const placeholderSize = 5;

        const {
            data,
            info: {channels, width},
        } = await Promise.race([
            sharp
                .resize(placeholderSize, placeholderSize, {fit: "inside"})
                .toFormat("png")
                .modulate({brightness: 1, saturation: 1.2})
                .raw()
                .toBuffer({resolveWithObject: true})
                .catch(rethrowClassifiedSharpError),
            // Sharp will never resolve in some abort scenarios since `req` will close but
            // the stream won't end.
            waitForAbort(abortSignal),
        ]);

        assert(channels === 3 || channels === 4);

        return FilePreviewPlaceholder.fromSerialized([channels === 4, width, data]);
    })();

    return {sizePromise, placeholderPromise};
}

function createWebSafeImageFileProcessor(contentType: WebSafeImageFileContentType): FileProcessor {
    return {
        hasPreview: true,
        hasPreviewImage: false,
        process: (stream, abortSignal) => processImageFile(contentType, stream, abortSignal),
    };
}

function createWebUnsafeImageFileProcessor(
    contentType: WebUnsafeImageFileContentType,
    // Use `image/jpeg` if the image type doesn't support transparency since JPEG
    // has better compression. Otherwise use `image/png`.
    //
    // https://www.adobe.com/creativecloud/file-types/image/comparison/jpeg-vs-png.html
    previewImageContentType: "image/jpeg" | "image/png",
): FileProcessor {
    return {
        hasPreview: true,
        hasPreviewImage: true,
        process: (stream, abortSignal) => {
            let previewImageFormat: keyof createSharp.FormatEnum;

            switch (previewImageContentType) {
                case "image/jpeg":
                    previewImageFormat = "jpeg";
                    break;
                case "image/png":
                    previewImageFormat = "png";
                    break;
                default:
                    throw exhaustive(previewImageContentType);
            }

            const {sizePromise, placeholderPromise} = processImageFile(
                contentType,
                stream,
                abortSignal,
            );

            const imagePromise = (async () => {
                const sharp = createSharp({pages: 1});

                stream.pipe(sharp);

                const data = await Promise.race([
                    sharp
                        .toFormat(previewImageFormat)
                        .toBuffer()
                        .catch(rethrowClassifiedSharpError),
                    // Sharp will never resolve in some abort scenarios since `req` will close but
                    // the stream won't end.
                    waitForAbort(abortSignal),
                ]);

                return {contentType: previewImageContentType, data};
            })();

            return {sizePromise, placeholderPromise, imagePromise};
        },
    };
}

function rethrowClassifiedSharpError(error: unknown): never {
    throw classifySharpError(error);
}

function classifySharpError(error: unknown): ErrorBase {
    if (!isObject(error) || typeof error.message !== "string")
        return new UnknownError(String(error));

    // Kinda hacky, but treat any error from `sharp` that refers to an "input" or
    // an "image" as a user error not a system error.
    //
    // e.g. This error:
    // https://github.com/lovell/sharp/blob/fc32e0bd3f9111b80cf078df7b0cfc355695674e/src/common.cc#L413
    if (/(input|image)/i.test(error.message)) {
        return new InvalidArgumentError(error.message);
    }

    // Unclassified `sharp` error. We've observed that errors from `sharp` often
    // don't use the JavaScript error subclass! So make sure to create an error
    // object.
    return new UnknownError(error.message);
}
