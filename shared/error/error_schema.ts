import {ErrorBase} from "~/shared/error/error.js";
import {ErrorCode, isErrorCode} from "~/shared/error/error_code.js";
import {
    getErrorOriginalTracerSpan,
    setErrorOriginalTracerSpan,
} from "~/shared/error/error_original_tracer_span.js";
import {getErrorConstructorForCode} from "~/shared/error/get_error_constructor_for_code.js";
import {
    ErrorDisplayMessage,
    ErrorDisplayMessageLinkSegment,
    ErrorDisplayMessageSegment,
} from "~/shared/error/types/error_display_message_type.js";
import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.js";
import {ObjectSchema, Schema} from "~/shared/schema/schema.js";

export const ErrorDisplayMessageLinkSegmentSchema: ObjectSchema<ErrorDisplayMessageLinkSegment> =
    Schema.object({
        type: Schema.value("Link"),
        text: Schema.string,
        url: Schema.string,
    });

export const ErrorDisplayMessageSegmentSchema: Schema<ErrorDisplayMessageSegment> = Schema.union({
    Text: Schema.object({
        type: Schema.value("Text"),
        text: Schema.string,
    }),
    SensitiveText: Schema.object({
        type: Schema.value("SensitiveText"),
        text: Schema.string,
    }),
    Link: ErrorDisplayMessageLinkSegmentSchema,
});

const _ErrorDisplayMessageSchema = Schema.array(ErrorDisplayMessageSegmentSchema);

export const ErrorDisplayMessageSchema: Schema<ErrorDisplayMessage> =
    _ErrorDisplayMessageSchema as Schema<any>;

export const ErrorSchema = Schema.object({
    code: Schema.integer.optional(),
    message: Schema.string,
    displayMessage: ErrorDisplayMessageSchema.optional(),
    name: Schema.string.optional(),
    stack: Schema.string.optional(),
    original: Schema.object({
        time: Schema.date,
        traceId: Schema.id<TraceId>(),
        spanId: Schema.id<TraceSpanId>(),
    }).optional(),
}).transform<unknown>({
    serialize: error => ({
        code: error instanceof ErrorBase ? error.code : ErrorCode.Unknown,
        message: error instanceof Error ? error.message : "",
        displayMessage: error instanceof ErrorBase ? error.displayMessage : undefined,
        // In development include the stack trace of the error so we can show it to
        // the developer.
        ...(process.env.NODE_ENV !== "production" && error instanceof Error
            ? {name: error.name, stack: error.stack}
            : {}),
        original: getErrorOriginalTracerSpan(error),
    }),
    deserialize: serializedError => {
        const code =
            serializedError.code !== undefined && isErrorCode(serializedError.code)
                ? serializedError.code
                : ErrorCode.Unknown;
        const ErrorConstructor = getErrorConstructorForCode(code);

        const error = new ErrorConstructor(serializedError.message, {
            displayMessage: serializedError.displayMessage,
        });

        // If a stack trace was serialized with the error (in development we include a
        // stack trace) then assign it to the error.
        if (serializedError.stack) {
            const errorStackPrefix = `${serializedError.name ?? error.name}: ${error.message}\n`;
            const serverErrorStackPrefix = `${errorStackPrefix}\nServer stack trace:\n`;

            const errorStackWithoutPrefix = serializedError.stack.startsWith(serverErrorStackPrefix)
                ? serializedError.stack.slice(serverErrorStackPrefix.length)
                : serializedError.stack.startsWith(errorStackPrefix)
                ? serializedError.stack.slice(errorStackPrefix.length)
                : serializedError.stack;

            error.stack = `${errorStackPrefix}\nServer stack trace:\n${errorStackWithoutPrefix}`;
        }

        if (serializedError.original) {
            setErrorOriginalTracerSpan(error, serializedError.original);
        }

        return error;
    },
});
