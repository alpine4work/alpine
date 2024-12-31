/**
 * NOTE(rohitt-gupta, 2024-11-26): This file has been modified to remove
 * features we don't use and customize the user experience. You can find the
 * original file in the `prosemirror-tables` package at:
 * https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/copypaste.ts
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

// Utilities used for copy/paste handling.
//
// This module handles pasting cell content into tables, or pasting
// anything into a cell selection, as replacing a block of cells with
// the content of the selection. When pasting cells into a cell, that
// involves placing the block of pasted content so that its top left
// aligns with the selection cell, optionally extending the table to
// the right or bottom to make sure it is large enough. Pasting into a
// cell selection is different, here the cells in the selection are
// clipped to the selection's rectangle, optionally repeating the
// pasted cells when they are smaller than the selection.

import {Fragment, Node, NodeType, Schema, Slice} from "prosemirror-model";

import {EditorState, Transaction} from "prosemirror-state";
import {Transform} from "prosemirror-transform";
import {getPlatformWithoutListening} from "~/client/remix/platform_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {ContentTableCellSelection} from "~/shared/content/table/content_table_cell_selection.js";
import {
    ContentTableMap,
    ContentTableMapColWidths,
    ContentTableMapRect,
} from "~/shared/content/table/content_table_map.js";
import {assert} from "~/shared/helpers/control/assert.js";

type Area = {width: number; height: number; rows: Array<Fragment>};

// Utilities to help with copying and pasting table cells

/**
 * Get a rectangular area of cells from a slice, or null if the outer
 * nodes of the slice aren't table cells or rows.
 */
export function pastedContentTableCells(slice: Slice): Area | null {
    if (!slice.size) return null;
    let {content, openStart, openEnd} = slice;
    while (
        content.childCount == 1 &&
        ((openStart > 0 && openEnd > 0) || content.child(0).type.name === "table")
    ) {
        openStart--;
        openEnd--;
        content = content.child(0).content;
    }
    const first = content.child(0);
    const schema = first.type.schema;
    const rows = [];
    if (first.type.name === "tableRow") {
        for (let i = 0; i < content.childCount; i++) {
            let cells = content.child(i).content;
            const left = i ? 0 : Math.max(0, openStart - 1);
            const right = i < content.childCount - 1 ? 0 : Math.max(0, openEnd - 1);
            if (left || right)
                cells = fitSlice(schema.nodes.tableRow!, new Slice(cells, left, right)).content;
            rows.push(cells);
        }
    } else if (first.type.name === "tableCell") {
        rows.push(
            openStart || openEnd
                ? fitSlice(schema.nodes.tableRow!, new Slice(content, openStart, openEnd)).content
                : content,
        );
    } else {
        return null;
    }
    return ensureRectangular(schema, rows);
}

// Compute the width and height of a set of cells, and make sure each
// row has the same number of cells.
function ensureRectangular(schema: Schema, rows: Array<Fragment>): Area {
    const widths: ContentTableMapColWidths = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        for (let j = row.childCount - 1; j >= 0; j--) {
            for (let r = i; r < i + 1; r++) {
                widths[r] = (widths[r] || 0) + 1;
            }
        }
    }
    let width = 0;
    for (let r = 0; r < widths.length; r++) width = Math.max(width, widths[r] || 0);
    for (let r = 0; r < widths.length; r++) {
        if (r >= rows.length) rows.push(Fragment.empty);
        if (widths[r]! < width) {
            const empty = schema.nodes.tableCell!.createAndFill()!;
            const cells: Array<Node> = [];
            for (let i = widths[r]!; i < width; i++) {
                cells.push(empty);
            }
            rows[r] = rows[r]!.append(Fragment.from(cells));
        }
    }
    return {height: rows.length, width, rows};
}

export function fitSlice(nodeType: NodeType, slice: Slice): Node {
    const node = nodeType.createAndFill()!;
    const tr = new Transform(node).replace(0, node.content.size, slice);
    return tr.doc;
}

/**
 * Clip or extend (repeat) the given set of cells to cover the given
 * width and height.
 *
 * @internal
 */
export function clipContentTableCells(
    {width, height, rows}: Area,
    newWidth: number,
    newHeight: number,
): Area {
    // Handle width changes
    if (width != newWidth) {
        const newRows: Array<Fragment> = [];
        for (let row = 0; row < rows.length; row++) {
            const frag = rows[row]!;
            const cells = [];

            // Repeat cells to fill the new width
            for (let col = 0; col < newWidth; col++) {
                const cell = frag.child(col % frag.childCount);
                cells.push(cell);
            }
            newRows.push(Fragment.from(cells));
        }
        rows = newRows;
        width = newWidth;
    }

    // Handle height changes
    if (height != newHeight) {
        const newRows = [];
        for (let row = 0; row < newHeight; row++) {
            // Repeat rows to fill the new height
            const source = rows[row % height]!;
            newRows.push(source);
        }
        rows = newRows;
        height = newHeight;
    }

    return {width, height, rows};
}

