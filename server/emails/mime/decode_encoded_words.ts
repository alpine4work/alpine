import {decodeBytesWithFallback} from "~/server/emails/mime/decode_bytes_with_fallback.js";
import {decodeBase64} from "~/shared/helpers/binary/base64.open_source.js";

/**
 * Decodes Q-encoded payload octets (RFC 2047 §4.2).
 */
function decodeQEncodedPayloadToBytes(payload: string): Uint8Array {
    const bytes: Array<number> = [];
    let index = 0;
    while (index < payload.length) {
        if (payload[index] === "_") {
            // SPACE character.
            bytes.push(0x20);
            index++;
        } else if (payload[index] === "=" && index + 2 < payload.length) {
            const hex = payload.slice(index + 1, index + 3);
            const octet = parseInt(hex, 16);
            // If the hex pair is invalid, return the character code of the equals sign,
            // otherwise return the lowest 8 bits of the octet to ensure it is a single byte.
            bytes.push(Number.isNaN(octet) ? payload.charCodeAt(index) : octet & 0xff);
            index += 3;
        } else {
            // Return the lowest 8 bits of the character code to ensure it is a single byte.
            bytes.push(payload.charCodeAt(index) & 0xff);
            index++;
        }
    }
    return new Uint8Array(bytes);
}

function decodeEncodedWordToString(
    charset: string,
    encodingRaw: string,
    payload: string,
): string | null {
    const encoding = encodingRaw.trim().toUpperCase();

    // Q-encoding (RFC 2047 §4.2).
    if (encoding === "Q") {
        const bytes = decodeQEncodedPayloadToBytes(payload);
        return decodeBytesWithFallback(bytes, charset);
    }

    // B-encoding (RFC 2047 §4.3). AKA base64 encoding.
    if (encoding === "B") {
        const compact = payload.replace(/\s+/g, "");
        try {
            const bytes = decodeBase64(compact);
            return decodeBytesWithFallback(bytes, charset);
        } catch {
            return null;
        }
    }

    return null;
}

/**
 * Decodes RFC 2047 encoded words (`=?charset?Q?...?=` and `=?charset?B?...?=`)
 * used in MIME-formatted email headers, which usually occurs when the header value
 * contains non-ASCII characters. Literal text outside encoded words is left
 * unchanged and whitespace between adjacent encoded words is dropped per RFC 2047
 * §6.2.
 *
 * Unsupported `encoding` tokens leave the full `=?...?=` span unchanged.
 */
export function decodeEncodedWords(text: string): string {
    const result: Array<string> = [];
    let index = 0;

    while (index < text.length) {
        const start = text.indexOf("=?", index);
        if (start === -1) {
            result.push(text.slice(index));
            break;
        }

        if (start > index) {
            result.push(text.slice(index, start));
        }

        const charsetEnd = text.indexOf("?", start + 2);
        if (charsetEnd === -1) {
            result.push(text.slice(start));
            break;
        }
        const encodingEnd = text.indexOf("?", charsetEnd + 1);
        if (encodingEnd === -1) {
            result.push(text.slice(start));
            break;
        }
        const payloadEnd = text.indexOf("?=", encodingEnd + 1);
        if (payloadEnd === -1) {
            result.push(text.slice(start));
            break;
        }

        const charsetRaw = text.slice(start + 2, charsetEnd).trim();
        const encodingRaw = text.slice(charsetEnd + 1, encodingEnd);
        const payload = text.slice(encodingEnd + 1, payloadEnd);
        const fullToken = text.slice(start, payloadEnd + 2);

        const decoded = decodeEncodedWordToString(charsetRaw, encodingRaw, payload);
        if (decoded === null) {
            result.push(fullToken);
        } else {
            result.push(decoded);
        }

        index = payloadEnd + 2;

        // Skip over whitespace between adjacent encoded words, they are not part of the
        // payload.
        if (index < text.length && (text[index] === " " || text[index] === "\t")) {
            const next = text.indexOf("=?", index);
            if (next !== -1 && text.slice(index, next).trim() === "") {
                index = next;
            }
        }
    }

    return result.join("");
}
