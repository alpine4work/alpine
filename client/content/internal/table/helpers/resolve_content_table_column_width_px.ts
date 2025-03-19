/**
 * Computes the absolute pixel width of each column in a table. Implements the
 * same algorithm CSS grid will use to layout our table in the DOM.
 *
 * `totalColumnWidth` must be the sum of all `columnWidths`. Most of the time
 * you'll have precomputed this value so pass it in so we don't have to compute
 * it again.
 */
// NOTE(calebmer): Normally, since this has 4 arguments, I'd write this with a
// named argument object. But since this code will be called in a hot path
// (every frame) using positional arguments to avoid an extra object
// allocation.
export function resolveContentTableColumnWidthPx(
    totalColumnWidth: number,
    columnWidths: ReadonlyArray<number>,
    totalColumnWidthPx: number,
    columnMinWidthPx: number,
): Array<number> {
    let hasNextPass = true;
    let currentPassTotalColumnWidth = totalColumnWidth;
    let currentPassTotalColumnWidthPx = totalColumnWidthPx;
    let nextPassTotalColumnWidth: number;
    let nextPassTotalColumnWidthPx: number;

    const columnCount = columnWidths.length;
    const columnWidthPxs: Array<number | undefined> = Array(columnCount);

    while (hasNextPass) {
        hasNextPass = false;
        nextPassTotalColumnWidth = 0;
        nextPassTotalColumnWidthPx = currentPassTotalColumnWidthPx;

        for (let i = 0; i < columnCount; i++) {
            if (columnWidthPxs[i] !== undefined) continue;

            const columnWidth = columnWidths[i]!;

            const columnWidthPx =
                (columnWidth / currentPassTotalColumnWidth) * currentPassTotalColumnWidthPx;

            if (columnWidthPx < columnMinWidthPx) {
                hasNextPass = true;
                nextPassTotalColumnWidthPx -= columnMinWidthPx;
                columnWidthPxs[i] = columnMinWidthPx;
            } else {
                nextPassTotalColumnWidth += columnWidth;
            }
        }

        currentPassTotalColumnWidth = nextPassTotalColumnWidth;
        currentPassTotalColumnWidthPx = nextPassTotalColumnWidthPx;
    }

    for (let i = 0; i < columnCount; i++) {
        if (columnWidthPxs[i] !== undefined) continue;

        columnWidthPxs[i] =
            (columnWidths[i]! / currentPassTotalColumnWidth) * currentPassTotalColumnWidthPx;
    }

    return columnWidthPxs as Array<number>;
}
