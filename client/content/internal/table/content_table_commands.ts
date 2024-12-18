/**
 * NOTE(rohitt-gupta, 2024-11-26): Forked from `prosemirror-tables` so we can
 * remove features we don't use and customize the user experience. We intend to
 * modify this file a lot so each modification may not be documented.
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

// this file has been modified to remove features we don't use and customize the
// user experience. You can find the original file in the `prosemirror-tables`
// package at https://github.com/ProseMirror/prosemirror-tables/blob/master/src/commands.ts
import {Node, ResolvedPos, Slice} from "prosemirror-model";
import {Command, EditorState, TextSelection, Transaction} from "prosemirror-state";
import type {ContentTableInputDirection} from "~/client/content/internal/table/content_table_input.js";
import {contentTableIsInTable} from "~/client/content/internal/table/helpers/content_table_is_in_table.js";
import {contentTableMoveCellForward} from "~/client/content/internal/table/helpers/content_table_move_cell_forward.js";
import {contentTableSelectionCell} from "~/client/content/internal/table/helpers/content_table_selection_cell.js";
import {ContentTableCellSelection} from "~/shared/content/table/content_table_cell_selection.js";
import {ContentTableMap, ContentTableMapRect} from "~/shared/content/table/content_table_map.js";
import {contentTableNodeTypes} from "~/shared/content/table/content_table_schema.js";

type TableRect = ContentTableMapRect & {
    tableStart: number;
    map: ContentTableMap;
    table: Node;
};

/**
 * Helper to get the selected rectangle in a table, if any. Adds table
 * map, table node, and table start offset to the object for convenience.
 */
function selectedRect(state: EditorState): TableRect {
    const sel = state.selection;
    const $pos = contentTableSelectionCell(state);
    const table = $pos.node(-1);
    const tableStart = $pos.start(-1);
    const map = ContentTableMap.get(table);
    const rect =
        sel instanceof ContentTableCellSelection
            ? map.rectBetween(sel.$anchorCell.pos - tableStart, sel.$headCell.pos - tableStart)
            : map.findCell($pos.pos - tableStart);
    return {...rect, tableStart, map, table};
}

/**
 * Add a column at the given position in a table.
 */
function addColumn(tr: Transaction, {map, tableStart, table}: TableRect, col: number): Transaction {
    // Update columnsWidth array
    const columnsWidth = [...(table.attrs.columnsWidth || [])];
    const defaultWidth =
        columnsWidth.length > 0 ? Math.max(...columnsWidth.filter(w => w > 0)) || 100 : 100;
    columnsWidth.splice(col, 0, defaultWidth);

    tr.setNodeMarkup(tableStart - 1, null, {
        ...table.attrs,
        columnsWidth,
    });

    // Add cells to each row
    for (let row = 0; row < map.height; row++) {
        const pos = map.positionAt(row, col, table);
        const type = contentTableNodeTypes(table.type.schema).cell;
        tr.insert(tr.mapping.map(tableStart + pos), type.createAndFill()!);
    }

    return tr;
}

/**
 * Command to add a column before the column with the selection.
 */
function addColumnBefore(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
    if (!contentTableIsInTable(state)) return false;
    if (dispatch) {
        const rect = selectedRect(state);
        dispatch(addColumn(state.tr, rect, rect.left));
    }
    return true;
}

/**
 * Command to add a column after the column with the selection.
 */
function addColumnAfter(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
    if (!contentTableIsInTable(state)) return false;
    if (dispatch) {
        const rect = selectedRect(state);
        dispatch(addColumn(state.tr, rect, rect.right));
    }
    return true;
}

function removeColumn(tr: Transaction, {map, table, tableStart}: TableRect, col: number) {
    // Update columnsWidth array
    const columnsWidth = [...(table.attrs.columnsWidth || [])];
    columnsWidth.splice(col, 1);

    tr.setNodeMarkup(tableStart - 1, null, {
        ...table.attrs,
        columnsWidth,
    });

    // Remove cells from each row
    for (let row = 0; row < map.height; row++) {
        const pos = map.positionAt(row, col, table);
        const cell = table.nodeAt(pos)!;
        tr.delete(
            tr.mapping.map(tableStart + pos),
            tr.mapping.map(tableStart + pos + cell.nodeSize),
        );
    }
}

/**
 * Command function that removes the selected columns from a table.
 */
function deleteColumn(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
    if (!contentTableIsInTable(state)) return false;
    if (dispatch) {
        const rect = selectedRect(state);
        const tr = state.tr;
        if (rect.left == 0 && rect.right == rect.map.width) return false;
        for (let i = rect.right - 1; ; i--) {
            removeColumn(tr, rect, i);
            if (i == rect.left) break;
            const table = rect.tableStart ? tr.doc.nodeAt(rect.tableStart - 1) : tr.doc;
            if (!table) {
                throw RangeError("No table found");
            }
            rect.table = table;
            rect.map = ContentTableMap.get(table);
        }
        dispatch(tr);
    }
    return true;
}

function addRow(tr: Transaction, {map, tableStart, table}: TableRect, row: number): Transaction {
    let rowPos = tableStart;
    for (let i = 0; i < row; i++) rowPos += table.child(i).nodeSize;

    const cells = [];
    for (let col = 0; col < map.width; col++) {
        const type = contentTableNodeTypes(table.type.schema).cell;
        const node = type.createAndFill();
        if (node) cells.push(node);
    }

    tr.insert(rowPos, contentTableNodeTypes(table.type.schema).row.create(null, cells));
    return tr;
}

/**
 * Add a table row before the selection.
 */
function addRowBefore(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
    if (!contentTableIsInTable(state)) return false;
    if (dispatch) {
        const rect = selectedRect(state);
        dispatch(addRow(state.tr, rect, rect.top));
    }
    return true;
}

