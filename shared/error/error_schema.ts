import {ErrorBase} from "~/shared/error/error";
import {ErrorCode, isErrorCode} from "~/shared/error/error_code";
import {ErrorDisplayMessageSchema} from "~/shared/error/error_display_message";
import {getErrorConstructorForCode} from "~/shared/error/get_error_constructor_for_code";
import {Schema} from "~/shared/schema/schema";

export const ErrorSchema = Schema.object({
    code: Schema.integer.optional(),
    message: Schema.string,
    displayMessage: ErrorDisplayMessageSchema.optional(),
    name: Schema.string.optional(),
    stack: Schema.string.optional(),
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

            const errorStackWithoutPrefix = serializedError.stack.startsWith(errorStackPrefix)
                ? serializedError.stack.slice(errorStackPrefix.length)
                : serializedError.stack;

            error.stack = `${errorStackPrefix}\nServer stack trace:\n${errorStackWithoutPrefix}`;
        }

        return error;
    },
});
