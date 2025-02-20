/**
 * NOTE(rohitt-gupta, 2024-11-26): This file has been modified to remove
 * features we don't use and customize the user experience. You can find the
 * original file in the `prosemirror-tables` package at:
 * https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/commands.ts
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

import {Node, ResolvedPos, Slice} from "prosemirror-model";
import {Command, EditorState, TextSelection, Transaction} from "prosemirror-state";
import {resolveContentTableColumnWidthPx} from "~/client/content/internal/table/content_editor_table_plugin.js";
import {
    isInContentTable,
    moveContentTableCellForward,
    selectionContentTableCell,
} from "~/client/content/internal/table/content_table_client_util.js";
import type {ContentTableInputDirection} from "~/client/content/internal/table/content_table_input.js";
import {contentStyles} from "~/client/styles/styles.js";
import {ContentTableCellSelection} from "~/shared/content/table/content_table_cell_selection.js";
import {ContentTableMap, ContentTableMapRect} from "~/shared/content/table/content_table_map.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {partitionArray} from "~/shared/helpers/array/partition_array.js";

type ContentTableRect = ContentTableMapRect & {
    tablePos: number;
    table: Node;
    tableMap: ContentTableMap;
};

/**
 * Helper to get the selected rectangle in a table, if any. Adds table
 * map, table node, and table start offset to the object for convenience.
 */
function selectedContentTableRect(state: EditorState): ContentTableRect {
    const sel = state.selection;
    const $cell = selectionContentTableCell(state.selection);
    const table = $cell.node(-1);
    const tablePos = $cell.start(-1);
    const tableMap = ContentTableMap.get(table);
    const rect =
        sel instanceof ContentTableCellSelection
            ? tableMap.rectBetween(sel.$anchorCell.pos - tablePos, sel.$headCell.pos - tablePos)
            : tableMap.findCell($cell.pos - tablePos);
    return {...rect, tablePos, tableMap, table};
}

/**
 * Add a column at the given position in a table.
 */
function addContentTableColumn(
    {tablePos, table, tableMap}: {tablePos: number; table: Node; tableMap: ContentTableMap},
    columnIndex: number,
    transaction: Transaction,
) {
    let newColumnWidth: number;
    let newTableWidth: number;

    // When adding columns we keep the table width constant up until
    // `tableMaxColumnCountForMaintainingBlockWidth` (currently 4) columns. At
    // which point we start adding columns with an equal expected pixel width.
    if (tableMap.width < contentStyles.tableMaxColumnCountForMaintainingBlockWidth) {
        newColumnWidth = 1;
        newTableWidth = tableMap.tableWidth;
    } else {
        const remPx = remPxBySpacingScale.small;

        // The expected new column width in pixels. We run our calculations assuming
        // desktop mode with small rem pixel value. It shouldn't matter if our spacing
        // scale or platform is different. The table's relative values should scale
        // appropriately.
        //
        // If the user keeps pressing "add column" then before we start growing the
        // table they'll have a couple columns of equal width. When we start growing
        // the table, we want the new column to have the same width as the previous
        // columns.
        const newColumnWidthPx =
            (contentStyles.blockMaxWidthRem.desktop * remPx) /
            contentStyles.tableMaxColumnCountForMaintainingBlockWidth;

        const oldColumnWidthPxs = resolveContentTableColumnWidthPx(
            tableMap.totalColumnWidth,
            tableMap.columnWidths,
            contentStyles.blockMaxWidthRem.desktop * tableMap.tableWidth * remPx,
            contentStyles.tableColumnMinWidthRem * remPx,
        );

        let oldTotalColumnWidthPx = 0;
        for (const oldColumnWidthPx of oldColumnWidthPxs) oldTotalColumnWidthPx += oldColumnWidthPx;
        const newTotalColumnWidthPx = oldTotalColumnWidthPx + newColumnWidthPx;

        // To calculate `newColumnWidth` we use the following equation:
        //
        // ```
        // newColumnWidth / (newColumnWidth + oldTotalColumnWidth) = newColumnWidthPx / newTotalColumnWidthPx
        // ```
        //
        // In this equation, the only unknown variable is `newColumnWidth`. Solving for
        // `newColumnWidth` gives us ([source][1]):
        //
        // ```
        // newColumnWidth = -((oldTotalColumnWidth * newColumnWidthPx) / (newColumnWidthPx - newTotalColumnWidthPx))
        // ```
        //
        // [1]: https://www.wolframalpha.com/input?i=solve+for+a+in+a+%2F+%28a+%2B+b%29+%3D+c+%2F+d
        newColumnWidth = -(
            (tableMap.totalColumnWidth * newColumnWidthPx) /
            (newColumnWidthPx - newTotalColumnWidthPx)
        );

        newTableWidth = tableMap.tableWidth * (newTotalColumnWidthPx / oldTotalColumnWidthPx);
    }

    // Update columnWidths array
    const newColumnWidths = [...tableMap.columnWidths];
    newColumnWidths.splice(columnIndex, 0, newColumnWidth);

    transaction.setNodeAttribute(tablePos - 1, "columnWidths", newColumnWidths);

    if (newTableWidth !== tableMap.tableWidth)
        transaction.setNodeAttribute(tablePos - 1, "tableWidth", newTableWidth);

    // Add cells to each row
    for (let row = 0; row < tableMap.height; row++) {
        const pos = tableMap.positionAt(row, columnIndex, table);
        const type = table.type.schema.nodes.tableCell!;
        transaction.insert(transaction.mapping.map(tablePos + pos), type.createAndFill()!);
    }

    return transaction;
}

