import {ErrorCode} from "~/shared/error/error_code.js";

/**
 * Gets the best error code for the provided HTTP status code. Generally, we should
 * be propagating our own errors over HTTP using `ErrorSchema` so we can preserve
 * the exact error code (most of the time we only use 400 and 500 as error codes),
 * however when dealing with third party APIs this provides a useful default for
 * classifying common errors from that third party.
 */
export function getErrorCodeForHttpStatusCode(statusCode: number): ErrorCode {
    switch (statusCode) {
        case 400:
        case 405:
            return ErrorCode.InvalidArgument;
        case 401:
            return ErrorCode.Unauthenticated;
        case 403:
            return ErrorCode.PermissionDenied;
        case 404:
            return ErrorCode.NotFound;
        default:
            return statusCode >= 500 ? ErrorCode.Internal : ErrorCode.Unknown;
    }
}
