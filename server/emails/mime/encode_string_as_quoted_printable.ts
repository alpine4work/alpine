import {CRLF} from "~/server/emails/mime/mime_constants.js";

// RFC 2045 §6.7: encoded lines must not exceed 76 characters (excluding the CRLF
// that terminates the physical line in transport; soft breaks use `=` + CRLF).
const quotedPrintableMaximumEncodedLineLength = 76;

/**
 * Returns true when the octet may appear as a single ASCII character in
 * quoted-printable (RFC 2045 §6.7, printable characters excluding SPACE, TAB, and
 * `=`). SPACE and TAB are always emitted as `=20` / `=09` so encoded lines never
 * end with a literal space or tab.
 */
function encodesAsSingleQuotedPrintableCharacter(byte: number): boolean {
    return (byte >= 33 && byte <= 60) || (byte >= 62 && byte <= 126);
}

function quotedPrintableHexByte(byte: number): string {
    return "=" + byte.toString(16).toUpperCase().padStart(2, "0");
}

/**
 * Encodes a string as RFC 2045 quoted-printable. Input is encoded as UTF-8 octets.
 * Inserts soft line breaks (`=` + CRLF) so no encoded line exceeds 76 characters.
 *
 * Prefer encoding with base64 instead if you don't need a human-readable string.
 */
export function encodeStringAsQuotedPrintable(text: string): string {
    const utf8Bytes = new TextEncoder().encode(text);
    const outputPieces: Array<string> = [];
    let encodedLineLength = 0;

    function emitQuotedPrintableSoftLineBreak(): void {
        outputPieces.push("=");
        outputPieces.push(CRLF);
        encodedLineLength = 0;
    }

    function wouldExceedMaximumEncodedLineLength(tokenLength: number): boolean {
        return encodedLineLength + tokenLength > quotedPrintableMaximumEncodedLineLength;
    }

    for (let byteIndex = 0; byteIndex < utf8Bytes.length; byteIndex++) {
        const byte = utf8Bytes[byteIndex]!;
        const token = encodesAsSingleQuotedPrintableCharacter(byte)
            ? String.fromCharCode(byte)
            : quotedPrintableHexByte(byte);

        if (wouldExceedMaximumEncodedLineLength(token.length)) {
            emitQuotedPrintableSoftLineBreak();
        }

        outputPieces.push(token);
        encodedLineLength += token.length;
    }

    return outputPieces.join("");
}
