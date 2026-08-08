import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {Schema, type SchemaType} from "~/shared/schema/schema.open_source.js";

export const pageDiffSpanSchema = Schema.object({
    offset: Schema.integer,
    data: Schema.bytes,
});

export type PageDiffSpan = SchemaType<typeof pageDiffSpanSchema>;

export const pageDiffSchema = Schema.array(pageDiffSpanSchema);

export type PageDiff = SchemaType<typeof pageDiffSchema>;

// Maximum gap between two changed regions before they are merged into a single
// span. Each span carries fixed overhead (offset integer + array framing), so
// merging small gaps saves more on framing than it costs in extra bytes.
const coalesceGap = 8;

/**
 * Computes the byte-level diff between two same-length page buffers. Returns an
 * array of changed spans. Adjacent spans separated by {@link coalesceGap} or fewer
 * unchanged bytes are merged.
 */
export function diffPage(before: Uint8Array, after: Uint8Array): PageDiff {
    assert(before.byteLength === after.byteLength, "diffPage: buffers must be the same length");

    const spans: Array<PageDiffSpan> = [];
    const length = before.byteLength;
    let i = 0;

    while (i < length) {
        // Skip unchanged bytes.
        if (before[i] === after[i]) {
            i++;
            continue;
        }

        // Start of a changed region.
        const start = i;
        i++;

        // Extend through changed bytes, coalescing small gaps of unchanged bytes.
        while (i < length) {
            if (before[i] !== after[i]) {
                i++;
                continue;
            }

            // Found an unchanged byte. Scan ahead to see how long the gap is.
            let gapEnd = i + 1;
            while (gapEnd < length && before[gapEnd] === after[gapEnd]) {
                gapEnd++;
            }

            if (gapEnd < length && gapEnd - i <= coalesceGap) {
                // Gap is small and there's more change after it — absorb it into the span.
                i = gapEnd + 1;
            } else {
                // Gap is large or we hit the end — emit the span up to the gap start.
                break;
            }
        }

        spans.push({offset: start, data: after.slice(start, i)});
    }

    return spans;
}

/**
 * Applies a diff to a base page, returning the result. Does not mutate `base`.
 */
export function applyPageDiff(base: Uint8Array, diff: PageDiff): Uint8Array {
    const result = new Uint8Array(base);
    for (const span of diff) {
        result.set(span.data, span.offset);
    }
    return result;
}

// Byte ranges in SQLite page 1 (0-indexed page 0) that change on every write
// transaction but carry no user-visible data: offset 24: file change counter (4
// bytes) offset 92: version-valid-for number (4 bytes)
const noiseRegions: ReadonlyArray<{start: number; end: number}> = [
    {start: 24, end: 28},
    {start: 92, end: 96},
];

/**
 * Returns true if the diff for this page only touches regions that change on every
 * write but carry no user-visible data (SQLite change counters on page 0). Used to
 * suppress reactive query invalidation for noise-only changes.
 */
export function shouldIgnorePageInvalidation(pageIndex: number, diff: PageDiff): boolean {
    if (pageIndex !== 0) return false;

    for (const span of diff) {
        const spanEnd = span.offset + span.data.byteLength;
        const inNoise = noiseRegions.some(r => span.offset >= r.start && spanEnd <= r.end);
        if (!inNoise) return false;
    }

    return true;
}