/**
 * Command to add a column before the column with the selection.
 */
export function addContentTableColumnBeforeSelection(
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
): boolean {
    if (!isInContentTable(state)) return false;

    if (dispatch) {
        const rect = selectedContentTableRect(state);
        dispatch(addContentTableColumn(rect, rect.left, state.tr));
    }

    return true;
}

/**
 * Command to add a column after the column with the selection.
 */
export function addContentTableColumnAfterSelection(
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
): boolean {
    if (!isInContentTable(state)) return false;

    if (dispatch) {
        const rect = selectedContentTableRect(state);
        dispatch(addContentTableColumn(rect, rect.right, state.tr));
    }

    return true;
}

/**
 * Command to add a column after the column with the selection.
 */
export function addContentTableColumnAtIndex(tablePos: number, columnIndex: number): Command {
    return (state, dispatch) => {
        const table = state.doc.resolve(tablePos).node();
        if (table.type.name !== "table") return false;

        if (dispatch) {
            const tableMap = ContentTableMap.get(table);
            dispatch(addContentTableColumn({tablePos, table, tableMap}, columnIndex, state.tr));
        }

        return true;
    };
}

function removeContentTableColumn(
    {tableMap, table, tablePos}: ContentTableRect,
    columnIndex: number,
    transaction: Transaction,
) {
    // Update columnWidths array
    const newColumnWidths = [...tableMap.columnWidths];
    newColumnWidths.splice(columnIndex, 1);

    let newTableWidth: number;

    if (tableMap.tableWidth <= 1) {
        newTableWidth = 1;
    } else {
        const remPx = remPxBySpacingScale.small;

        const oldColumnWidthPxs = resolveContentTableColumnWidthPx(
            tableMap.totalColumnWidth,
            tableMap.columnWidths,
            contentStyles.blockMaxWidthRem.desktop * tableMap.tableWidth * remPx,
            contentStyles.tableColumnMinWidthRem * remPx,
        );

        const oldColumnWidthPx = oldColumnWidthPxs[columnIndex]!;

        const oldTotalColumnWidthPx =
            contentStyles.blockMaxWidthRem.desktop * tableMap.tableWidth * remPx;
        const newTotalColumnWidthPx = oldTotalColumnWidthPx - oldColumnWidthPx;

        newTableWidth = Math.max(
            1,
            tableMap.tableWidth * (newTotalColumnWidthPx / oldTotalColumnWidthPx),
        );
    }

    transaction.setNodeAttribute(tablePos - 1, "columnWidths", newColumnWidths);

    if (newTableWidth !== tableMap.tableWidth)
        transaction.setNodeAttribute(tablePos - 1, "tableWidth", newTableWidth);

    // Remove cells from each row
    for (let row = 0; row < tableMap.height; row++) {
        const pos = tableMap.positionAt(row, columnIndex, table);
        const cell = table.nodeAt(pos)!;
        transaction.delete(
            transaction.mapping.map(tablePos + pos),
            transaction.mapping.map(tablePos + pos + cell.nodeSize),
        );
    }
}

