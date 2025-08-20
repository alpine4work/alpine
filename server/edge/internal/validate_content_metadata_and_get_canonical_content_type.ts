import prettyBytes from "pretty-bytes";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {
    FileContentType,
    canonicalizeFileContentTypeIfExists,
} from "~/shared/files/file_content_type.js";
import {quote} from "~/shared/helpers/string/quote.js";

export function validateContentMetadataAndGetCanonicalContentType({
    originalContentType,
    contentLength,
}: {
    originalContentType: string;
    contentLength: number;
}): FileContentType {
    const contentType = canonicalizeFileContentTypeIfExists(originalContentType);

    if (contentType === null) {
        throw new InvalidArgumentError(quote`Unsupported \`Content-Type\` ${originalContentType}`);
    }

    // If `Content-Length` is 0 there's probably a bug somewhere and data isn't reaching
    // `EdgeService`.
    if (contentLength <= 0) {
        throw new InvalidArgumentError(
            `Can’t upload file with \`Content-Length\` of ${prettyBytes(contentLength)}`,
        );
    }

    return contentType;
}
