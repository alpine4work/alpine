import {decodeBytesWithFallback} from "~/server/emails/mime/decode_bytes_with_fallback.js";

function isHexDigit(character?: string): boolean {
    return character !== undefined && /^[0-9A-Fa-f]$/.test(character);
}

/**
 * Decodes `%HH` hexadecimal sequences in a MIME parameter value (RFC 2231 /
 * RFC 5987) to raw octets. Non-percent bytes are taken as Latin-1 code units
 * (0–255).
 */
function decodePercentMarkedHexaecimalSequenceStringToBytes(value: string): Uint8Array {
    const bytes: Array<number> = [];
    if (value.length === 0) {
        return new Uint8Array(bytes);
    }
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        // Check if the character is a percent sign followed by two hexadecimal digits.
        if (
            character === "%" &&
            index + 2 < value.length &&
            isHexDigit(value[index + 1]) &&
            isHexDigit(value[index + 2])
        ) {
            bytes.push(parseInt(value.slice(index + 1, index + 3), 16));
            index += 2;
        } else {
            // Ensure the characters that are not percent-encoded are within the Latin-1 range
            // (0–255) by taking only the lower 8 bits. Each character should be treated as a
            // single byte.
            bytes.push(value.charCodeAt(index) & 0xff);
        }
    }
    return new Uint8Array(bytes);
}

/**
 * Decodes an RFC 2231 extended-parameter value (`charset'language'value` with
 * percent-encoding in the value). If the two single-quote delimiters are missing,
 * the whole string is percent-decoded as UTF-8.
 *
 * For example, you might have these values:
 *
 * "UTF-8'fr-fr'%C3%A9cole.png" -> "école.png" encoded in UTF-8 with the language
 * "fr-fr" (note the language tag is optional, and if present it is ignored).
 *
 * %E6%97%A5%E6%9C%AC%E8%AA%9E%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB.txt ->
 * "日本語ファイル.txt". There's no charset specified nor any single-quote
 * delimiters, so we use the default charset "utf-8".
 */
export function decodeExtendedParameterValue(value: string): string {
    let trimmed = value.trim();
    // eslint-disable-next-line cyberworlds/string-quotes
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        trimmed = trimmed.slice(1, -1);
    }
    // eslint-disable-next-line cyberworlds/string-quotes
    const asciiSingleQuote = "'";
    const firstQuote = trimmed.indexOf(asciiSingleQuote);
    const secondQuote = firstQuote === -1 ? -1 : trimmed.indexOf(asciiSingleQuote, firstQuote + 1);
    if (firstQuote === -1 || secondQuote === -1) {
        const bytes = decodePercentMarkedHexaecimalSequenceStringToBytes(trimmed);
        return new TextDecoder("utf-8", {fatal: false}).decode(bytes);
    }
    const charset = trimmed.slice(0, firstQuote).trim().toLowerCase() || "utf-8";
    const contentPart = trimmed.slice(secondQuote + 1);
    const bytes = decodePercentMarkedHexaecimalSequenceStringToBytes(contentPart);
    return decodeBytesWithFallback(bytes, charset);
}