/**
 * Command function that removes the selected columns from a table.
 */
export function deleteContentTableColumn(
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
): boolean {
    if (!isInContentTable(state)) return false;

    if (dispatch) {
        const rect = selectedContentTableRect(state);
        const transaction = state.tr;
        if (rect.left == 0 && rect.right == rect.tableMap.width) return false;
        for (let i = rect.right - 1; ; i--) {
            removeContentTableColumn(rect, i, transaction);
            if (i == rect.left) break;
            const table = rect.tablePos
                ? transaction.doc.nodeAt(rect.tablePos - 1)
                : transaction.doc;
            if (!table) {
                throw new RangeError("No table found");
            }
            rect.table = table;
            rect.tableMap = ContentTableMap.get(table);
        }
        dispatch(transaction);
    }

    return true;
}

/**
 * Add a table row at the given position
 */
function addContentTableRow(
    {tablePos, table, tableMap}: {tablePos: number; table: Node; tableMap: ContentTableMap},
    rowIndex: number,
    transaction: Transaction,
): Transaction {
    let rowPos = tablePos;
    for (let i = 0; i < rowIndex; i++) rowPos += table.child(i).nodeSize;

    const cells = [];
    for (let col = 0; col < tableMap.width; col++) {
        const type = table.type.schema.nodes.tableCell!;
        const node = type.createAndFill();
        if (node) cells.push(node);
    }

    transaction.insert(rowPos, table.type.schema.nodes.tableRow!.create(null, cells));
    return transaction;
}

/**
 * Add a table row before the selection.
 */
export function addContentTableRowBeforeSelection(
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
): boolean {
    if (!isInContentTable(state)) return false;

    if (dispatch) {
        const rect = selectedContentTableRect(state);
        dispatch(addContentTableRow(rect, rect.top, state.tr));
    }

    return true;
}

/**
 * Add a table row after the selection.
 */
export function addContentTableRowAfterSelection(
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
): boolean {
    if (!isInContentTable(state)) return false;

    if (dispatch) {
        const rect = selectedContentTableRect(state);
        dispatch(addContentTableRow(rect, rect.bottom, state.tr));
    }

    return true;
}

export function addContentTableRowAtIndex(tablePos: number, rowIndex: number): Command {
    return (state, dispatch) => {
        const table = state.doc.resolve(tablePos).node();
        if (table.type.name !== "table") return false;

        if (dispatch) {
            const tableMap = ContentTableMap.get(table);
            dispatch(addContentTableRow({tablePos, table, tableMap}, rowIndex, state.tr));
        }

        return true;
    };
}

function removeContentTableRow(
    tr: Transaction,
    {table, tablePos: tableStart}: ContentTableRect,
    row: number,
): void {
    let rowPos = 0;
    for (let i = 0; i < row; i++) rowPos += table.child(i).nodeSize;
    const nextRow = rowPos + table.child(row).nodeSize;
    tr.delete(rowPos + tableStart, nextRow + tableStart);
}

/**
 * Remove the selected rows from a table.
 */
export function deleteContentTableRow(
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
): boolean {
    if (!isInContentTable(state)) return false;
    if (dispatch) {
        const rect = selectedContentTableRect(state);
        const tr = state.tr;
        if (rect.top == 0 && rect.bottom == rect.tableMap.height) return false;
        for (let i = rect.bottom - 1; ; i--) {
            removeContentTableRow(tr, rect, i);
            if (i == rect.top) break;
            const table = rect.tablePos ? tr.doc.nodeAt(rect.tablePos - 1) : tr.doc;
            if (!table) {
                throw RangeError("No table found");
            }
            rect.table = table;
            rect.tableMap = ContentTableMap.get(rect.table);
        }
        dispatch(tr);
    }
    return true;
}

