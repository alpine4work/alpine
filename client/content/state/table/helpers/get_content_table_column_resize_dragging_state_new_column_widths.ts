import {resolveContentTableColumnWidthPx} from "~/client/content/state/table/helpers/resolve_content_table_column_width_px.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

/**
 * Calculates the new width of the column being dragged.
 *
 * We implement the following UX principles for column resizing. These UX
 * principles should lead to a consistent, easy to understand, experience for
 * users building tables:
 *
 * 1. A column should only resize when a user drags the drag handle. It should
 *    not resize when the user types content. Instead content should wrap onto
 *    a new line as the user types.
 *
 * 2. Dragging a column drag handle should only change the size of the
 *    column(s) adjacent to the drag handle.
 *
 * 3. Dragging an interior column drag handle shouldn't change the width of the
 *    table.
 *
 * 4. Dragging an edge column drag handle (left or right) can change the width
 *    of the table.
 *
 * Some ideas for another day:
 *
 * - It's a little surprising that dragging in the middle of two min width
 *   columns does nothing. That's because of our resize principle to only
 *   change the size of columns adjacent to the drag handle. Maybe we should
 *   consider loosening principle 3. Allowing the table to resize if it already
 *   has a width greater than 1 seems fine. We want to keep tables with a width
 *   of 1 as much as possible since tables with a width of 1 won't overflow on
 *   mobile.
 *
 * - Allow columns to snap to the same width as other columns. This allows
 *   users to easily build well designed tables that have consistent spacing
 *   across multiple columns. Or add a "set width" feature that lets the user
 *   set the column width as a percent.
 */