// Make sure a table has at least the given width and height. Return
// true if something was changed.
function growContentTable(
    tr: Transaction,
    map: ContentTableMap,
    table: Node,
    start: number,
    width: number,
    height: number,
    mapFrom: number,
): boolean {
    const schema = tr.doc.type.schema;
    let empty;
    let changed = false;

    // Ensure width and height are valid
    width = Math.max(map.width, width);
    height = Math.max(map.height, height);

    if (width > map.width) {
        changed = true;
        // First update the columnsWidth array
        const newColumnsWidth = [...(table.attrs.columnsWidth || [])];

        const columnCount = table.firstChild?.childCount ?? 2;

        let defaultWidthVar =
            contentStyles.blockMaxWidthRem[getPlatformWithoutListening()] / columnCount;

        defaultWidthVar = Math.max(defaultWidthVar, 6.25);

        const defaultWidth =
            newColumnsWidth.length > 0
                ? Math.max(...newColumnsWidth.filter(w => w > 0)) || defaultWidthVar
                : defaultWidthVar;

        for (let i = map.width; i < width; i++) {
            newColumnsWidth.push(defaultWidth);
        }
        tr.setNodeMarkup(start - 1, null, {
            ...table.attrs,
            columnsWidth: newColumnsWidth,
        });

        // Then add cells to each row
        for (let row = 0, rowEnd = 0; row < map.height; row++) {
            const rowNode = table.child(row);
            rowEnd += rowNode.nodeSize;
            const cells: Array<Node> = [];
            empty = empty || schema.nodes.tableCell!.createAndFill()!;
            for (let i = map.width; i < width; i++) {
                cells.push(empty);
            }
            tr.insert(tr.mapping.slice(mapFrom).map(rowEnd - 1 + start), cells);
        }
    }

    if (height > map.height) {
        changed = true;
        const cells = [];
        empty = empty || schema.nodes.tableCell!.createAndFill()!;
        // Use the final width after potential width growth
        for (let i = 0; i < width; i++) {
            cells.push(empty);
        }

        const emptyRow = schema.nodes.tableRow!.create(null, Fragment.from(cells));
        const rows = [];
        for (let i = map.height; i < height; i++) rows.push(emptyRow);
        tr.insert(tr.mapping.slice(mapFrom).map(start + table.nodeSize - 2), rows);
    }

    return changed;
}

/**
 * Insert the given set of cells (as returned by `pastedCells`) into a
 * table, at the position pointed at by rect.
 */
export function insertContentTableCells(
    state: EditorState,
    dispatch: (tr: Transaction) => void,
    tableStart: number,
    rect: ContentTableMapRect,
    cells: Area,
): void {
    let table = tableStart ? state.doc.nodeAt(tableStart - 1) : state.doc;
    assert(table, "No table found");
    let map = ContentTableMap.get(table);
    const {top, left} = rect;

    // Calculate the required dimensions after paste
    const pasteWidth = cells.width;
    const pasteHeight = cells.height;

    const right = Math.min(left + pasteWidth, map.width + pasteWidth);
    const bottom = Math.min(top + pasteHeight, map.height + pasteHeight);

    const tr = state.tr;
    let mapFrom = 0;

    function recomp(): void {
        table = tableStart ? tr.doc.nodeAt(tableStart - 1) : tr.doc;
        assert(table, "No table found");
        map = ContentTableMap.get(table);
        mapFrom = tr.mapping.maps.length;
    }

    // First grow the table if needed
    if (growContentTable(tr, map, table, tableStart, right, bottom, mapFrom)) {
        recomp();
    }

    // Then replace cells
    try {
        for (let row = top; row < bottom; row++) {
            if (row - top >= cells.rows.length) break;

            const from = map.positionAt(row, left, table);
            const to = map.positionAt(row, Math.min(right, map.width), table);

            if (from === null || to === null) continue;

            tr.replace(
                tr.mapping.slice(mapFrom).map(from + tableStart),
                tr.mapping.slice(mapFrom).map(to + tableStart),
                new Slice(cells.rows[row - top]!, 0, 0),
            );
        }

        // Recompute after cell replacement
        recomp();

        // Try to set selection
        try {
            // First try: select the entire pasted area
            const $anchorCell = tr.doc.resolve(tableStart + map.positionAt(top, left, table));
            const lastRow = Math.min(bottom - 1, map.height - 1);
            const lastCol = Math.min(right - 1, map.width - 1);
            const $headCell = tr.doc.resolve(tableStart + map.positionAt(lastRow, lastCol, table));
            tr.setSelection(new ContentTableCellSelection($anchorCell, $headCell));
        } catch (e) {
            // Second try: select just the first cell of the paste
            try {
                const $cell = tr.doc.resolve(tableStart + map.positionAt(top, left, table));
                tr.setSelection(new ContentTableCellSelection($cell));
            } catch (e) {
                // If all selection attempts fail, just log a warning
                console.warn("Could not set table selection after paste");
            }
        }

        dispatch(tr);
    } catch (e) {
        console.warn("Error during table paste operation:", e);
    }
}
