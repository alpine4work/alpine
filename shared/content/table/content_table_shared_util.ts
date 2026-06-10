/**
 * NOTE(rohitt-gupta, 2024-11-26): This file has been modified to remove features
 * we don't use and customize the user experience. You can find the original file
 * in the `prosemirror-tables` package at:
 * https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/util.ts
 *
 * The MIT License
 *
 * Copyright (C) 2015-2016 by Marijn Haverbeke <marijnh@gmail.com> and others
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// Various helper function for working with tables

import {ResolvedPos} from "prosemirror-model";

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