function findNextContentTableCell(
    $cell: ResolvedPos,
    dir: ContentTableInputDirection,
): number | null {
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
export function goToNextContentTableCell(direction: ContentTableInputDirection): Command {
    return function (state, dispatch) {
        if (!isInContentTable(state)) return false;
        const cell = findNextContentTableCell(
            selectionContentTableCell(state.selection),
            direction,
        );
        if (cell == null) return false;
        if (dispatch) {
            const $cell = state.doc.resolve(cell);
            dispatch(
                state.tr
                    .setSelection(TextSelection.between($cell, moveContentTableCellForward($cell)))
                    .scrollIntoView(),
            );
        }
        return true;
    };
}

/**
 * Deletes the table around the selection, if any.
 */
export function deleteContentTable(
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
): boolean {
    const $pos = state.selection.$anchor;
    for (let d = $pos.depth; d > 0; d--) {
        const node = $pos.node(d);
        if (node.type.name === "table") {
            if (dispatch) dispatch(state.tr.delete($pos.before(d), $pos.after(d)).scrollIntoView());
            return true;
        }
    }
    return false;
}

/**
 * Deletes the content of the selected cells, if they are not empty.
 */
export function deleteContentTableCellSelection(
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
): boolean {
    const sel = state.selection;
    if (!(sel instanceof ContentTableCellSelection)) return false;
    if (dispatch) {
        const tr = state.tr;
        const baseContent = state.schema.nodes.tableCell!.createAndFill()!.content;
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

export function selectContentTableColumn(tablePos: number, columnIndex: number): Command {
    return (state, dispatch) => {
        const table = state.doc.resolve(tablePos).node();
        if (table.type.name !== "table") return false;

        const tableMap = ContentTableMap.get(table);

        // Check if the index is valid
        if (columnIndex < 0 || columnIndex >= tableMap.width) return false;

        if (dispatch) {
            const cells = tableMap.cellsInRect({
                left: columnIndex,
                right: columnIndex + 1,
                top: 0,
                bottom: tableMap.height,
            });

            const head = tablePos + cells[0]!;
            const anchor = tablePos + cells[cells.length - 1]!;
            const $head = state.doc.resolve(head);
            const $anchor = state.doc.resolve(anchor);

            dispatch(state.tr.setSelection(new ContentTableCellSelection($anchor, $head)));
        }

        return true;
    };
}

export function selectContentTableRow(tablePos: number, rowIndex: number): Command {
    return (state, dispatch) => {
        const table = state.doc.resolve(tablePos).node();
        if (table.type.name !== "table") return false;

        const tableMap = ContentTableMap.get(table);

        // Check if the index is valid
        if (rowIndex < 0 || rowIndex >= tableMap.height) return false;

        if (dispatch) {
            const cells = tableMap.cellsInRect({
                left: 0,
                right: tableMap.width,
                top: rowIndex,
                bottom: rowIndex + 1,
            });

            const head = tablePos + cells[0]!;
            const anchor = tablePos + cells[cells.length - 1]!;
            const $head = state.doc.resolve(head);
            const $anchor = state.doc.resolve(anchor);

            dispatch(state.tr.setSelection(new ContentTableCellSelection($anchor, $head)));
        }

        return true;
    };
}

export function moveContentTableRow(
    tablePos: number,
    startRowIndex: number, // inclusive
    endRowIndex: number, // exclusive
    newRowIndex: number,
): Command {
    return (state, dispatch) => {
        const oldTable = state.doc.resolve(tablePos).node();
        if (oldTable.type.name !== "table") return false;

        // Rows are moved back to the location they started.
        if (startRowIndex <= newRowIndex && newRowIndex <= endRowIndex) return false;

        const [movedTableRows, newTableRows] = partitionArray(
            oldTable.content.content,
            (oldTableRow, rowIndex) => startRowIndex <= rowIndex && rowIndex < endRowIndex,
        );

        if (newRowIndex < startRowIndex) {
            newTableRows.splice(newRowIndex, 0, ...movedTableRows);
        } else {
            newTableRows.splice(newRowIndex - (endRowIndex - startRowIndex), 0, ...movedTableRows);
        }

        const newTable = oldTable.type.create(oldTable.attrs, newTableRows);
        const newTableMap = ContentTableMap.get(newTable);

        const transaction = state.tr;
        transaction.replaceWith(tablePos - 1, tablePos + oldTable.nodeSize - 1, newTable);

        const newCellSelection =
            newRowIndex < startRowIndex
                ? newTableMap.cellsInRect({
                      left: 0,
                      right: newTableMap.width,
                      top: newRowIndex,
                      bottom: newRowIndex + (endRowIndex - startRowIndex),
                  })
                : newTableMap.cellsInRect({
                      left: 0,
                      right: newTableMap.width,
                      top: newRowIndex - (endRowIndex - startRowIndex),
                      bottom: newRowIndex,
                  });

        transaction.setSelection(
            new ContentTableCellSelection(
                transaction.doc.resolve(tablePos + newCellSelection[0]!),
                transaction.doc.resolve(tablePos + newCellSelection[newCellSelection.length - 1]!),
            ),
        );

        dispatch?.(transaction);

        return true;
    };
}

export function moveContentTableColumn(
    tablePos: number,
    startColumnIndex: number, // inclusive
    endColumnIndex: number, // exclusive
    newColumnIndex: number,
): Command {
    return (state, dispatch) => {
        const oldTable = state.doc.resolve(tablePos).node();
        if (oldTable.type.name !== "table") return false;

        // Columns are moved back to the location they started.
        if (startColumnIndex <= newColumnIndex && newColumnIndex <= endColumnIndex) return false;

        const oldTableMap = ContentTableMap.get(oldTable);

        const [movedColumnWidths, newColumnWidths] = partitionArray(
            oldTableMap.columnWidths,
            (oldColumnWidth, columnIndex) =>
                startColumnIndex <= columnIndex && columnIndex < endColumnIndex,
        );

        if (newColumnIndex < startColumnIndex) {
            newColumnWidths.splice(newColumnIndex, 0, ...movedColumnWidths);
        } else {
            newColumnWidths.splice(
                newColumnIndex - (endColumnIndex - startColumnIndex),
                0,
                ...movedColumnWidths,
            );
        }

        const newTableRows = oldTable.content.content.map(oldTableRow => {
            const [movedTableCells, newTableCells] = partitionArray(
                oldTableRow.content.content,
                (oldTableCell, columnIndex) =>
                    startColumnIndex <= columnIndex && columnIndex < endColumnIndex,
            );

            if (newColumnIndex < startColumnIndex) {
                newTableCells.splice(newColumnIndex, 0, ...movedTableCells);
            } else {
                newTableCells.splice(
                    newColumnIndex - (endColumnIndex - startColumnIndex),
                    0,
                    ...movedTableCells,
                );
            }

            return oldTableRow.type.create(oldTableRow.attrs, newTableCells);
        });

        const newTable = oldTable.type.create(
            {...oldTable.attrs, columnWidths: newColumnWidths},
            newTableRows,
        );
        const newTableMap = ContentTableMap.get(newTable);

        const transaction = state.tr;
        transaction.replaceWith(tablePos - 1, tablePos + oldTable.nodeSize - 1, newTable);

        const newCellSelection =
            newColumnIndex < startColumnIndex
                ? newTableMap.cellsInRect({
                      left: newColumnIndex,
                      right: newColumnIndex + (endColumnIndex - startColumnIndex),
                      top: 0,
                      bottom: newTableMap.height,
                  })
                : newTableMap.cellsInRect({
                      left: newColumnIndex - (endColumnIndex - startColumnIndex),
                      right: newColumnIndex,
                      top: 0,
                      bottom: newTableMap.height,
                  });

        transaction.setSelection(
            new ContentTableCellSelection(
                transaction.doc.resolve(tablePos + newCellSelection[0]!),
                transaction.doc.resolve(tablePos + newCellSelection[newCellSelection.length - 1]!),
            ),
        );

        dispatch?.(transaction);

        return true;
    };
}
