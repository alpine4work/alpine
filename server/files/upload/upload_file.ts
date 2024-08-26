import {IncomingMessage, ServerResponse} from "http";
import prettyBytes from "pretty-bytes";
import createSharp from "sharp";
import {filesBucketName} from "~/server/cloudflare/r2/files_bucket_name.js";
import {
    startUploadingAndProcessingFile,
    uploadFileTimeoutMs,
} from "~/server/files/data/files_table.js";
import {FileUploadServiceActionContext} from "~/server/files/upload/file_upload_service_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
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
    WebSafeImageFileContentType,
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

type UploadFileEvent = SchemaType<typeof UploadFileEventSchema>;

export const UploadFileEventSchema = Schema.union({
    Start: Schema.object({
        type: Schema.value("Start"),
        fileId: Schema.id<FileId>(),
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

    const processFilePreview = processFilePreviewByContentType[contentType];

    const abortController = new AbortController();
    const timeout = createTimeout(() => {
        abortController.abort(new DeadlineExceededError("Upload file timeout exceeded"));
    }, uploadFileTimeoutMs);

    // If the request receives the `close` event before the `end` event then abort
    // the file upload since the client didn't finish sending us data.
    const handleEnd = () => {
        req.off("end", handleEnd);
        req.off("close", handleClose);
    };
    const handleClose = () => {
        abortController.abort(new CancelledError("Upload file request was closed"));
    };
    req.on("end", handleEnd);
    req.on("close", handleClose);

    try {
        const fileUploader = await startUploadingAndProcessingFile(context, {
            spaceId,
            contentType,
            contentLength,
            hasPreview: !!processFilePreview,
        });

        span.addPropagatedData({context: {fileId: fileUploader.fileId}});

        sendEvent({type: "Start", fileId: fileUploader.fileId});

        try {
            const promise = runAllPromises([
                (async () => {
                    // NOTE(calebmer, 2024-08-26): May be worth considering multipart uploads
                    // someday if we want to support users on spotty internet connections or speed
                    // up large file uploads (for files >100 MB). For now, the simplicity of doing
                    // all processing in one shot within `FileUploadService` is nice.
                    //
                    // TODO(calebmer, #files): Consider transitioning objects to infrequent access
                    // after 1-3 months?
                    // https://developers.cloudflare.com/r2/buckets/object-lifecycles
                    await context.r2.PutObject(
                        {
                            Bucket: filesBucketName,
                            Key: `${spaceId}/${fileUploader.fileId}`,
                            ContentType: contentType,
                            Body: req,
                        },
                        {signal: abortController.signal},
                    );

                    if (abortController.signal.aborted) return;

                    await fileUploader.finishUploading(context);
                })(),
                processFilePreview
                    ? context.tracer.withSpan("Process file preview", async (context, span) => {
                          span.addData({file: {contentType, contentLength}});

                          const {sizePromise, placeholderPromise} = processFilePreview(
                              context,
                              req,
                          );

                          await runAllPromises([
                              span.withSpan("Process file preview size", async span => {
                                  span.addData({file: {contentType, contentLength}});

                                  const size = await sizePromise.catch(error => {
                                      // Cancel the upload if file processing fails.
                                      abortController.abort(error);

                                      throw error;
                                  });

                                  if (abortController.signal.aborted) return;

                                  await fileUploader.finishProcessingPreviewSize(context, size);

                                  sendEvent({
                                      type: "PreviewSize",
                                      width: size.width,
                                      height: size.height,
                                  });
                              }),
                              span.withSpan("Process file preview placeholder", async span => {
                                  span.addData({file: {contentType, contentLength}});

                                  const placeholder = await placeholderPromise.catch(error => {
                                      // Cancel the upload if file processing fails.
                                      abortController.abort(error);

                                      throw error;
                                  });

                                  if (abortController.signal.aborted) return;

                                  await fileUploader.finishProcessingPreviewPlaceholder(
                                      context,
                                      placeholder,
                                  );

                                  sendEvent({type: "PreviewPlaceholder", placeholder});
                              }),
                          ]);
                      })
                    : null,
            ]);

            await Promise.race([
                promise,
                new Promise<void>((resolve, reject) => {
                    const handleAbort = () => {
                        abortController.signal.removeEventListener("abort", handleAbort);
                        reject(abortController.signal.reason);
                    };
                    abortController.signal.addEventListener("abort", handleAbort);
                }),
            ]);

            sendEvent({type: "Finish"});
        } catch (error) {
            await fileUploader.cleanupAfterError(context);
            throw error;
        }
    } finally {
        timeout.clear();
        req.off("end", handleEnd);
        req.off("close", handleClose);
    }
}

const processFilePreviewByContentType: {
    [Key in FileContentType]:
        | ((
              context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
              req: IncomingMessage,
          ) => {
              sizePromise: Promise<{width: number; height: number}>;
              placeholderPromise: Promise<FilePreviewPlaceholder>;
          })
        | null;
} = {
    "image/apng": createProcessWebSafeImageFilePreview("image/apng"),
    "image/avif": createProcessWebSafeImageFilePreview("image/avif"),
    "image/gif": createProcessWebSafeImageFilePreview("image/gif"),
    "image/jpeg": createProcessWebSafeImageFilePreview("image/jpeg"),
    "image/png": createProcessWebSafeImageFilePreview("image/png"),
    "image/svg+xml": createProcessWebSafeImageFilePreview("image/svg+xml"),
    "image/webp": createProcessWebSafeImageFilePreview("image/webp"),
};

function createProcessWebSafeImageFilePreview(contentType: WebSafeImageFileContentType) {
    return (
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        req: IncomingMessage,
    ) => {
        const sizePromise = (async () => {
            const sharp = createSharp({pages: 1});

            req.pipe(sharp);

            const metadata = await sharp.metadata().catch(rethrowClassifiedSharpError);

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

            req.pipe(sharp);

            // A placeholder of size 5 generates 25 pixels and is encoded to <700 bytes.
            const placeholderSize = 5;

            const {
                data,
                info: {channels, width},
            } = await sharp
                .resize(placeholderSize, placeholderSize, {fit: "inside"})
                .toFormat("png")
                .modulate({brightness: 1, saturation: 1.2})
                .raw()
                .toBuffer({resolveWithObject: true})
                .catch(rethrowClassifiedSharpError);

            assert(channels === 3 || channels === 4);

            return FilePreviewPlaceholder.fromSerialized([channels === 4, width, data]);
        })();

        return {sizePromise, placeholderPromise};
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
