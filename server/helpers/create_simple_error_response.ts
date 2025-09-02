import {isSystemError} from "~/shared/error/is_system_error_code.js";

/**
 * Our simple HTTP `Response` for an arbitrary error is `text/plain` with the
 * status code and status message plus the error stack trace if we're not in a
 * production environment.
 */
export function createSimpleErrorResponse(error: unknown): Response {
    let status;
    let statusMessage;
    if (isSystemError(error)) {
        status = 500;
        statusMessage = "Internal Server Error";
    } else {
        status = 400;
        statusMessage = "Bad Request";
    }

    return new Response(
        process.env.NODE_ENV === "production" || !(error instanceof Error)
            ? `${status} ${statusMessage}`
            : `${status} ${statusMessage}\n\n${error.stack ?? error.message}`,
        {
            status,
            headers: {"content-type": "text/plain"},
        },
    );
}
