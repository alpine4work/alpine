import {getAggregateErrorPriority} from "~/shared/error/aggregate_error.js";
import {ErrorBase, getErrorCode} from "~/shared/error/error.js";
import {ErrorCode, getErrorCodes, isErrorCode} from "~/shared/error/error_code.js";
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
import {isObject} from "~/shared/helpers/object/is_object.js";
import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.js";
import {ObjectSchema, Schema, SchemaType} from "~/shared/schema/schema.js";

export const ErrorCodeSchema = Schema.enum(getErrorCodes());

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

export const ErrorDisplayMessageSchema: Schema<ErrorDisplayMessage> = Schema.array(
    ErrorDisplayMessageSegmentSchema,
) as Schema<any>;

type ErrorBaseWithCause = {
    readonly message: string;
    readonly code?: number;
    readonly displayMessage?: ErrorDisplayMessage;
    readonly aggregateDedupeKey?: string;
    readonly name?: string;
    readonly stack?: string;
    readonly cause?: ErrorBaseWithCause;
};

const ErrorBaseWithCauseRecursiveSchema = Schema.declare<ErrorBaseWithCause>();

const ErrorBaseWithCauseSchema = Schema.object({
    code: ErrorCodeSchema.optional(),
    message: Schema.string,
    displayMessage: ErrorDisplayMessageSchema.optional(),
    aggregateDedupeKey: Schema.string.optional(),
    name: Schema.string.optional(),
    stack: Schema.string.optional(),
    cause: ErrorBaseWithCauseRecursiveSchema.optional(),
});

ErrorBaseWithCauseRecursiveSchema.define(ErrorBaseWithCauseSchema);

const maxAggregateErrorCount = 5;

const ErrorSchemaWithoutTransform = ErrorBaseWithCauseSchema.merge(
    Schema.object({
        original: Schema.object({
            time: Schema.date,
            traceId: Schema.id<TraceId>(),
            spanId: Schema.id<TraceSpanId>(),
        }).optional(),
        aggregated: Schema.array(ErrorBaseWithCauseRecursiveSchema)
            .minLength(1)
            .maxLength(maxAggregateErrorCount)
            .optional(),
    }),
);

export const ErrorSchema = ErrorSchemaWithoutTransform.transform<unknown>({
    serialize: serializeError,
    deserialize: deserializeError,
});

export function serializeError(error: unknown) {
    const aggregateErrors: Array<unknown> = [];

    const pushAggregateError = (error: unknown) => {
        if (!(error instanceof AggregateError)) {
            aggregateErrors.push(error);
        } else {
            for (const childError of error.errors) {
                pushAggregateError(childError);
            }
        }
    };

    if (error instanceof AggregateError) {
        for (const childError of error.errors) {
            pushAggregateError(childError);
        }
    }

    // Rank the highest priority errors first. So when we select the first N errors to
    // serialize we have the worst errors.
    aggregateErrors.sort(
        (error1, error2) => getAggregateErrorPriority(error2) - getAggregateErrorPriority(error1),
    );

    return {
        ...serializeErrorBaseWithCause(error),
        original: getErrorOriginalTracerSpan(error),

        aggregated:
            aggregateErrors.length > 0
                ? aggregateErrors.slice(0, maxAggregateErrorCount).map(serializeErrorBaseWithCause)
                : undefined,
    };
}

function serializeErrorBaseWithCause(error: unknown): ErrorBaseWithCause {
    return {
        ...serializeErrorBase(error),

        // Only include causes that, themselves, are instances of `Error`. Only serialize
        // causes 3 deep. (Same as `getTracerEventExceptionData()`.)
        cause:
            error instanceof Error && error.cause && error.cause instanceof Error
                ? error.cause.cause && error.cause.cause instanceof Error
                    ? {
                          ...serializeErrorBase(error.cause),
                          cause: serializeErrorBase(error.cause.cause),
                      }
                    : serializeErrorBase(error.cause)
                : undefined,
    };
}

function serializeErrorBase(error: unknown) {
    return {
        code: getErrorCode(error),
        message:
            // NOTE(calebmer): I've found some strange error objects that look like errors but
            // aren't `instanceof Error`.
            isObject(error) && "message" in error && typeof error.message === "string"
                ? error.message
                : String(error),
        displayMessage: error instanceof ErrorBase ? error.displayMessage : undefined,
        aggregateDedupeKey: error instanceof ErrorBase ? error.aggregateDedupeKey : undefined,
        // In development include the stack trace of the error so we can show it to the
        // developer.
        ...(process.env.NODE_ENV !== "production" && error instanceof Error
            ? {name: error.name, stack: error.stack}
            : {}),
    };
}

function deserializeError(
    serializedError: SchemaType<typeof ErrorSchemaWithoutTransform>,
): unknown {
    const code =
        serializedError.code !== undefined && isErrorCode(serializedError.code)
            ? serializedError.code
            : ErrorCode.Unknown;

    let error: Error;
    if (serializedError.aggregated && serializedError.aggregated.length > 0) {
        const errors = serializedError.aggregated.map(deserializeError);

        error = new AggregateError(errors, serializedError.message, {
            cause: serializedError.cause ? deserializeError(serializedError.cause) : undefined,
        });

        (error as any).code = code;
    } else {
        const ErrorConstructor = getErrorConstructorForCode(code);

        error = new ErrorConstructor(serializedError.message, {
            displayMessage: serializedError.displayMessage,
            aggregateDedupeKey: serializedError.aggregateDedupeKey,
            cause: serializedError.cause ? deserializeError(serializedError.cause) : undefined,
        });
    }

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
}
