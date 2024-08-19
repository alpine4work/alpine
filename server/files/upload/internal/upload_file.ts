import {IncomingMessage, ServerResponse} from "http";
import prettyBytes from "pretty-bytes";
import createSharp from "sharp";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    UnknownError,
} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

type UploadFileEvent = SchemaType<typeof UploadFileEventSchema>;

export const UploadFileEventSchema = Schema.union({
    Ok: Schema.object({
        type: Schema.value("Ok"),
    }),
    PreviewSize: Schema.object({
        type: Schema.value("PreviewSize"),
        width: Schema.integer,
        height: Schema.integer,
    }),
    Error: Schema.object({
        type: Schema.value("Error"),
        error: ErrorSchema,
    }),
});

export async function uploadFile(
    context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
    span: TracerSpan,
    url: URL,
    headers: Headers,
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
): Promise<void> {
    // Keep track of the amount of time it takes to get the file's preview size.
    // Once we have the file's preview size, that's when the client can add the
    // file to whatever content the user is editing.
    let hasFinishedPreviewSizeSpan = false;
    const {span: previewSizeSpan, finishSpan: finishPreviewSizeSpan} =
        span.startSpan("Get file preview size");

    const sendEvent = (event: UploadFileEvent) => {
        if (!res.headersSent) {
            res.writeHead(200, {"content-type": "application/x-ndjson"});
        }

        if (event.type === "PreviewSize") {
            hasFinishedPreviewSizeSpan = true;
            finishPreviewSizeSpan();
        }

        res.write(JSON.stringify(UploadFileEventSchema.serialize(event)) + "\n");
    };

    try {
        await actuallyUploadFile(context, url, headers, req, sendEvent);

        if (!hasFinishedPreviewSizeSpan) {
            previewSizeSpan.addException(new InternalError("Didn't get file preview size"));

            hasFinishedPreviewSizeSpan = true;
            finishPreviewSizeSpan();
        }
    } catch (error) {
        span.addException(error);

        // Use non-system error code since we probably were't able to get the file
        // preview size because of the error that was thrown.
        if (!hasFinishedPreviewSizeSpan) {
            previewSizeSpan.addException(
                new FailedPreconditionError("Didn't get file preview size"),
            );

            hasFinishedPreviewSizeSpan = true;
            finishPreviewSizeSpan();
        }

        // If we haven't sent headers yet, make sure we write the head with an error
        // status code. If we've already sent an event we're unfortunately stuck with
        // a 200 status code. Clients will still read the error event and interpret the
        // response appropriately.
        if (!res.headersSent) {
            const status = isSystemError(error) ? 500 : 400;
            res.writeHead(status, {"content-type": "application/x-ndjson"});
        }

        sendEvent({type: "Error", error});
        res.end();
    }
}

/**
 * Maximum size for a file uploaded to our service: 1 GB. This is the same
 * maximum file size as Slack.
 */
const maxFileByteSize = 1e9;

async function actuallyUploadFile(
    context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
    url: URL,
    headers: Headers,
    req: IncomingMessage,
    sendEvent: (event: UploadFileEvent) => void,
): Promise<void> {
    if (req.method !== "POST") throw new InvalidArgumentError('Must use "POST" method');

    let contentType = headers.get("content-type");
    if (contentType === null) throw new InvalidArgumentError('"Content-Type" header is required');

    const originalContentType = contentType;
    contentType = contentType.split(";", 2)[0]!.toLowerCase();

    if (!isFileContentType(contentType))
        throw new InvalidArgumentError(
            quote`Unsupported "Content-Type" header ${originalContentType}`,
        );

    const contentLengthString = headers.get("content-length");
    if (contentLengthString === null) {
        throw new InvalidArgumentError('"Content-Length" header is required');
    }

    const contentLength = parseInt(contentLengthString, 10);
    if (isNaN(contentLength) || !/^\d+$/.test(contentLengthString)) {
        throw new InvalidArgumentError('"Content-Length" header must be an integer');
    }

    if (contentLength > maxFileByteSize) {
        throw new InvalidArgumentError(
            `"Content-Length" of ${prettyBytes(
                contentLength,
            )} is more than our maximum file size of ${prettyBytes(maxFileByteSize)}`,
        );
    }

    const uploadFileContentType = uploadFileByContentType[contentType];

    await uploadFileContentType(context, req, sendEvent);
}

type FileContentType = "image/png" | "image/jpeg";

function isFileContentType(contentType: string): contentType is FileContentType {
    return hasOwnProperty(uploadFileByContentType, contentType);
}

const uploadFileByContentType: {
    [Key in FileContentType]: (
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        req: IncomingMessage,
        sendEvent: (event: UploadFileEvent) => void,
    ) => Promise<void>;
} = {
    "image/png": createUploadImageFile("image/png"),
    "image/jpeg": createUploadImageFile("image/jpeg"),
};

function createUploadImageFile(contentType: "image/png" | "image/jpeg") {
    return async (
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        req: IncomingMessage,
        sendEvent: (event: UploadFileEvent) => void,
    ) => {
        const sharp = createSharp({pages: 1});

        req.pipe(sharp);

        const metadataPromise = (async () => {
            const metadata = await sharp.metadata().catch(error => {
                // Kinda hacky, but treat any error from `sharp` that refers to an "input" or
                // an "image" as a user error not a system error.
                //
                // e.g. This error:
                // https://github.com/lovell/sharp/blob/fc32e0bd3f9111b80cf078df7b0cfc355695674e/src/common.cc#L413
                if (/(input|image)/i.test(error.message)) {
                    throw new InvalidArgumentError(error.message);
                }

                // Unclassified `sharp` error. We've observed that errors from `sharp` often
                // don't use the JavaScript error subclass! So make sure to create an error
                // object.
                throw new UnknownError(error.message);
            });

            let expectedFormat: keyof createSharp.FormatEnum;

            switch (contentType) {
                case "image/png":
                    expectedFormat = "png";
                    break;
                case "image/jpeg":
                    expectedFormat = "jpeg";
                    break;
                default:
                    throw exhaustive(contentType);
            }

            if (metadata.format !== expectedFormat) {
                throw new InvalidArgumentError(
                    quote`Expected file in ${expectedFormat} format but received file in ${metadata.format} format`,
                );
            }

            if (metadata.width === undefined || metadata.height === undefined) {
                throw new InternalError('Couldn\'t find "width" or "height" of image file');
            }

            sendEvent({
                type: "PreviewSize",
                width: metadata.width,
                height: metadata.height,
            });
        })();

        await runAllPromises([
            metadataPromise.catch(error => {
                // TODO(calebmer, #files): Cancel image upload?
                throw error;
            }),
        ]);

        sendEvent({type: "Ok"});
    };
}
