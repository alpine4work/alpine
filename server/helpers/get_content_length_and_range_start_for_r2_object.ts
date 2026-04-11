/**
 * Get the content length and content range for a Cloudflare R2 object.
 *
 * If the object was not fetched with a range or the range is the entire file,
 * range start will be 0 and the content length will be the same as the object
 * size.
 */
export function getContentLengthAndRangeStartForR2Object({
    size,
    range,
}: {
    size: number;
    range?: {suffix: number} | {offset?: number; length?: number};
}): {
    contentRange: string;
    contentLength: number;
    isRangeSatisfiable: boolean;
} {
    let rangeStart = 0;
    let contentLength = size;

    if (range) {
        if ("suffix" in range) {
            // Per RFC 7233 §2.1: if the suffix-length exceeds the representation length, use
            // the entire representation.
            rangeStart = Math.max(0, size - range.suffix);
            contentLength = size - rangeStart;
        } else {
            const offset = range.offset ?? 0;
            rangeStart = offset;
            contentLength = range.length ?? size - offset;
        }
    }

    const isRangeSatisfiable = rangeStart + contentLength <= size;

    // Per RFC 7233 §4.4: unsatisfiable range responses should use the format
    // `bytes */[complete-length]` as the `Content-Range` header.
    const contentRange = isRangeSatisfiable
        ? `bytes ${rangeStart}-${rangeStart + contentLength - 1}/${size}`
        : `bytes */${size}`;

    return {
        contentRange,
        contentLength,
        isRangeSatisfiable,
    };
}
