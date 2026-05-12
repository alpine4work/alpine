import {decodeEncodedWords} from "~/server/emails/mime/decode_encoded_words.js";
import {decodeExtendedParameterValue} from "~/server/emails/mime/decode_extended_parameter_value.js";
import {parseSemicolonSeparatedHeaderParameters} from "~/server/emails/mime/parse_content_disposition_parameters.js";

// Assembles an RFC 2231 §3 multi-segment parameter continuation for `baseName`
// (e.g. "filename" or "name" used for attachment filenames) used when the value
// was too long to fit in a single segment. Collects all `baseName*N` and
// `baseName*N*` params, sorts them by index, and concatenates the decoded
// segments. The charset from the first extended segment's `charset'language'value`
// prefix applies to all subsequent extended segments. Returns undefined if no
// continuation segments are found.
function assembleParameterContinuation(
    params: Array<{name: string; value: string}>,
    baseName: string,
): string | undefined {
    // Starts with the base name, followed by an asterisk, then one or more digits,
    // optionally ending with an asterisk. Captures the digits and the optional star.
    const continuationRegex = new RegExp(`^${baseName}\\*(\\d+)(\\*?)$`);
    const segments = new Map<number, {value: string; isExtended: boolean}>();
    for (const {name, value} of params) {
        const match = name.match(continuationRegex);
        if (match?.[1]) {
            segments.set(parseInt(match[1]), {value, isExtended: match[2] === "*"});
        }
    }
    if (segments.size === 0) return undefined;

    const sortedIndices = [...segments.keys()].sort((a, b) => a - b);
    let charset = "utf-8";
    const decodedParts: Array<string> = [];

    for (const index of sortedIndices) {
        const {value, isExtended} = segments.get(index)!;
        if (index === 0 && isExtended) {
            // Segment 0 extended: may carry a `charset'language'value` prefix. Extract the
            // charset for use by subsequent extended segments, then decode via the existing
            // helper (which handles the full prefix format).
            // eslint-disable-next-line cyberworlds/string-quotes
            const firstQuote = value.indexOf("'");
            // eslint-disable-next-line cyberworlds/string-quotes
            const secondQuote = firstQuote === -1 ? -1 : value.indexOf("'", firstQuote + 1);
            if (firstQuote !== -1 && secondQuote !== -1) {
                charset = value.slice(0, firstQuote).toLowerCase() || "utf-8";
            }
            decodedParts.push(decodeExtendedParameterValue(value));
        } else if (isExtended) {
            // Subsequent extended segments have no charset prefix; prepend the charset so
            // decodeExtendedParameterValue can handle the percent-decoding correctly.
            // eslint-disable-next-line cyberworlds/string-quotes
            decodedParts.push(decodeExtendedParameterValue(`${charset}''${value}`));
        } else {
            // Non-extended (unstarred) continuation segments are literal strings.
            decodedParts.push(value);
        }
    }

    return decodedParts.join("");
}

/**
 * Resolves an attachment filename from Content-Disposition or Content-Type
 * headers, including extended parameters `filename*` / `name*` when present. If
 * both headers are present, the Content-Disposition header takes precedence.
 *
 * Extended parameter format is typically used if the filename contains non-ASCII
 * characters.
 */
export function getAttachmentFilenameFromMimeHeaders(
    contentType: string,
    contentDisposition?: string,
): string {
    if (contentDisposition !== undefined) {
        const contentDispositionParams =
            parseSemicolonSeparatedHeaderParameters(contentDisposition);
        for (const {name, value} of contentDispositionParams) {
            // If there is no digit after the asterisk, it's not a continuation segment, parse
            // it as an extended parameter.
            if (name === "filename*") {
                return decodeExtendedParameterValue(value);
            }
        }
        const continuationFilename = assembleParameterContinuation(
            contentDispositionParams,
            "filename",
        );
        if (continuationFilename !== undefined) {
            return continuationFilename;
        }
        for (const {name, value} of contentDispositionParams) {
            if (name === "filename") {
                return decodeEncodedWords(value);
            }
        }
    }
    // If the Content-Disposition header is not present, we can try to extract the
    // filename from the Content-Type header.
    const contentTypeParams = parseSemicolonSeparatedHeaderParameters(contentType);
    for (const {name, value} of contentTypeParams) {
        // If there is no digit after the asterisk, it's not a continuation segment, parse
        // it as an extended parameter.
        if (name === "name*") {
            return decodeExtendedParameterValue(value);
        }
    }

    const continuationName = assembleParameterContinuation(contentTypeParams, "name");
    if (continuationName !== undefined) {
        return continuationName;
    }
    for (const {name, value} of contentTypeParams) {
        if (name === "name") {
            return decodeEncodedWords(value);
        }
    }
    // If we can't find a filename, use a default.
    return "attachment";
}