/**
 * Add a table row after the selection.
 */
function addRowAfter(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
    if (!contentTableIsInTable(state)) return false;
    if (dispatch) {
        const rect = selectedRect(state);
        dispatch(addRow(state.tr, rect, rect.bottom));
    }
    return true;
}

function removeRow(tr: Transaction, {map, table, tableStart}: TableRect, row: number): void {
    let rowPos = 0;
    for (let i = 0; i < row; i++) rowPos += table.child(i).nodeSize;
    const nextRow = rowPos + table.child(row).nodeSize;
    tr.delete(rowPos + tableStart, nextRow + tableStart);
}

/**
 * Remove the selected rows from a table.
 */
function deleteRow(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
    if (!contentTableIsInTable(state)) return false;
    if (dispatch) {
        const rect = selectedRect(state);
        const tr = state.tr;
        if (rect.top == 0 && rect.bottom == rect.map.height) return false;
        for (let i = rect.bottom - 1; ; i--) {
            removeRow(tr, rect, i);
            if (i == rect.top) break;
            const table = rect.tableStart ? tr.doc.nodeAt(rect.tableStart - 1) : tr.doc;
            if (!table) {
                throw RangeError("No table found");
            }
            rect.table = table;
            rect.map = ContentTableMap.get(rect.table);
        }
        dispatch(tr);
    }
    return true;
}

function isEmpty(cell: Node): boolean {
    const c = cell.content;
    return c.childCount == 1 && c.child(0).isTextblock && c.child(0).childCount == 0;
}

function cellsOverlapRectangle({width, height, map}: ContentTableMap, rect: ContentTableMapRect) {
    let indexTop = rect.top * width + rect.left,
        indexLeft = indexTop;
    let indexBottom = (rect.bottom - 1) * width + rect.left,
        indexRight = indexTop + (rect.right - rect.left - 1);
    for (let i = rect.top; i < rect.bottom; i++) {
        if (
            (rect.left > 0 && map[indexLeft] == map[indexLeft - 1]) ||
            (rect.right < width && map[indexRight] == map[indexRight + 1])
        )
            return true;
        indexLeft += width;
        indexRight += width;
    }
    for (let i = rect.left; i < rect.right; i++) {
        if (
            (rect.top > 0 && map[indexTop] == map[indexTop - width]) ||
            (rect.bottom < height && map[indexBottom] == map[indexBottom + width])
        )
            return true;
        indexTop++;
        indexBottom++;
    }
    return false;
}

function findNextCell($cell: ResolvedPos, dir: ContentTableInputDirection): number | null {
    if (dir < 0) {
        const before = $cell.nodeBefore;
        if (before) return $cell.pos - before.nodeSize;
        for (let row = $cell.index(-1) - 1, rowEnd = $cell.before(); row >= 0; row--) {
            const rowNode = $cell.node(-1).child(row);
            const lastChild = rowNode.lastChild;
            if (lastChild) {
                return rowEnd - 1 - lastChild.nodeSize;
            }
            rowEnd -= rowNode.nodeSize;
        }
    } else {
        if ($cell.index() < $cell.parent.childCount - 1) {
            return $cell.pos + $cell.nodeAfter!.nodeSize;
        }
        const table = $cell.node(-1);
        for (
            let row = $cell.indexAfter(-1), rowStart = $cell.after();
            row < table.childCount;
            row++
        ) {
            const rowNode = table.child(row);
            if (rowNode.childCount) return rowStart + 1;
            rowStart += rowNode.nodeSize;
        }
    }
    return null;
}

/**
 * Returns a command for selecting the next (direction=1) or previous
 * (direction=-1) cell in a table.
 */
function goToNextCell(direction: ContentTableInputDirection): Command {
    return function (state, dispatch) {
        if (!contentTableIsInTable(state)) return false;
        const cell = findNextCell(contentTableSelectionCell(state), direction);
        if (cell == null) return false;
        if (dispatch) {
            const $cell = state.doc.resolve(cell);
            dispatch(
                state.tr
                    .setSelection(TextSelection.between($cell, contentTableMoveCellForward($cell)))
                    .scrollIntoView(),
            );
        }
        return true;
    };
}

/**
 * Deletes the table around the selection, if any.
 */
function deleteTable(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
    const $pos = state.selection.$anchor;
    for (let d = $pos.depth; d > 0; d--) {
        const node = $pos.node(d);
        if (node.type.spec.tableRole == "table") {
            if (dispatch) dispatch(state.tr.delete($pos.before(d), $pos.after(d)).scrollIntoView());
            return true;
        }
    }
    return false;
}

/**
 * Deletes the content of the selected cells, if they are not empty.
 */
function deleteCellSelection(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
    const sel = state.selection;
    if (!(sel instanceof ContentTableCellSelection)) return false;
    if (dispatch) {
        const tr = state.tr;
        const baseContent = contentTableNodeTypes(state.schema).cell.createAndFill()!.content;
        sel.forEachCell((cell, pos) => {
            if (!cell.content.eq(baseContent))
                tr.replace(
                    tr.mapping.map(pos + 1),
                    tr.mapping.map(pos + cell.nodeSize - 1),
                    new Slice(baseContent, 0, 0),
                );
        });
        if (tr.docChanged) dispatch(tr);
    }
    return true;
}

export {
    goToNextCell as contentTableCommandGoToNextCell,
    deleteTable as contentTableCommandDeleteTable,
    deleteCellSelection as contentTableCommandDeleteCellSelection,
    addColumnBefore,
    addColumnAfter,
    deleteColumn,
    addRowBefore,
    addRowAfter,
    deleteRow,
};
