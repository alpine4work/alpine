/**
 * Decodes a byte array to a string using the specified charset. If the charset
 * label is invalid or we're not able to decode it, we fallback to UTF-8. If we do
 * fall back to UTF-8, we don't treat invalid characters as errors and instead
 * replace them with U+FFFD (replacement character).
 */
export function decodeBytesWithFallback(bytes: Uint8Array, charset: string = "utf-8"): string {
    try {
        return new TextDecoder(charset).decode(bytes);
    } catch {
        // Fallback to UTF-8 if the charset label is invalid or we're not able to decode
        // it. Since this is a fallback on an unknown charset, we may replace characters we
        // can't decode with U+FFFD.
        return new TextDecoder("utf-8", {fatal: false}).decode(bytes);
    }
}
