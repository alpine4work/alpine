import prettyBytes from "pretty-bytes";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {getSessionCookieIfExists} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {
    FileContentType,
    canonicalizeFileContentTypeIfExists,
} from "~/shared/files/file_content_type.js";
import {quote} from "~/shared/helpers/string/quote.js";

// This file is used both by `EdgeService` and in tests. So we don't want to
// depend on anything `EdgeService` specific here.
export async function authorizeRequestAndGetMetadataWithSessionToken(
    tokenAgent: TokenAgent,
    request: Request,
): Promise<{
    contentType: FileContentType;
    contentLength: number;
    sessionCookieToken: SessionTokenPayload;
}> {
    if (request.method !== "POST") throw new InvalidArgumentError("Must use `POST` method");

    const originalContentType = request.headers.get("content-type");
    if (originalContentType === null)
        throw new InvalidArgumentError("`Content-Type` header is required");

    const contentType = canonicalizeFileContentTypeIfExists(originalContentType);

    if (contentType === null) {
        throw new InvalidArgumentError(
            quote`Unsupported \`Content-Type\` header ${originalContentType}`,
        );
    }

    const contentLengthString = request.headers.get("content-length");
    if (contentLengthString === null) {
        throw new InvalidArgumentError("`Content-Length` header is required");
    }

    const contentLength = parseInt(contentLengthString, 10);
    if (isNaN(contentLength) || !/^\d+$/.test(contentLengthString)) {
        throw new InvalidArgumentError("`Content-Length` header must be an integer");
    }

    // If `Content-Length` is 0 there's probably a bug somewhere and data isn't reaching
    // `EdgeService`.
    if (contentLength <= 0) {
        throw new InvalidArgumentError(
            `Can’t upload file with \`Content-Length\` of ${prettyBytes(contentLength)}`,
        );
    }

    const sessionCookieToken = await getSessionCookieIfExists(tokenAgent, request);
    if (!sessionCookieToken) throw unauthenticatedSessionError();

    return {
        contentType,
        contentLength,
        sessionCookieToken,
    };
}
