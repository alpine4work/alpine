/**
 * NOTE(rohitt-gupta, 2024-11-26): This file has been modified to remove features
 * we don't use and customize the user experience. You can find the original file
 * in the `prosemirror-tables` package at:
 * https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/commands.ts
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

import {Fragment, Node, ResolvedPos, Slice} from "prosemirror-model";
import {Command, EditorState, Selection, TextSelection, Transaction} from "prosemirror-state";
import {
    ContentTableMapRectWithTable,
    isInContentTable,
    moveContentTableCellForward,
    selectedContentTableRect,
    selectionContentTableCell,
} from "~/client/web/content/state/table/content_table_client_util.js";
import type {ContentTableInputDirection} from "~/client/web/content/state/table/content_table_input.js";
import {resolveContentTableColumnWidthPx} from "~/client/web/content/state/table/helpers/resolve_content_table_column_width_px.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {ContentTableCellSelection} from "~/shared/content/table/content_table_cell_selection.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {Platform} from "~/shared/design/core/platform.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {partitionArray} from "~/shared/helpers/array/partition_array.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

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
    // `tableMaxColumnCountForMaintainingBlockWidth` (currently 4) columns. At which
    // point we start adding columns with an equal expected pixel width.
    if (tableMap.width < contentStyles.tableMaxColumnCountForMaintainingBlockWidth) {
        newColumnWidth = 1;
        newTableWidth = tableMap.tableWidth;
    } else {
        const platform: Platform = "desktop";
        const spacingScale: SpacingScale = "small";
        const remPx = remPxBySpacingScale[spacingScale];

        // The expected new column width in pixels. We run our calculations assuming
        // desktop mode with small rem pixel value. It shouldn't matter if our spacing
        // scale or platform is different. The table's relative values should scale
        // appropriately.
        //
        // If the user keeps pressing "add column" then before we start growing the table
        // they'll have a couple columns of equal width. When we start growing the table,
        // we want the new column to have the same width as the previous columns.
        const newColumnWidthPx =
            (contentStyles.blockMaxWidthRem.desktop * remPx) /
            contentStyles.tableMaxColumnCountForMaintainingBlockWidth;

        const oldColumnWidthPxs = resolveContentTableColumnWidthPx(
            spacingScale,
            contentStyles.blockMaxWidthRem[platform] * remPx,
            tableMap,
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
        // [1]:
        //     https://www.wolframalpha.com/input?i=solve+for+a+in+a+%2F+%28a+%2B+b%29+%3D+c+%2F+d
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
        const pos = tableMap.positionAt(row, columnIndex);
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
    {tableMap, table, tablePos}: ContentTableMapRectWithTable,
    columnIndex: number,
    transaction: Transaction,
) {
    // Update `columnWidths` array
    const newColumnWidths = [...tableMap.columnWidths];
    newColumnWidths.splice(columnIndex, 1);

    let newTableWidth: number;

    if (tableMap.tableWidth <= 1) {
        newTableWidth = 1;
    } else {
        const platform: Platform = "desktop";
        const spacingScale: SpacingScale = "small";
        const remPx = remPxBySpacingScale[spacingScale];

        const oldColumnWidthPxs = resolveContentTableColumnWidthPx(
            spacingScale,
            contentStyles.blockMaxWidthRem[platform] * remPx,
            tableMap,
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

    // Remove cells from each row in reverse so we don't need to map positions.
    for (let row = tableMap.height - 1; row >= 0; row--) {
        const pos = tableMap.positionAt(row, columnIndex);
        const cell = table.nodeAt(pos)!;
        transaction.delete(tablePos + pos, tablePos + pos + cell.nodeSize);
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

    const rect = selectedContentTableRect(state);
    if (rect.left === 0 && rect.right === rect.tableMap.width)
        return deleteContentTable(state, dispatch);

    const transaction = state.tr;

    for (let i = rect.right - 1; ; i--) {
        removeContentTableColumn(rect, i, transaction);
        const table = rect.tablePos ? transaction.doc.nodeAt(rect.tablePos - 1) : null;
        assert(table);
        rect.table = table;
        rect.tableMap = ContentTableMap.get(table);
        if (i === rect.left) break;
    }

    const $pos1 = transaction.doc.resolve(
        rect.tablePos + rect.tableMap.positionAt(0, Math.max(0, rect.left - 1)),
    );

    const $pos2 = transaction.doc.resolve(
        rect.tablePos +
            rect.tableMap.positionAt(rect.tableMap.height - 1, Math.max(0, rect.left - 1)),
    );

    transaction.setSelection(
        state.selection instanceof ContentTableCellSelection &&
            state.selection.$anchorCell.pos > state.selection.$headCell.pos
            ? new ContentTableCellSelection($pos2, $pos1)
            : new ContentTableCellSelection($pos1, $pos2),
    );

    dispatch?.(transaction);
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

export function toggleContentTableHeaderRow(tablePos: number): Command {
    return (state, dispatch) => {
        const table = state.doc.nodeAt(tablePos);
        if (!table || table.type.name !== "table") return false;

        if (dispatch) {
            const transaction = state.tr;
            transaction.setNodeAttribute(tablePos, "hasHeaderRow", !table.attrs.hasHeaderRow);
            dispatch(transaction);
        }

        return true;
    };
}

export function toggleContentTableHeaderColumn(tablePos: number): Command {
    return (state, dispatch) => {
        const table = state.doc.nodeAt(tablePos);
        if (!table || table.type.name !== "table") return false;

        if (dispatch) {
            const transaction = state.tr;
            transaction.setNodeAttribute(tablePos, "hasHeaderColumn", !table.attrs.hasHeaderColumn);
            dispatch(transaction);
        }

        return true;
    };
}

function removeContentTableRow(
    tr: Transaction,
    {table, tablePos: tableStart}: ContentTableMapRectWithTable,
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

    const rect = selectedContentTableRect(state);
    if (rect.top === 0 && rect.bottom === rect.tableMap.height)
        return deleteContentTable(state, dispatch);

    const transaction = state.tr;

    for (let i = rect.bottom - 1; ; i--) {
        removeContentTableRow(transaction, rect, i);
        const table = rect.tablePos ? transaction.doc.nodeAt(rect.tablePos - 1) : null;
        assert(table);
        rect.table = table;
        rect.tableMap = ContentTableMap.get(rect.table);
        if (i === rect.top) break;
    }

    const $pos1 = transaction.doc.resolve(
        rect.tablePos + rect.tableMap.positionAt(Math.max(0, rect.top - 1), 0),
    );

    const $pos2 = transaction.doc.resolve(
        rect.tablePos +
            rect.tableMap.positionAt(Math.max(0, rect.top - 1), rect.tableMap.width - 1),
    );

    transaction.setSelection(
        state.selection instanceof ContentTableCellSelection &&
            state.selection.$anchorCell.pos > state.selection.$headCell.pos
            ? new ContentTableCellSelection($pos2, $pos1)
            : new ContentTableCellSelection($pos1, $pos2),
    );

    dispatch?.(transaction);
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
            if (dispatch) {
                const transaction = state.tr.replace(
                    $pos.before(d),
                    $pos.after(d),
                    new Slice(Fragment.from(state.doc.type.schema.nodes.paragraph!.create()), 0, 0),
                );

                transaction.setSelection(
                    Selection.near(transaction.doc.resolve($pos.before(d)), 1),
                );

                dispatch?.(transaction.scrollIntoView());
            }
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
    const selection = state.selection;
    if (!(selection instanceof ContentTableCellSelection)) return false;

    const transaction = state.tr;
    const emptyCellNode = state.schema.nodes.tableCell!.createAndFill()!.content;
    selection.forEachCell((cell, pos) => {
        if (!cell.content.eq(emptyCellNode)) {
            transaction.replace(
                transaction.mapping.map(pos + 1),
                transaction.mapping.map(pos + cell.nodeSize - 1),
                new Slice(emptyCellNode, 0, 0),
            );
        }
    });

    if (transaction.docChanged) {
        dispatch?.(transaction);
    }
    // If all cells are already empty then we delete the selected rows/columns even the
    // table if the full table is selected.
    else {
        const rect = selectedContentTableRect(state);

        if (rect.top === 0 && rect.bottom === rect.tableMap.height) {
            if (rect.left === 0 && rect.right === rect.tableMap.width) {
                deleteContentTable(state, dispatch);
            } else {
                deleteContentTableColumn(state, dispatch);
            }
        } else {
            if (rect.left === 0 && rect.right === rect.tableMap.width) {
                deleteContentTableRow(state, dispatch);
            }
        }
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

/**
 * Move a range of table rows to a new position. The table row range is between
 * `startRowIndex` (inclusive) and `endRowIndex` (exclusive).
 *
 * Produces a transaction that deletes rows from their old position and inserts
 * rows into their new position. Any conflicting transaction steps in cells outside
 * of the moved rows will be mapped appropriately but any conflicting transaction
 * steps within the moved rows will be lost.
 */
