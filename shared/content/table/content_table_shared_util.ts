/**
 * NOTE(rohitt-gupta, 2024-11-26): This file has been modified to remove
 * features we don't use and customize the user experience. You can find the
 * original file in the `prosemirror-tables` package at:
 * https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/util.ts
 *
 * The MIT License
 *
 * Copyright (C) 2015-2016 by Marijn Haverbeke <marijnh@gmail.com> and others
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

// Various helper function for working with tables

import {Node, ResolvedPos} from "prosemirror-model";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";

// TODO(rohitt-gupta, #tables): Remove colspan and colwidth once we fork
// all the components from prosemirror-tables and update the schema.
export interface ContentTableCellAttrs {
    colspan: number;
    rowspan: number;
    colwidth: Array<number> | null;
}

/**
 * Checks if the given position points at a cell.
 *
 * Example usage:
 *
 * ```ts
 * const isPointingAtCell = pointsAtCell($pos);
 * console.log(`Points at cell: ${isPointingAtCell}`);
 * ```
 *
 * This function is useful for determining if the current position is directly
 * within a cell.
 */
export function pointsAtContentTableCell($pos: ResolvedPos): boolean {
    return $pos.parent.type.name === "tableRow" && !!$pos.nodeAfter;
}

/**
 * Checks if two cells are in the same table.
 *
 * Example usage:
 *
 * ```ts
 * const sameTable = inSameTable($cellA, $cellB);
 * console.log(`In same table: ${sameTable}`);
 * ```
 *
 * This function is useful for validating operations that depend on cell
 * relationships.
 */
export function inSameContentTable($cellA: ResolvedPos, $cellB: ResolvedPos): boolean {
    return (
        $cellA.depth == $cellB.depth &&
        $cellA.pos >= $cellB.start(-1) &&
        $cellA.pos <= $cellB.end(-1)
    );
}

const contentTableColumnMinWidth = 0.2;
const contentTableColumnMaxWidth = 0.8;
export const contentTableColumnDefaultWidth = 0.25;
const contentTableColumnWidthIncrement = 0.05;

/**
 * Get the column widths for the table node. Column widths are stored in the
 * `table.attrs.columnWidths` attribute but that array may be in an invalid
 * format. This function cleans up the column widths array by running the
 * following:
 *
 * - Makes sure the column widths array length matches the number of columns
 *   in the table. Any columns missing a width get the default width
 *   (`contentTableColumnDefaultWidth`).
 *
 * - Makes sure all column widths are rounded to our column width increment
 *   (`contentTableColumnWidthIncrement`).
 *
 * - Clamps column widths to the min and max column width
 *   (`contentTableColumnMinWidth` and `contentTableColumnMaxWidth`).
 *
 * Always creates a new column width array so you're free to mutate the
 * returned array.
 */
export function getContentTableColumnWidths(table: Node): Array<number> {
    const tableMap = ContentTableMap.get(table);
    const {columnWidths: actualColumnWidths = []} = table.attrs;

    const columnWidths: Array<number> = [];

    for (let columnIndex = 0; columnIndex < tableMap.width; columnIndex++) {
        let columnWidth = actualColumnWidths[columnIndex] ?? contentTableColumnDefaultWidth;

        columnWidth =
            Math.round(columnWidth * (1 / contentTableColumnWidthIncrement)) /
            (1 / contentTableColumnWidthIncrement);

        if (columnWidth > contentTableColumnMaxWidth) columnWidth = contentTableColumnMaxWidth;
        else if (columnWidth < contentTableColumnMinWidth) columnWidth = contentTableColumnMinWidth;

        columnWidths.push(columnWidth);
    }

    return columnWidths;
}
