import {decodeBytesWithFallback} from "~/server/emails/mime/decode_bytes_with_fallback.js";
import {decodeEncodedWords} from "~/server/emails/mime/decode_encoded_words.js";
import {
    decodeQuotedPrintable,
    decodeQuotedPrintableToBytes,
} from "~/server/emails/mime/decode_quoted_printable.js";
import {getAttachmentFilenameFromMimeHeaders} from "~/server/emails/mime/get_attachment_filename_from_mime_headers.js";
import {CRLF, LF, reservedMimeHeaders} from "~/server/emails/mime/mime_constants.js";
import {
    parseSemicolonSeparatedHeaderParameters,
    semicolonSeparatedHeaderLeadingTokenParameterName,
} from "~/server/emails/mime/parse_content_disposition_parameters.js";
import {parseEmailAddressListHeader} from "~/server/emails/mime/parse_email_address_list_header.js";
import type {EmailMessage} from "~/shared/emails/email_message.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {decodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

type MimePart = {
    headers: Map<string, string>;
    body: string;
};

// Limits stack depth when nested `multipart/*` parts recurse into
// `processMixedPart` since a malicious email could have an infinitely nested
// multipart structure.
const maxMimeMultipartNestedDepth = 32;

// Normalize CRLF to LF then split, so callers don't need to handle both.
function splitLines(text: string): Array<string> {
    return text.replaceAll(CRLF, LF).split(LF);
}

// Strip CRLF/LF line breaks inserted by base64 76-char line wrapping.
function stripLineBreaks(s: string): string {
    const lineBreakRegex = new RegExp(`[${CRLF}]`, "g");
    return s.replaceAll(lineBreakRegex, "");
}

function splitHeadersAndBody(payload: string): {headers: string; body: string} {
    // Headers and body are separated by a blank line (CRLF CRLF or LF LF).
    const crlfIndex = payload.indexOf(CRLF + CRLF);
    const lfIndex = payload.indexOf(LF + LF);

    let splitIndex: number;
    let separatorLength: number;

    if (crlfIndex !== -1 && (lfIndex === -1 || crlfIndex <= lfIndex)) {
        splitIndex = crlfIndex;
        separatorLength = 4;
    } else {
        assert(lfIndex !== -1, "Expected blank line separating headers from body");
        splitIndex = lfIndex;
        separatorLength = 2;
    }

    return {
        headers: payload.slice(0, splitIndex),
        body: payload.slice(splitIndex + separatorLength),
    };
}

function parseHeaders(rawHeaders: string): Map<string, string> {
    const map = new Map<string, string>();
    // Unfold header continuations (a line starting with whitespace is a continuation
    // of the previous header value).
    const unfolded: Array<string> = [];
    for (const line of splitLines(rawHeaders)) {
        if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
            unfolded[unfolded.length - 1] += " " + line.trim();
        } else {
            unfolded.push(line);
        }
    }
    for (const line of unfolded) {
        const colon = line.indexOf(":");
        if (colon === -1) continue;
        const name = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();
        map.set(name, value);
    }
    return map;
}

function decodeBase64String(content: string, charset?: string): string {
    return decodeBytesWithFallback(decodeBase64(stripLineBreaks(content)), charset);
}

function decodeBase64Bytes(encoded: string): Uint8Array {
    return new Uint8Array(decodeBase64(stripLineBreaks(encoded)).buffer);
}

function parsePart(raw: string): MimePart {
    const {headers: rawHeaders, body} = splitHeadersAndBody(raw);
    return {headers: parseHeaders(rawHeaders), body};
}

function getContentType(headers: Map<string, string>): {
    type: string;
    boundary?: string;
    charset?: string;
} {
    const raw = headers.get("content-type") ?? "text/plain";
    const headerParameters = parseSemicolonSeparatedHeaderParameters(raw);
    let type = "text/plain";
    let boundary: string | undefined;
    let charset: string | undefined;
    for (const {name, value} of headerParameters) {
        if (name === semicolonSeparatedHeaderLeadingTokenParameterName) {
            type = value.toLowerCase();
            continue;
        }
        if (name === "boundary") {
            boundary = value;
        } else if (name === "charset") {
            charset = value;
        }
    }
    return {type, boundary, charset};
}

function splitMultipart(body: string, boundary: string): Array<string> {
    const delimiter = `--${boundary}`;
    const closingDelimiter = `${delimiter}--`;
    const parts: Array<string> = [];
    const lines = splitLines(body);
    let current: Array<string> = [];
    let inside = false;

    for (const line of lines) {
        // Trim trailing \r in case the body used CRLF and splitLines left it.
        const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (trimmed === closingDelimiter) {
            if (inside) parts.push(current.join(CRLF));
            return parts;
        }
        if (trimmed === delimiter) {
            if (inside) parts.push(current.join(CRLF));
            current = [];
            inside = true;
            continue;
        }
        if (inside) {
            current.push(line);
        }
    }

    // Truncated messages sometimes omit the closing `--boundary--`; still emit the
    // last part that was being accumulated.
    if (inside) {
        parts.push(current.join(CRLF));
    }
    return parts;
}

