import {IGif} from "@giphy/js-types";

export type GifPickerRowLayoutItem = {
    readonly top: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
    readonly row: number;
};

export type GifPickerRowLayout = {
    readonly items: ReadonlyArray<GifPickerRowLayoutItem>;
    readonly containerHeight: number;
};

/**
 * Compute a justified row-based layout for GIF thumbnails.
 *
 * GIFs accumulate left-to-right. When the accumulated width exceeds
 * `containerWidth`, the row is finalized: each GIF's height is scaled so the row
 * exactly fills the width. Wide GIFs naturally get more space.
 */
export function computeGifPickerRowLayout(
    gifs: ReadonlyArray<IGif>,
    containerWidth: number,
    {targetRowHeight, gutter}: {targetRowHeight: number; gutter: number},
): GifPickerRowLayout {
    if (gifs.length === 0 || containerWidth <= 0) {
        return {items: [], containerHeight: 0};
    }

    const items: Array<GifPickerRowLayoutItem> = [];

    // Accumulate GIFs into rows.
    let rowStartIndex = 0;
    let rowAspectRatioSum = 0;
    let currentRow = 0;
    let currentTop = 0;

    for (let i = 0; i < gifs.length; i++) {
        const gif = gifs[i]!;
        const rendition = gif.images.fixed_width;
        const rawAr = rendition.width / rendition.height;
        // Clamp to avoid extremely narrow or wide items.
        const ar = Math.min(2.5, Math.max(0.5, rawAr));

        rowAspectRatioSum += ar;

        const itemCount = i - rowStartIndex + 1;
        const gutterSpace = (itemCount - 1) * gutter;
        const rowWidthAtTarget = rowAspectRatioSum * targetRowHeight + gutterSpace;

        if (rowWidthAtTarget >= containerWidth || i === gifs.length - 1) {
            // Finalize this row. Compute the actual row height so items exactly fill the
            // container width.
            const rowHeight =
                rowWidthAtTarget >= containerWidth
                    ? (containerWidth - gutterSpace) / rowAspectRatioSum
                    : targetRowHeight;

            let left = 0;
            for (let j = rowStartIndex; j <= i; j++) {
                const g = gifs[j]!;
                const r = g.images.fixed_width;
                const rawItemAr = r.width / r.height;
                const itemAr = Math.min(2.5, Math.max(0.5, rawItemAr));
                const itemWidth = itemAr * rowHeight;

                items.push({
                    top: currentTop,
                    left,
                    width: itemWidth,
                    height: rowHeight,
                    row: currentRow,
                });

                left += itemWidth + gutter;
            }

            currentTop += rowHeight + gutter;
            currentRow++;
            rowStartIndex = i + 1;
            rowAspectRatioSum = 0;
        }
    }

    // containerHeight is the bottom edge of the last row (subtract trailing gutter).
    const containerHeight = currentTop > 0 ? currentTop - gutter : 0;

    return {items, containerHeight};
}