export function getContentTableColumnResizeDraggingStateNewColumnWidths(
    currentX: number,
    {
        startX,
        blockWidthPx,
        tableWrapperWidthPx,
        oldScrollLeftPx,
        isSnapping,
        state: {columnIndex: column1Index, oldTableMap},
    }: {
        startX: number;
        blockWidthPx: number;
        tableWrapperWidthPx: number;
        oldScrollLeftPx: number;
        isSnapping: boolean;
        state: {
            columnIndex: number;
            oldTableMap: {
                tableWidth: number;
                columnWidths: ReadonlyArray<number>;
                totalColumnWidth: number;
            };
        };
    },
): {
    tableWidth: number;
    columnWidths: ReadonlyArray<number>;
    totalColumnWidth: number;
    scrollLeftPx?: number;
} {
    const {
        tableWidth: oldTableWidth,
        columnWidths: oldColumnWidths,
        totalColumnWidth: oldTotalColumnWidth,
    } = oldTableMap;

    const offsetPx = currentX - startX;

    const spacingScale = getSpacingScaleWithoutListening();
    const remPx = remPxBySpacingScale[spacingScale];
    const columnMinWidthPx = contentStyles.tableColumnMinWidthRem * remPx;
    const columnMaxWidthPx = contentStyles.tableColumnMaxWidthRem * remPx;

    const minTotalColumnWidthPx = Math.max(
        columnMinWidthPx * oldColumnWidths.length,
        // Don't shrink smaller than the editor's block width.
        blockWidthPx,
    );

    const maxTotalColumnWidthPx = columnMaxWidthPx * oldColumnWidths.length;

    const oldColumnWidthPxs = resolveContentTableColumnWidthPx(
        spacingScale,
        blockWidthPx,
        oldTableMap,
    );

    let oldTotalColumnWidthPx = 0;
    for (const oldColumnWidthPx of oldColumnWidthPxs) oldTotalColumnWidthPx += oldColumnWidthPx;

    // By default, round column width to the nearest snap increment. If the user is
    // holding alt then we'll let the user perform a precise pixel by pixel resize.
    //
    // By defaulting to snapping to a standard column width increment, we help the
    // user create beautiful, orderly, tables.
    const snapColumnWidthPx = (columnWidthPx: number) => {
        if (!isSnapping) return columnWidthPx;

        const columnWidthSnapIncrementPx =
            blockWidthPx / contentStyles.tableColumnWidthBlockWidthSnapFactor;

        return Math.round(columnWidthPx / columnWidthSnapIncrementPx) * columnWidthSnapIncrementPx;
    };

    // For the best UX, as the user drags the column resize handle should perfectly
    // follow the user's mouse while they drag. If the table width is less than the
    // view width then the table is centered in the view. Dragging a column to
    // resize the column 1px ends up moving the column right 0.5px and left 0.5px
    // while the table width is less than the view width since we need to keep the
    // table centered.
    //
    // This function speeds up the column width change while the table width is
    // less than the view width by 2x so the column width moves perfectly with the
    // mouse even while the table is centered.
    const getAdditionalColumnWidthPxIfChangingTableWidth = (offsetPx: number) => {
        if (offsetPx > 0) {
            const doubledOffsetPx = Math.max(0, (tableWrapperWidthPx - oldTotalColumnWidthPx) / 2);

            return (
                Math.min(offsetPx, doubledOffsetPx) * 2 + Math.max(0, offsetPx - doubledOffsetPx)
            );
        } else {
            const doubledOffsetPx = Math.max(0, oldTotalColumnWidthPx - tableWrapperWidthPx);

            return (
                Math.max(offsetPx, -doubledOffsetPx) + Math.min(0, offsetPx + doubledOffsetPx) * 2
            );
        }
    };

    // There are two branches to this function:
    //
    // 1. If we're dragging a resize handle on the edge of the table
    // 2. If we're dragging a resize handle inside the table (between two columns)
    //
    // Dragging a resize handle inside the table (branch 2) is not allowed to
    // change the table's width. Only dragging a resize handle at the edge of the
    // table may resize the table width.
    //
    // While dragging a resize handle we'll only change the column widths adjacent
    // to that resize handle.
    if (column1Index < 0 || column1Index >= oldColumnWidths.length - 1) {
        const isLeftResize = column1Index < 0;
        const columnIndex = isLeftResize ? 0 : oldColumnWidths.length - 1;
        const oldColumnWidthPx = oldColumnWidthPxs[columnIndex]!;

        let newColumnWidthPx = clamp(
            columnMinWidthPx,
            snapColumnWidthPx(
                oldColumnWidthPx +
                    getAdditionalColumnWidthPxIfChangingTableWidth(
                        (isLeftResize ? -1 : 1) * offsetPx,
                    ),
            ),
            columnMaxWidthPx,
        );

        const expectedNewTotalColumnWidthPx =
            oldTotalColumnWidthPx - (oldColumnWidthPx - newColumnWidthPx);

        const newTotalColumnWidthPx = clamp(
            minTotalColumnWidthPx,
            expectedNewTotalColumnWidthPx,
            maxTotalColumnWidthPx,
        );

        // If the new column width violates total column width min/max bounds then we
        // need to adjust the new column width back down to what'll work with our total
        // column width min/max bounds.
        newColumnWidthPx += newTotalColumnWidthPx - expectedNewTotalColumnWidthPx;

        const newColumnWidths: Array<number | null> = [];
        let newOtherTotalColumnWidth = 0;

        for (
            let otherColumnIndex = 0;
            otherColumnIndex < oldColumnWidths.length;
            otherColumnIndex++
        ) {
            if (otherColumnIndex === columnIndex) {
                newColumnWidths.push(null);
                continue;
            }

            const oldOtherColumnWidth =
                (oldColumnWidthPxs[otherColumnIndex]! / oldTotalColumnWidthPx) *
                oldTotalColumnWidth;

            newColumnWidths.push(oldOtherColumnWidth);
            newOtherTotalColumnWidth += oldOtherColumnWidth;
        }

        // We have the following equality:
        //
        // ```ts
        // newColumnWidthPx / newTotalColumnWidthPx ===
        //     newColumnWidth / (newColumnWidth + newOtherTotalColumnWidth)
        // ```
        //
        // All variables in the equality are known except for `newColumnWidth`.
        // We can use [algebra to solve for `newColumnWidth`][1] which gives us the
        // following equation.
        //
        // [1]: https://www.wolframalpha.com/input?i=solve+c+in+a+%2F+b+%3D+c+%2F+%28c+%2B+d%29
        const newColumnWidth = -(
            (newColumnWidthPx * newOtherTotalColumnWidth) /
            (newColumnWidthPx - newTotalColumnWidthPx)
        );

        newColumnWidths[columnIndex] = newColumnWidth;

        const newTableWidth = Math.max(
            1,
            oldTableWidth * (newTotalColumnWidthPx / oldTotalColumnWidthPx),
        );

        let newTotalColumnWidth = 0;
        for (const newColumnWidth of newColumnWidths) newTotalColumnWidth += newColumnWidth!;

        return {
            tableWidth: newTableWidth,
            columnWidths: newColumnWidths as Array<number>,
            totalColumnWidth: newTotalColumnWidth,
            scrollLeftPx: isLeftResize
                ? oldScrollLeftPx
                : oldScrollLeftPx + (newColumnWidthPx - oldColumnWidthPx),
        };
    } else if (
        oldColumnWidths.length <= contentStyles.tableMaxColumnCountForMaintainingBlockWidth
    ) {
        // If the number of columns are less than equal to 4 then make sure the
        // interior column resizer is affecting only the columns adjacent to the resize
        // handle and not the table width
        const column2Index = column1Index + 1;
        const oldColumn2Width = oldColumnWidths[column2Index]!;

        const oldColumn1Width = oldColumnWidths[column1Index]!;
        const oldColumn1WidthPx = oldTotalColumnWidthPx * (oldColumn1Width / oldTotalColumnWidth);

        // Make sure the new column 1 width is in our min/max bounds.
        let newColumn1WidthPx = clamp(
            columnMinWidthPx,
            snapColumnWidthPx(oldColumn1WidthPx + offsetPx),
            columnMaxWidthPx,
        );

        let newColumn1Width = (newColumn1WidthPx / oldTotalColumnWidthPx) * oldTotalColumnWidth;
        let newColumn2Width = oldColumn1Width + oldColumn2Width - newColumn1Width;
        let newColumn2WidthPx = (newColumn2Width / oldTotalColumnWidth) * oldTotalColumnWidthPx;

        // Make sure the new column 2 width is in our min/max bounds.
        if (newColumn2WidthPx < columnMinWidthPx) {
            newColumn2WidthPx = columnMinWidthPx;
            newColumn2Width = (newColumn2WidthPx / oldTotalColumnWidthPx) * oldTotalColumnWidth;
            newColumn1Width = oldColumn1Width + oldColumn2Width - newColumn2Width;
            newColumn1WidthPx = (newColumn1Width / oldTotalColumnWidth) * oldTotalColumnWidthPx;
        } else if (newColumn2WidthPx > columnMaxWidthPx) {
            newColumn2WidthPx = columnMaxWidthPx;
            newColumn2Width = (newColumn2WidthPx / oldTotalColumnWidthPx) * oldTotalColumnWidth;
            newColumn1Width = oldColumn1Width + oldColumn2Width - newColumn2Width;
            newColumn1WidthPx = (newColumn1Width / oldTotalColumnWidth) * oldTotalColumnWidthPx;
        }

        const newColumnWidths: Array<number> = [];

        for (let columnIndex = 0; columnIndex < oldColumnWidths.length; columnIndex++) {
            if (columnIndex === column1Index) newColumnWidths.push(newColumn1Width);
            else if (columnIndex === column2Index) newColumnWidths.push(newColumn2Width);
            else newColumnWidths.push(oldColumnWidths[columnIndex]!);
        }

        let newTotalColumnWidth = 0;
        for (const newColumnWidth of newColumnWidths) newTotalColumnWidth += newColumnWidth;

        return {
            tableWidth: oldTableWidth,
            columnWidths: newColumnWidths,
            totalColumnWidth: newTotalColumnWidth,
            scrollLeftPx: oldScrollLeftPx,
        };
    } else {
        const oldColumnWidth = oldColumnWidths[column1Index]!;
        const oldColumnWidthPx = oldColumnWidthPxs[column1Index]!;

        // Calculate new width based on drag offset
        let newColumnWidthPx = clamp(
            columnMinWidthPx,
            snapColumnWidthPx(
                oldColumnWidthPx + getAdditionalColumnWidthPxIfChangingTableWidth(offsetPx),
            ),
            columnMaxWidthPx,
        );

        const expectedNewTotalColumnWidthPx =
            oldTotalColumnWidthPx + (newColumnWidthPx - oldColumnWidthPx);

        const newTotalColumnWidthPx = clamp(
            minTotalColumnWidthPx,
            expectedNewTotalColumnWidthPx,
            maxTotalColumnWidthPx,
        );

        // If the new column width violates total column width min/max bounds then we
        // need to adjust the new column width back down to what'll work with our total
        // column width min/max bounds.
        newColumnWidthPx += newTotalColumnWidthPx - expectedNewTotalColumnWidthPx;

        // Calculate new relative width for the resized column:
        //
        // We have the following equality, where `newTotalColumnWidth` is the new
        // total column width and it is being calculated from the old total column
        // width, the old width of the column being resized, and the new width of
        // the column being resized:
        //
        // ```
        // newTotalColumnWidth = oldTotalColumnWidth - oldColumnWidth + newColumnWidth
        // ```
        //
        // We also have the following equality, where `newColumnWidth` is the new
        // width of the column being resized: Here we are comparing the ratio of
        // the relatives values to the ratio of the pixels values.
        //
        // ```
        // newColumnWidth / newTotalColumnWidth = newColumnWidthPx / newTotalColumnWidthPx
        // ```
        //
        // If we simplify this using 1st equality we get:
        //
        // ```
        // newColumnWidth / (oldTotalColumnWidth - oldColumnWidth + newColumnWidth) = newColumnWidthPx / newTotalColumnWidthPx
        // ```
        //
        // which can be written as: a / (b - c + a) = d / f
        //
        // All variables in the equality are known except for `newColumnWidth`.
        // We can use [algebra to solve for `newColumnWidth`][1] which gives us the
        // following equation.
        //
        // [1]: https://www.wolframalpha.com/input?i=solve+for+a++a+%2F+%28b+-+c+%2B+a%29+%3D+d+%2F+f
        const newColumnWidth =
            (newColumnWidthPx * (oldColumnWidth - oldTotalColumnWidth)) /
            (newColumnWidthPx - newTotalColumnWidthPx);

        // Keep other columns unchanged
        const newColumnWidths: Array<number> = [...oldColumnWidths];
        newColumnWidths[column1Index] = newColumnWidth;

        // Update table width
        const newTableWidth = Math.max(
            1,
            oldTableWidth * (newTotalColumnWidthPx / oldTotalColumnWidthPx),
        );

        let oldTotalColumnWidthPxBeforeColumn = 0;
        for (let i = 0; i < column1Index; i++)
            oldTotalColumnWidthPxBeforeColumn += oldColumnWidthPxs[i]!;

        const newColumnScrollRightPx =
            oldTotalColumnWidthPxBeforeColumn + newColumnWidthPx - oldScrollLeftPx;

        let newTotalColumnWidth = 0;
        for (const newColumnWidth of newColumnWidths) newTotalColumnWidth += newColumnWidth;

        return {
            tableWidth: newTableWidth,
            columnWidths: newColumnWidths,
            totalColumnWidth: newTotalColumnWidth,
            scrollLeftPx:
                oldScrollLeftPx +
                Math.floor(Math.max(0, newColumnScrollRightPx - (tableWrapperWidthPx - 1))),
        };
    }
}