export function moveContentTableRow(
    tablePos: number,
    startRowIndex: number,
    endRowIndex: number,
    newRowIndex: number,
): Command {
    return (state, dispatch) => {
        const oldTable = state.doc.resolve(tablePos).parent;
        if (oldTable.type.name !== "table") return false;

        const oldTableMap = ContentTableMap.get(oldTable);

        if (newRowIndex < 0) return false;
        if (newRowIndex > oldTableMap.height) return false;

        if (endRowIndex <= startRowIndex) return false;
        if (startRowIndex < 0) return false;
        if (endRowIndex > oldTableMap.height) return false;

        // Rows are moved back to the location they started.
        if (startRowIndex <= newRowIndex && newRowIndex <= endRowIndex) return false;

        const transaction = state.tr;

        let deletedNodeSize = 0;

        // Delete the rows we're moving. We delete in reverse order so we can use old table
        // positions.
        for (
            let deleteRowIndex = endRowIndex - 1;
            deleteRowIndex >= startRowIndex;
            deleteRowIndex--
        ) {
            const tableRow = oldTable.content.content[deleteRowIndex]!;

            // we need exact one cell, not more than one not less than one. if we don't get
            // exactly one cell, throw.
            const cells = oldTableMap.cellsInRect({
                left: 0,
                right: 1,
                top: deleteRowIndex,
                bottom: deleteRowIndex + 1,
            });
            assert(cells.length === 1);

            const $cell = state.doc.resolve(tablePos + cells[0]!);
            assert($cell.parent === tableRow);

            deletedNodeSize += $cell.parent.nodeSize;
            transaction.delete($cell.pos - 1, $cell.pos - 1 + $cell.parent.nodeSize);
        }

        let insertPos: number;
        if (newRowIndex === oldTableMap.height) {
            insertPos = tablePos - 1 + oldTable.nodeSize - 1;
        } else {
            const cells = oldTableMap.cellsInRect({
                left: 0,
                right: 1,
                top: newRowIndex,
                bottom: newRowIndex + 1,
            });

            assert(cells.length === 1);

            insertPos = tablePos + cells[0]! - 1;
        }

        // Insert the nodes we're moving in their new position. We insert in reverse order
        // so we can use the same `insertPos` each time.
        for (
            let insertRowIndex = endRowIndex - 1;
            insertRowIndex >= startRowIndex;
            insertRowIndex--
        ) {
            const tableRow = oldTable.content.content[insertRowIndex]!;

            if (newRowIndex < startRowIndex) {
                // case 1: moving rows up in the table. therefore `insertPos` doesn't have to be
                // mapped since the deletion happens below `insertPos`
                transaction.insert(insertPos, tableRow);
            } else {
                // case 2: moving rows down in the table so first we update our insertPos by
                // removing the size of the deleted nodes from calculated insertPos
                transaction.insert(insertPos - deletedNodeSize, tableRow);
            }
        }

        const newTable = transaction.doc.resolve(tablePos).parent;
        const newTableMap = ContentTableMap.get(newTable);

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

/**
 * Move a range of table columns to a new position. The table column range is
 * between `startColumnIndex` (inclusive) and `endColumnIndex` (exclusive).
 *
 * Produces a transaction that, for every table row, deletes cells from their old
 * position and inserts cells into their new position. Any conflicting transaction
 * steps in cells outside of the moved cells will be mapped appropriately but any
 * conflicting transaction steps within the moved cells will be lost.
 *
 * Since we need to update each row individually, the transaction produced by this
 * command may be quite large! It'll have
 * `rowCount * (endColumnIndex - startColumnIndex) * 2` steps. An alternative
 * implementation if we run into large transaction problems is to produce a new
 * table node with moved columns and replace the entire table at once. This
 * implementation would only have one step but any conflicting transaction steps
 * would be lost. (The previous implementation of this function replaced the whole
 * table. See the parent git commit.)
 */
export function moveContentTableColumn(
    tablePos: number,
    startColumnIndex: number,
    endColumnIndex: number,
    newColumnIndex: number,
): Command {
    return (state, dispatch) => {
        const oldTable = state.doc.resolve(tablePos).node();
        if (oldTable.type.name !== "table") return false;

        const oldTableMap = ContentTableMap.get(oldTable);

        if (newColumnIndex < 0) return false;
        if (newColumnIndex > oldTableMap.width) return false;

        if (endColumnIndex <= startColumnIndex) return false;
        if (startColumnIndex < 0) return false;
        if (endColumnIndex > oldTableMap.width) return false;

        // Columns are moved back to the location they started.
        if (startColumnIndex <= newColumnIndex && newColumnIndex <= endColumnIndex) return false;

        const transaction = state.tr;

        // separation of moved columns
        const [movedColumnWidths, newColumnWidths] = partitionArray(
            oldTableMap.columnWidths,
            (oldColumnWidth, columnIndex) =>
                startColumnIndex <= columnIndex && columnIndex < endColumnIndex,
        );

        if (newColumnIndex < startColumnIndex) {
            // Insert moved columns before the target position moving to the left
            newColumnWidths.splice(newColumnIndex, 0, ...movedColumnWidths);
        } else {
            // moving to the right! Insert moved columns after accounting for the removal
            newColumnWidths.splice(
                newColumnIndex - (endColumnIndex - startColumnIndex),
                0,
                ...movedColumnWidths,
            );
        }

        transaction.setNodeAttribute(tablePos - 1, "columnWidths", newColumnWidths);

        let tableRowNodeSize = 0;

        for (let rowIndex = 0; rowIndex < oldTableMap.height; rowIndex++) {
            const oldTableRow = oldTable.content.content[rowIndex]!;

            let insertPos: number;

            // this if- else branch is for calculating the insertPos wrt the doc
            if (newColumnIndex === oldTableMap.width) {
                // if the newColumnIndex is the last column index then this branch will calculate
                // the insertPos
                insertPos = tablePos + tableRowNodeSize + oldTableRow.nodeSize - 1;
            } else {
                // get the first cell of the newColumnIndex column and calculate and then calculate
                // the insertPos by getting the position of this cell
                const cells = oldTableMap.cellsInRect({
                    left: newColumnIndex,
                    right: newColumnIndex + 1,
                    top: rowIndex,
                    bottom: rowIndex + 1,
                });
                assert(cells.length === 1);

                insertPos = tablePos + cells[0]!;
            }

            let insertedNodeSize = 0;

            // Insert the nodes we're moving in their new position. We insert in reverse order
            // so we can use the same `insertPos` each time.
            for (
                let insertColumnIndex = endColumnIndex - 1;
                insertColumnIndex >= startColumnIndex;
                insertColumnIndex--
            ) {
                const tableCell = oldTableRow.content.content[insertColumnIndex]!;

                insertedNodeSize += tableCell.nodeSize;

                transaction.insert(insertPos, tableCell);
            }

            // Delete the cells we're moving. We delete in reverse order so we can use old
            // table positions.
            for (
                let deleteColumnIndex = endColumnIndex - 1;
                deleteColumnIndex >= startColumnIndex;
                deleteColumnIndex--
            ) {
                const tableCell = oldTableRow.content.content[deleteColumnIndex]!;

                const cells = oldTableMap.cellsInRect({
                    left: deleteColumnIndex,
                    right: deleteColumnIndex + 1,
                    top: rowIndex,
                    bottom: rowIndex + 1,
                });
                assert(cells.length === 1);

                const $cell = state.doc.resolve(tablePos + cells[0]!);
                assert($cell.parent === oldTableRow);
                assert($cell.nodeAfter === tableCell);

                if (newColumnIndex < startColumnIndex) {
                    transaction.delete(
                        $cell.pos + insertedNodeSize,
                        $cell.pos + $cell.nodeAfter.nodeSize + insertedNodeSize,
                    );
                } else {
                    transaction.delete($cell.pos, $cell.pos + $cell.nodeAfter.nodeSize);
                }
            }

            tableRowNodeSize += oldTableRow.nodeSize;
        }

        const newTable = transaction.doc.resolve(tablePos).parent;
        const newTableMap = ContentTableMap.get(newTable);

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
