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
import {EditorState, NodeSelection, Selection} from "prosemirror-state";
import {ContentTableCellSelection} from "~/shared/content/table/content_table_cell_selection.js";
import {ContentTableMap, ContentTableMapRect} from "~/shared/content/table/content_table_map.js";

/**
 * Retrieves the resolved position of the cell surrounding the given position.
 *
 * Example usage:
 *
 * ```ts
 * const cellPosition = contentTableCellAround($pos);
 * console.log(`Cell position: ${cellPosition}`);
 * ```
 *
 * This function is useful for determining the cell context of a given position.
 */
export function contentTableCellAround($pos: ResolvedPos): ResolvedPos | null {
    for (let d = $pos.depth - 1; d > 0; d--)
        if ($pos.node(d).type.name === "tableRow") return $pos.node(0).resolve($pos.before(d + 1));
    return null;
}

/**
 * Finds the cell wrapping the given position.
 *
 * Example usage:
 *
 * ```ts
 * const wrappedCell = contentTableCellWrapping($pos);
 * console.log(`Wrapped cell: ${wrappedCell}`);
 * ```
 *
 * This function helps in identifying the cell node that wraps around a specific position.
 */
export function contentTableCellWrapping($pos: ResolvedPos): null | Node {
    for (let d = $pos.depth; d > 0; d--) {
        const isTableCell = $pos.node(d).type.name === "tableCell";
        if (isTableCell) return $pos.node(d);
    }
    return null;
}

/**
 * Checks if the current selection is within a table.
 *
 * Example usage:
 *
 * ```ts
 * const inTable = isInContentTable(state);
 * console.log(`Is in table: ${inTable}`);
 * ```
 *
 * This function is useful for validating if operations should be performed
 * within a table context.
 */
export function isInContentTable(state: EditorState): boolean {
    return isSelectionInContentTable(state.selection);
}

export function isSelectionInContentTable(selection: Selection): boolean {
    const $head = selection.$head;
    return isPosInContentTable($head);
}

export function isPosInContentTable($pos: ResolvedPos): boolean {
    for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === "tableRow") return true;
    return false;
}

export function getContentTableIfExists($pos: ResolvedPos): Node | null {
    for (let depth = $pos.depth; depth > 0; depth--) {
        if ($pos.node(depth).type.name === "tableRow") {
            return $pos.node(depth - 1);
        }
    }
    return null;
}

/**
 * Retrieves the resolved position of the currently selected table cell in the
 * editor state.
 *
 * Example usage:
 *
 * ```ts
 * const selectedCellPos = selectionContentTableCell(editorState.selection);
 * console.log(`Selected cell position: ${selectedCellPos.pos}`);
 * ```
 *
 * This function is useful when you need to perform operations on the selected
 * cell, such as modifying its attributes or content.
 */
export function selectionContentTableCell(selection: Selection): ResolvedPos {
    if (selection instanceof ContentTableCellSelection && selection.$anchorCell) {
        return selection.$anchorCell.pos > selection.$headCell.pos
            ? selection.$anchorCell
            : selection.$headCell;
    } else if (
        selection instanceof NodeSelection &&
        selection.node &&
        selection.node.type.name === "tableCell"
    ) {
        return selection.$anchor;
    }
    const $cell = contentTableCellAround(selection.$head) || contentTableCellNear(selection.$head);
    if ($cell) {
        return $cell;
    }
    throw new RangeError(`No cell found around position ${selection.head}`);
}

export type ContentTableMapRectWithTable = ContentTableMapRect & {
    tablePos: number;
    table: Node;
    tableMap: ContentTableMap;
};

/**
 * Helper to get the selected rectangle in a table, if any. Adds table
 * map, table node, and table start offset to the object for convenience.
 */
export function selectedContentTableRect(state: EditorState): ContentTableMapRectWithTable {
    const selection = state.selection;
    const $cell = selectionContentTableCell(selection);
    const table = $cell.node(-1);
    const tablePos = $cell.start(-1);
    const tableMap = ContentTableMap.get(table);
    const rect =
        selection instanceof ContentTableCellSelection
            ? tableMap.rectBetween(
                  selection.$anchorCell.pos - tablePos,
                  selection.$headCell.pos - tablePos,
              )
            : tableMap.findCell($cell.pos - tablePos);
    return {...rect, tablePos, tableMap, table};
}

/**
 * Finds the nearest cell to the given position.
 *
 * Example usage:
 *
 * ```ts
 * const nearestCell = contentTableCellNear($pos);
 * console.log(`Nearest cell: ${nearestCell}`);
 * ```
 *
 * This function is useful for navigating to the closest cell in a table.
 */
export function contentTableCellNear($pos: ResolvedPos): ResolvedPos | undefined {
    for (let after = $pos.nodeAfter, pos = $pos.pos; after; after = after.firstChild, pos++) {
        const isTableCell = after.type.name === "tableCell";
        if (isTableCell) return $pos.doc.resolve(pos);
    }
    for (let before = $pos.nodeBefore, pos = $pos.pos; before; before = before.lastChild, pos--) {
        const isTableCell = before.type.name === "tableCell";
        if (isTableCell) return $pos.doc.resolve(pos - before.nodeSize);
    }
}

/**
 * Moves the position forward to the next cell.
 *
 * Example usage:
 *
 * ```ts
 * const nextCellPos = moveContentTableCellForward($pos);
 * console.log(`Next cell position: ${nextCellPos.pos}`);
 * ```
 *
 * This function is useful for navigating through cells in a table.
 */
export function moveContentTableCellForward($pos: ResolvedPos): ResolvedPos {
    return $pos.node(0).resolve($pos.pos + $pos.nodeAfter!.nodeSize);
}

/**
 * Finds the next cell in the specified direction.
 *
 * Example usage:
 *
 * ```ts
 * const nextCellPos = nextContentTableCell($pos, 'horiz', 1);
 * console.log(`Next cell position: ${nextCellPos}`);
 * ```
 *
 * This function is useful for navigating through cells in a specified direction.
 */
export function nextContentTableCell(
    $pos: ResolvedPos,
    axis: "horiz" | "vert",
    dir: number,
): ResolvedPos | null {
    const table = $pos.node(-1);
    const map = ContentTableMap.get(table);
    const tableStart = $pos.start(-1);

    const moved = map.nextCell($pos.pos - tableStart, axis, dir);
    return moved == null ? null : $pos.node(0).resolve(tableStart + moved);
}
