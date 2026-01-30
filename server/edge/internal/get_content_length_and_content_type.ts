import prettyBytes from "pretty-bytes";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {
    FileContentType,
    canonicalizeFileContentTypeIfExists,
} from "~/shared/files/file_content_type.js";
import {quote} from "~/shared/helpers/string/quote.js";

export function getContentLengthAndCanonicalContentType(request: Request): {
    contentType: FileContentType;
    contentLength: number;
} {
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
            `Can\u2019t upload file with \`Content-Length\` of ${prettyBytes(contentLength)}`,
        );
    }

    return {contentType, contentLength};
}
