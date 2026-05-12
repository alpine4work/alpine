import {decodeBytesWithFallback} from "~/server/emails/mime/decode_bytes_with_fallback.js";
import {InvalidArgumentError} from "~/shared/error/error.js";

function isHexDigit(character: string): boolean {
    return /^[0-9A-Fa-f]$/.test(character);
}

function quotedPrintableHexPairToByte(high: string, low: string): number {
    return parseInt(high + low, 16);
}

/**
 * Decodes RFC 2045 quoted-printable to raw octets. Removes soft line breaks (`=` +
 * CRLF / LF / CR). Literal bytes in the encoded form must be ASCII; code points
 * above 127 outside `=HH` escapes are rejected as they are not correctly encoded.
 */
export function decodeQuotedPrintableToBytes(encoded: string): Uint8Array {
    const decodedOctets: Array<number> = [];
    let characterIndex = 0;

    while (characterIndex < encoded.length) {
        const currentCharacter = encoded[characterIndex]!;

        if (currentCharacter === "=") {
            if (
                characterIndex + 2 < encoded.length &&
                encoded[characterIndex + 1] === "\r" &&
                encoded[characterIndex + 2] === "\n"
            ) {
                characterIndex += 3;
                continue;
            }
            if (characterIndex + 1 < encoded.length && encoded[characterIndex + 1] === "\n") {
                characterIndex += 2;
                continue;
            }
            if (characterIndex + 1 < encoded.length && encoded[characterIndex + 1] === "\r") {
                characterIndex += 2;
                continue;
            }

            const highNibble = encoded[characterIndex + 1];
            const lowNibble = encoded[characterIndex + 2];
            if (highNibble === undefined || lowNibble === undefined) {
                throw new InvalidArgumentError(
                    "Invalid quoted-printable: expected two hex digits or a soft line break after the equals sign",
                );
            }
            if (!isHexDigit(highNibble) || !isHexDigit(lowNibble)) {
                throw new InvalidArgumentError(
                    "Invalid quoted-printable: expected two hex digits or a soft line break after the equals sign",
                );
            }
            decodedOctets.push(quotedPrintableHexPairToByte(highNibble, lowNibble));
            characterIndex += 3;
            continue;
        }

        const codeUnit = encoded.charCodeAt(characterIndex);
        if (codeUnit > 127) {
            throw new InvalidArgumentError(
                "Invalid quoted-printable: non-ASCII character outside of =XX escape",
            );
        }
        decodedOctets.push(codeUnit);
        characterIndex += 1;
    }

    return new Uint8Array(decodedOctets);
}

/**
 * Decodes RFC 2045 quoted-printable into a string using the given charset label
 * for `TextDecoder`. Removes soft line breaks (`=` + CRLF / LF / CR). Literal
 * bytes in the encoded form must be ASCII; code points above 127 outside `=HH`
 * escapes are rejected. If the charset label is invalid, falls back to UTF-8
 * decoding of the octets.
 */
export function decodeQuotedPrintable(encoded: string, charset: string = "utf-8"): string {
    const bytes = decodeQuotedPrintableToBytes(encoded);
    return decodeBytesWithFallback(bytes, charset);
}
