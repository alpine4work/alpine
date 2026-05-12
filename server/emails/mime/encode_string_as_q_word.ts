const prefix = "=?UTF-8?Q?";
const suffix = "?=";
// 75 chars total per encoded word per RFC 2047 §2.
const maxEncodedWordLength = 75;
const maxPayloadLength = maxEncodedWordLength - prefix.length - suffix.length;

function isSafeAsciiChar(byte: number): boolean {
    // Printable ASCII excluding `=`, `?`, `_`, and space (0x20).
    const unsafeChars = [0x3d, 0x3f, 0x5f];
    return byte >= 0x21 && byte <= 0x7e && !unsafeChars.includes(byte);
}

function encodeQByte(byte: number): string {
    return "=" + byte.toString(16).toUpperCase().padStart(2, "0");
}

/**
 * Encodes a string as an RFC 2047 Q-encoded MIME header value. If the string
 * contains only printable ASCII (no characters that need encoding), it is returned
 * as-is. Otherwise it is wrapped in one or more `=?UTF-8?Q?...?=` encoded words.
 */
export function encodeStringAsQWord(text: string): string {
    // Skip encoding if the string contains only safe printable ASCII.
    let needsEncoding = false;
    for (const byte of new TextEncoder().encode(text)) {
        if (!isSafeAsciiChar(byte) && byte !== 0x20) {
            needsEncoding = true;
            break;
        }
    }
    if (!needsEncoding) return text;

    // Build encoded payload, flushing into a new encoded word when the current one
    // would exceed the maximum length.
    const words: Array<string> = [];
    let payload = "";

    function flushWord(): void {
        if (payload.length > 0) {
            words.push(prefix + payload + suffix);
            payload = "";
        }
    }

    // Iterate over characters rather than bytes so that multi-byte UTF-8 sequences are
    // never split across word boundaries.
    for (const char of text) {
        const charBytes = new TextEncoder().encode(char);
        const token =
            charBytes.length === 1 && charBytes[0] === 0x20
                ? "_"
                : charBytes.length === 1 && isSafeAsciiChar(charBytes[0]!)
                  ? char
                  : Array.from(charBytes).map(encodeQByte).join("");
        if (payload.length + token.length > maxPayloadLength) {
            flushWord();
        }
        payload += token;
    }
    flushWord();

    return words.join(" ");
}
