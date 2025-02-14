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
import {EditorState, NodeSelection, PluginKey, Selection, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {ContentTableCellSelection} from "~/shared/content/table/content_table_cell_selection.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {assert} from "~/shared/helpers/control/assert.js";

export const contentTableEditingKey = new PluginKey<number>("contentTableEditing");

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
    const $head = state.selection.$head;
    for (let d = $head.depth; d > 0; d--) if ($head.node(d).type.name === "tableRow") return true;
    return false;
}

/**
 * Retrieves the resolved position of the currently selected table cell in the
 * editor state.
 *
 * Example usage:
 *
 * ```ts
 * const selectedCellPos = selectionContentTableCell(editorState);
 * console.log(`Selected cell position: ${selectedCellPos.pos}`);
 * ```
 *
 * This function is useful when you need to perform operations on the selected
 * cell, such as modifying its attributes or content.
 */
export function selectionContentTableCell(state: EditorState): ResolvedPos {
    const sel = state.selection as ContentTableCellSelection | NodeSelection;
    if ("$anchorCell" in sel && sel.$anchorCell) {
        return sel.$anchorCell.pos > sel.$headCell.pos ? sel.$anchorCell : sel.$headCell;
    } else if ("node" in sel && sel.node && sel.node.type.name === "tableCell") {
        return sel.$anchor;
    }
    const $cell = contentTableCellAround(sel.$head) || contentTableCellNear(sel.$head);
    if ($cell) {
        return $cell;
    }
    throw new RangeError(`No cell found around position ${sel.head}`);
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

// NOCOMMIT: write docs for this function
// Update the name of this function to be globally unique
export const isColumnSelected = (columnIndex: number) => (selection: Selection) => {
    if (isCellSelection(selection)) {
        const map = ContentTableMap.get(selection.$anchorCell.node(-1));

        return isRectSelected({
            left: columnIndex,
            right: columnIndex + 1,
            top: 0,
            bottom: map.height,
        })(selection);
    }

    return false;
};

// NOCOMMIT: write docs for this function
// Update the name of this function to be globally unique
export const getCellsInRow = (rowIndex: number | Array<number>) => (selection: Selection) => {
    const table = findTable(selection);

    if (table) {
        const map = ContentTableMap.get(table.node);
        const indexes = Array.isArray(rowIndex) ? rowIndex : Array.from([rowIndex]);

        return indexes.reduce((acc, index) => {
            if (index >= 0 && index <= map.height - 1) {
                const cells = map.cellsInRect({
                    left: 0,
                    right: map.width,
                    top: index,
                    bottom: index + 1,
                });

                return acc.concat(
                    cells.map(nodePos => {
                        const node = table.node.nodeAt(nodePos);
                        const pos = nodePos + table.start;
                        return {pos, start: pos + 1, node};
                    }),
                );
            }

            return acc;
        }, [] as Array<{pos: number; start: number; node: Node | null | undefined}>);
    }

    return null;
};
// NOCOMMIT: write docs for this function
// Update the name of this function to be globally unique
export const getCellsInColumn = (columnIndex: number | Array<number>) => (selection: Selection) => {
    const table = findTable(selection);
    if (table) {
        const map = ContentTableMap.get(table.node);
        const indexes = Array.isArray(columnIndex) ? columnIndex : Array.from([columnIndex]);

        return indexes.reduce((acc, index) => {
            if (index >= 0 && index <= map.width - 1) {
                const cells = map.cellsInRect({
                    left: index,
                    right: index + 1,
                    top: 0,
                    bottom: map.height,
                });

                return acc.concat(
                    cells.map(nodePos => {
                        const node = table.node.nodeAt(nodePos);
                        const pos = nodePos + table.start;

                        return {pos, start: pos + 1, node};
                    }),
                );
            }

            return acc;
        }, [] as Array<{pos: number; start: number; node: Node | null | undefined}>);
    }
    return null;
};

// NOCOMMIT: write docs for this function
// Update the name of this function to be globally unique
export const findTable = (selection: Selection) =>
    findParentNode(node => node.type.name === "table")(selection);

export function findParentNode(predicate: Predicate) {
    return (selection: Selection) => findParentNodeClosestToPos(selection.$from, predicate);
}
export type Predicate = (node: Node) => boolean;

export function findParentNodeClosestToPos(
    $pos: ResolvedPos,
    predicate: Predicate,
):
    | {
          pos: number;
          start: number;
          depth: number;
          node: Node;
      }
    | undefined {
    for (let i = $pos.depth; i > 0; i -= 1) {
        const node = $pos.node(i);

        if (predicate(node)) {
            return {
                pos: i > 0 ? $pos.before(i) : 0,
                start: $pos.start(i),
                depth: i,
                node,
            };
        }
    }
}

// NOCOMMIT: write docs for this function
// Update the name of this function to be globally unique
export const isRowSelected = (rowIndex: number) => (selection: Selection) => {
    if (isCellSelection(selection)) {
        const map = ContentTableMap.get(selection.$anchorCell.node(-1));

        return isRectSelected({
            left: 0,
            right: map.width,
            top: rowIndex,
            bottom: rowIndex + 1,
        })(selection);
    }

    return false;
};

// NOCOMMIT: write docs for this function
// Update the name of this function to be globally unique
export const isCellSelection = (selection: Selection): selection is ContentTableCellSelection =>
    selection instanceof ContentTableCellSelection;

// NOCOMMIT: write docs for this function
// Update the name of this function to be globally unique
export const isRectSelected = (rect: Rect) => (selection: ContentTableCellSelection) => {
    const map = ContentTableMap.get(selection.$anchorCell.node(-1));
    const start = selection.$anchorCell.start(-1);
    const cells = map.cellsInRect(rect);
    const selectedCells = map.cellsInRect(
        map.rectBetween(selection.$anchorCell.pos - start, selection.$headCell.pos - start),
    );

    for (let i = 0, count = cells.length; i < count; i += 1) {
        if (selectedCells.indexOf(cells[i]!) === -1) {
            return false;
        }
    }

    return true;
};

/**
 * @public
 */
interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

// NOCOMMIT: write docs for this function
// Update the name of this function to be globally unique
const select = (type: "row" | "column") => (index: number) => (tr: Transaction) => {
    const table = findTable(tr.selection);
    const isRowSelection = type === "row";

    if (table) {
        const map = ContentTableMap.get(table.node);

        // Check if the index is valid
        if (index >= 0 && index < (isRowSelection ? map.height : map.width)) {
            const left = isRowSelection ? 0 : index;
            const top = isRowSelection ? index : 0;
            const right = isRowSelection ? map.width : index + 1;
            const bottom = isRowSelection ? index + 1 : map.height;

            const cellsInFirstRow = map.cellsInRect({
                left,
                top,
                right: isRowSelection ? right : left + 1,
                bottom: isRowSelection ? top + 1 : bottom,
            });

            const cellsInLastRow =
                bottom - top === 1
                    ? cellsInFirstRow
                    : map.cellsInRect({
                          left: isRowSelection ? left : right - 1,
                          top: isRowSelection ? bottom - 1 : top,
                          right,
                          bottom,
                      });

            const head = table.start + cellsInFirstRow[0]!;
            const anchor = table.start + cellsInLastRow[cellsInLastRow.length - 1]!;
            const $head = tr.doc.resolve(head);
            const $anchor = tr.doc.resolve(anchor);

            return tr.setSelection(new ContentTableCellSelection($anchor, $head));
        }
    }
    return tr;
};

// NOCOMMIT: write docs for this function
// Update the name of this function to be globally unique
export const selectColumn = select("column");

export const selectRow = select("row");

export const selectTable = (tr: Transaction) => {
    const table = findTable(tr.selection);

    if (table) {
        const {map} = ContentTableMap.get(table.node);

        if (map?.length) {
            const head = table.start + map[0]!;
            const anchor = table.start + map[map.length - 1]!;
            const $head = tr.doc.resolve(head);
            const $anchor = tr.doc.resolve(anchor);

            return tr.setSelection(new ContentTableCellSelection($anchor, $head));
        }
    }

    return tr;
};

export const isTableSelected = (selection: Selection) => {
    if (isCellSelection(selection)) {
        const map = ContentTableMap.get(selection.$anchorCell.node(-1));

        return isRectSelected({
            left: 0,
            right: map.width,
            top: 0,
            bottom: map.height,
        })(selection);
    }

    return false;
};

/**
 * Gets information about the selected table area including position and dimensions
 */
export function selectedRect(state: EditorState) {
    const $pos = selectionContentTableCell(state);
    const table = $pos.node(-1);
    const tableStart = $pos.start(-1);
    const map = ContentTableMap.get(table);
    const rect = map.findCell($pos.pos - tableStart);
    return {...rect, tableStart, map, table};
}

/**
 * function calculates the bounding rectangle for a specific column in an HTML table.
 * @param tableElement - The table element
 * @param columnIndex - The index of the column
 * @returns The rect of the column
 */
export function getColumnRect(tableElement: HTMLElement, columnIndex: number): DOMRect {
    // Selects all <td> (table cell) elements that are in the specified column.
    // nth-child(${columnIndex + 1}) selects the (columnIndex + 1)-th child
    // because nth-child is one-based.
    const cells = tableElement.querySelectorAll(`td:nth-child(${columnIndex + 1})`);
    let left = Infinity,
        right = -Infinity,
        top = Infinity,
        bottom = -Infinity;

    cells.forEach(cell => {
        const rect = cell.getBoundingClientRect();
        left = Math.min(left, rect.left);
        right = Math.max(right, rect.right);
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
    });

    return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * function calculates the bounding rectangle for a specific row in an HTML table.
 */
export function getRowRect(view: EditorView, tableElement: HTMLElement, rowIndex: number): DOMRect {
    assert(view);
    const $cell = selectionContentTableCell(view.state);
    const table = $cell.node(-1);
    const tableStart = $cell.start(-1);
    const map = ContentTableMap.get(table);

    let left = Infinity,
        right = -Infinity,
        top = Infinity,
        bottom = -Infinity;

    // Iterate through all cells in the row using the table map
    for (let col = 0; col < map.width; col++) {
        const pos = map.positionAt(rowIndex, col, table);
        const cell = table.nodeAt(pos);
        assert(cell);

        // Get the DOM element for this cell
        const cellElement = view.nodeDOM(tableStart + pos) as HTMLElement;
        assert(cellElement);

        const rect = cellElement.getBoundingClientRect();
        left = Math.min(left, rect.left);
        right = Math.max(right, rect.right);
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
    }

    // If no valid measurements were found, return empty DOMRect
    if (left === Infinity || right === -Infinity || top === Infinity || bottom === -Infinity) {
        return new DOMRect();
    }

    return new DOMRect(left, top, right - left, bottom - top);
}
