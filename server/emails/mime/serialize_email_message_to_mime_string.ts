import {encodeStringAsQWord} from "~/server/emails/mime/encode_string_as_q_word.js";
import {CRLF, reservedMimeHeaders} from "~/server/emails/mime/mime_constants.js";
import type {EmailMessage} from "~/shared/emails/email_message.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

// RFC 2045 §6.8: base64 lines must be no more than 76 characters.
const base64LineLength = 76;

// Bytes that may appear as a single literal character in our RFC 2231 filename
// encoding (each UTF-8 byte is checked as a code unit in 0x00–0xff).
const allowedFilenameBytesCharset = /^[0-9A-Za-z._-]$/;

// Percent-encodes a filename using UTF-8 bytes for use in RFC 2231 extended
// parameter values. Only alphanumeric characters and `-`, `_`, `.` are left
// unencoded; everything else is emitted as `%HH`.
function encodeFilenameWithPercentEncoding(filename: string): string {
    const utf8Bytes = new TextEncoder().encode(filename);
    let encoded = "";
    for (const byte of utf8Bytes) {
        const asCharacter = String.fromCharCode(byte);
        encoded += allowedFilenameBytesCharset.test(asCharacter)
            ? asCharacter
            : "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }
    return `UTF-8''${encoded}`; // eslint-disable-line cyberworlds/string-quotes
}

// True when the filename contains a non-ASCII code point.
function filenameHasNonAscii(filename: string): boolean {
    // eslint-disable-next-line no-control-regex
    return /[^\x00-\x7f]/.test(filename);
}

// The MIME boundary string must not be present in the message body or attachment
// names. Since we use the message id + timestamp encoded as base64 as the boundary
// this should never happen, but we check just in case because if it did it would
// result in a completely broken message.
function assertMimeBoundaryNotInPayload(
    boundary: string,
    {text, html, filenames}: {text: string; html?: string; filenames: Array<string>},
) {
    const message =
        "MIME boundary string cannot be present in the message body or attachment names";
    if (text.includes(boundary)) {
        throw new InvalidArgumentError(message);
    }
    if (html !== undefined && html.includes(boundary)) {
        throw new InvalidArgumentError(message);
    }
    for (const filename of filenames) {
        if (filename.includes(boundary)) {
            throw new InvalidArgumentError(message);
        }
    }
}

function formatLineLength(encoded: string): string {
    const lines: Array<string> = [];
    for (let i = 0; i < encoded.length; i += base64LineLength) {
        lines.push(encoded.slice(i, i + base64LineLength));
    }
    return lines.join(CRLF);
}

export function encodeAndFormatTextForMime(text: string): string {
    const encoder = new TextEncoder();
    return formatLineLength(encodeBase64(encoder.encode(text)));
}

// Generate a MIME boundary string used to separate multipart parts. Uses
// Rfc4648Url to avoid restricted characters.
export function generateBoundary(boundaryString: string): string {
    return encodeBase64(new TextEncoder().encode(boundaryString), "Rfc4648Url");
}

/**
 * Serializes an `EmailMessage` to the RFC 5322 Internet Message Format string.
 * Multipart bodies (HTML alternative, attachments) are encoded with MIME per
 * RFC 2045. Body content and attachments use base64 transfer encoding to support
 * non-ASCII characters.
 *
 * The email message must always include a plain text component, either as the only
 * component or as an alternative to an HTML component. If an HTML component is
 * present, the plain text component will be treated as an alternative fallback for
 * clients that don't support HTML.
 *
 * Be careful with including the BCC header and make sure to verify that the
 * provider receiving the message strips it out before delivering the message to
 * the recipient. As of May 2026, it is safe to include the BCC header for messages
 * sent to Gmail as they will strip it out before delivering the message to the
 * recipient.
 *
 * Can optionally provide a string to include in the MIME boundary strings, however
 * the string must not be present anywhere in the message body. Generally you can
 * leave this blank and the boundary will be generated automatically from the
 * message id and timestamp.
 */
export function serializeEmailMessageToMimeString(
    message: EmailMessage & {id: string},
    {messageTimestamp}: {messageTimestamp?: number} = {},
): string {
    const {to, cc, bcc, replyTo, from, subject, body, headers, attachments} = message;

    // Strip out any headers that are reserved by MIME. Developers shouldn't set these
    // manually anyway, these get set automatically based on the message content.
    const safeHeaders = headers.filter(
        header => !reservedMimeHeaders.has(header.name.toLowerCase()),
    );

    const timestamp = messageTimestamp ?? Date.now();
    const senderDomain = String(from).split("@")[1] ?? "mail.alpine.inc";

    const baseHeaders = [
        // Date.toUTCString() produces "GMT" as the timezone, but RFC 5322 §3.3 requires
        // numeric zone offsets (+0000/-0000).
        `Date: ${new Date(timestamp).toUTCString().replace("GMT", "+0000")}`,
        `From: ${from}`,
        `To: ${to.join(", ")}`,
        ...(cc !== undefined && cc.length > 0 ? [`Cc: ${cc.join(", ")}`] : []),
        ...(bcc !== undefined && bcc.length > 0 ? [`Bcc: ${bcc.join(", ")}`] : []),
        ...(replyTo !== undefined && replyTo.length > 0 ? [`Reply-To: ${replyTo.join(", ")}`] : []),
        // Any non-ASCII characters in the subject must be encoded as MIME Q-encoded words.
        `Subject: ${encodeStringAsQWord(subject)}`,
        `MIME-Version: 1.0`,
        `Message-ID: <${message.id}@${senderDomain}>`,
        `X-Alpine-Message-Id: ${message.id}`,
        ...safeHeaders.map(header => `${header.name}: ${encodeStringAsQWord(header.value)}`),
    ];

    const boundaryPrefix = `boundary_${message.id}_${timestamp}`;

    const alternativeBoundary = generateBoundary(`${boundaryPrefix}_alternative`);

    assertMimeBoundaryNotInPayload(alternativeBoundary, {
        text: body.text,
        html: body.html,
        filenames: attachments.map(a => a.filename),
    });

    const plainTextPart = [
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: base64`,
        ``,
        encodeAndFormatTextForMime(body.text),
    ];

    const htmlPart =
        body.html !== undefined
            ? [
                  `Content-Type: text/html; charset=utf-8`,
                  `Content-Transfer-Encoding: base64`,
                  ``,
                  encodeAndFormatTextForMime(assertExists(body.html)),
              ]
            : null;

    const hasAttachments = attachments.length > 0;

    // Plain text only message.
    if (!htmlPart && !hasAttachments) {
        return [
            ...baseHeaders,
            `Content-Type: text/plain; charset=utf-8`,
            `Content-Transfer-Encoding: base64`,
            ``,
            encodeAndFormatTextForMime(body.text),
        ].join(CRLF);
    }

    // HTML with plain text alternative without attachments.
    if (htmlPart && !hasAttachments) {
        return [
            ...baseHeaders,
            `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
            ``,
            `--${alternativeBoundary}`,
            ...plainTextPart,
            `--${alternativeBoundary}`,
            ...htmlPart,
            `--${alternativeBoundary}--`,
        ].join(CRLF);
    }

    // Has attachments — use multipart/mixed as the outer envelope. The body section is
    // either a plain text part or a multipart/alternative part when HTML is also
    // present.
    const bodyPart = htmlPart
        ? [
              `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
              ``,
              `--${alternativeBoundary}`,
              ...plainTextPart,
              `--${alternativeBoundary}`,
              ...htmlPart,
              `--${alternativeBoundary}--`,
          ]
        : plainTextPart;

    const mixedBoundary = generateBoundary(`${boundaryPrefix}_mixed`);

    assertMimeBoundaryNotInPayload(mixedBoundary, {
        text: body.text,
        html: body.html,
        filenames: attachments.map(a => a.filename),
    });

    const attachmentParts = attachments.flatMap(attachment => {
        const needsRfc2231 = filenameHasNonAscii(attachment.filename);
        // Use RFC 2231 extended parameter syntax for non-ASCII filenames (RFC 5987).
        const contentTypeFilenameParam = needsRfc2231
            ? `name*=${encodeFilenameWithPercentEncoding(attachment.filename)}`
            : `name="${attachment.filename}"`;
        const dispositionFilenameParam = needsRfc2231
            ? `filename*=${encodeFilenameWithPercentEncoding(attachment.filename)}`
            : `filename="${attachment.filename}"`;
        return [
            `--${mixedBoundary}`,
            `Content-Type: ${attachment.contentType}; ${contentTypeFilenameParam}`,
            `Content-Transfer-Encoding: base64`,
            `Content-Disposition: attachment; ${dispositionFilenameParam}`,
            ``,
            formatLineLength(encodeBase64(new Uint8Array(attachment.content))),
        ];
    });

    return [
        ...baseHeaders,
        `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
        ``,
        `--${mixedBoundary}`,
        ...bodyPart,
        ...attachmentParts,
        `--${mixedBoundary}--`,
    ].join(CRLF);
}