function decodeAttachmentBodyToUint8Array(part: MimePart): Uint8Array {
    const encoding = (part.headers.get("content-transfer-encoding") ?? "").toLowerCase().trim();
    switch (encoding) {
        case "base64":
            return decodeBase64Bytes(part.body);
        case "quoted-printable":
            return new Uint8Array(decodeQuotedPrintableToBytes(part.body));
        case "7bit":
        case "8bit":
        case "binary":
        case "":
        default:
            // This uses latin1 encoding to ensure the bytes are treated as a string of raw
            // octets.
            const buf = Buffer.from(part.body, "latin1");
            return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
}

/**
 * Parses an RFC 5322 / MIME email message string into an `EmailMessage` object.
 * Handles `text/plain`, `multipart/alternative`, `multipart/mixed`, and
 * `multipart/related` structures as produced by
 * `serializeEmailMessageToMimeString` and by common email clients.
 */
export function deserializeMimeStringToEmailMessage(raw: string): EmailMessage {
    const {headers, body} = splitHeadersAndBody(raw);
    const headerMap = parseHeaders(headers);

    const toRaw = decodeEncodedWords(headerMap.get("to") ?? "");
    const ccRaw = decodeEncodedWords(headerMap.get("cc") ?? "");
    const bccRaw = decodeEncodedWords(headerMap.get("bcc") ?? "");
    const fromRaw = decodeEncodedWords(headerMap.get("from") ?? "");
    const replyToRaw = decodeEncodedWords(headerMap.get("reply-to") ?? "");
    const subject = decodeEncodedWords(headerMap.get("subject") ?? "");

    const to = parseEmailAddressListHeader(toRaw);
    const cc = parseEmailAddressListHeader(ccRaw);
    const bcc = parseEmailAddressListHeader(bccRaw);
    const from = assertExists(
        parseEmailAddressListHeader(fromRaw)[0],
        "Expected From header to contain a valid email address",
    );
    const replyTo = parseEmailAddressListHeader(replyToRaw);

    const extraHeaders = [...headerMap.entries()]
        .filter(([name]) => !reservedMimeHeaders.has(name))
        .map(([name, value]) => ({name, value: decodeEncodedWords(value)}));

    let textBody = "";
    let htmlBody: string | undefined;
    const attachments: Array<EmailMessage["attachments"][number]> = [];

    function processTextPart(part: MimePart): void {
        const encoding = part.headers.get("content-transfer-encoding") ?? "";
        const {type, charset} = getContentType(part.headers);

        let content = "";
        switch (encoding.toLowerCase()) {
            case "base64":
                content = decodeBase64String(part.body, charset);
                break;
            case "quoted-printable":
                content = decodeQuotedPrintable(part.body, charset);
                break;
            default:
                content = part.body;
        }
        if (type === "text/html") {
            htmlBody = content;
        } else {
            textBody = content;
        }
    }

    function processAttachmentPart(part: MimePart): void {
        const rawContentType = part.headers.get("content-type") ?? "application/octet-stream";
        const {type} = getContentType(part.headers);
        const contentDisposition = part.headers.get("content-disposition");
        const filename = getAttachmentFilenameFromMimeHeaders(rawContentType, contentDisposition);
        const content = decodeAttachmentBodyToUint8Array(part);
        attachments.push({
            filename,
            content,
            contentType: type,
            size: content.length,
        });
    }

    function processAlternativePart(body: string, boundary: string): void {
        for (const rawPart of splitMultipart(body, boundary)) {
            const part = parsePart(rawPart);
            const {type} = getContentType(part.headers);
            if (type === "text/plain" || type === "text/html") {
                processTextPart(part);
            }
        }
    }

    function processMixedPart(body: string, boundary: string, nestedDepth: number = 0): void {
        if (nestedDepth > maxMimeMultipartNestedDepth) {
            throw new InvalidArgumentError(
                `Multipart nesting exceeds maximum depth (${maxMimeMultipartNestedDepth})`,
            );
        }
        const parts = splitMultipart(body, boundary);
        for (const rawPart of parts) {
            const part = parsePart(rawPart);
            const {type, boundary: innerBoundary} = getContentType(part.headers);
            const contentDisposition = part.headers.get("content-disposition") ?? "";
            const isAttachment = contentDisposition.toLowerCase().startsWith("attachment");

            if (isAttachment) {
                processAttachmentPart(part);
            } else if (type === "multipart/alternative" && innerBoundary) {
                processAlternativePart(part.body, innerBoundary);
            } else if (type === "text/plain" || type === "text/html") {
                processTextPart(part);
            } else if (innerBoundary) {
                // Unknown multipart type, try to recurse.
                processMixedPart(part.body, innerBoundary, nestedDepth + 1);
            } else {
                // Treat anything else with a filename/disposition as an attachment.
                processAttachmentPart(part);
            }
        }
    }

    const mainPart = parsePart(`${headers}${CRLF}${CRLF}${body}`);
    const {type: mainType, boundary: mainBoundary} = getContentType(mainPart.headers);

    switch (mainType) {
        case "text/plain":
        case "text/html":
            processTextPart(mainPart);
            break;
        // multipart/alternative: used by HTML emails with plain text and HTML versions.
        case "multipart/alternative":
            assert(mainBoundary !== undefined, "Expected boundary for multipart/alternative");
            processAlternativePart(body, mainBoundary);
            break;
        // multipart/mixed: used by emails with mixed content (e.g. plain text and
        // attachments or nested multipart/alternative).
        case "multipart/mixed":
            assert(mainBoundary !== undefined, "Expected boundary for multipart/mixed");
            processMixedPart(body, mainBoundary);
            break;
        // multipart/related (RFC 2387): used by HTML emails with inline images. The first
        // part is the body (often multipart/alternative), subsequent parts are related
        // resources (e.g. inline images). It acts like multipart/mixed - the body
        // extractor recurses into nested multipart/alternative as needed.
        case "multipart/related":
            assert(mainBoundary !== undefined, "Expected boundary for multipart/related");
            processMixedPart(body, mainBoundary);
            break;
        default:
            throw new InvalidArgumentError(`Unsupported MIME content type: ${mainType}`);
    }

    return {
        to,
        cc,
        bcc,
        from,
        replyTo,
        subject,
        body: {text: textBody, html: htmlBody},
        headers: extraHeaders,
        attachments,
    };
}
