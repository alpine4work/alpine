import {setFileProcessorError} from "~/server/files/processor/error/file_processor_error.js";
import {
    DeadlineExceededError,
    ErrorBase,
    InvalidArgumentError,
    PermissionDeniedError,
    UnknownError,
} from "~/shared/error/error.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";

export function rethrowClassifiedSharpError(error: unknown): never {
    throw classifySharpError(error);
}

export function classifySharpError(error: unknown): ErrorBase {
    if (!isObject(error) || typeof error.message !== "string") {
        return classifySharpError({message: String(error)});
    }

    // If our timeout was exceeded while processing the file. See:
    // https://sharp.pixelplumbing.com/api-output#timeout
    if (error.message.includes("timeout")) {
        return new DeadlineExceededError(formatSharpErrorMessage(error.message));
    }

    // Kinda hacky, but treat any error from `sharp` that refers to an "input" or an
    // "image" as a user error not a system error.
    //
    // e.g. This error:
    // https://github.com/lovell/sharp/blob/fc32e0bd3f9111b80cf078df7b0cfc355695674e/src/common.cc#L413
    if (/(input|image)/i.test(error.message)) {
        if (error.message.includes("pdf") && error.message.includes("password required")) {
            const classifiedError = new PermissionDeniedError(
                formatSharpErrorMessage(error.message),
            );
            setFileProcessorError(classifiedError, {type: "PasswordProtected"});
            return classifiedError;
        } else {
            return new InvalidArgumentError(formatSharpErrorMessage(error.message));
        }
    }

    // Unclassified `sharp` error. We've observed that errors from `sharp` often don't
    // use the JavaScript error subclass! So make sure to create an error object.
    return new UnknownError(formatSharpErrorMessage(error.message));
}

function formatSharpErrorMessage(message: string): string {
    return (
        message
            // Security through obscurity: Don't disclose that we use GraphicsMagick in error
            // messages so attackers don't know to try GraphicsMagick exploits. We use
            // GraphicsMagick instead of ImageMagick which has fewer CVEs but since the attack
            // surface is still broad we think it's worth not clearly disclosing the library we
            // use. Replace "magick" with "x".
            //
            // NOTE(calebmer, 2024-11-19): This was added when we returned file processing
            // error messages to the client. I don't think there's any code path where the
            // client can see file processor error messages anymore (given file processing
            // happens in a SQS queue) so we can probably remove this.
            .replaceAll(/magick/gi, substring =>
                substring[0]! === substring[0]!.toLowerCase() ? "x" : "X",
            )
    );
}
