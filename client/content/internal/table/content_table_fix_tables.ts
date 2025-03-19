/**
 * NOTE(rohitt-gupta, 2024-11-26): This file has been modified to remove
 * features we don't use and customize the user experience. You can find the
 * original file in the `prosemirror-tables` package at:
 * https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/fixtables.ts
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

// This file defines helpers for normalizing tables, making sure each row has the same width
// and that the columnWidths array matches the actual table structure.

import {Node} from "prosemirror-model";
import {EditorState, PluginKey, Transaction} from "prosemirror-state";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";

const fixTablesKey = new PluginKey<{contentTableFixTables: boolean}>("fixContentTables");

/**
 * Helper for iterating through the nodes in a document that changed
 * compared to the given previous document. Useful for avoiding
 * duplicate work on each transaction.
 */
function changedDescendants(
    old: Node,
    cur: Node,
    offset: number,
    f: (node: Node, pos: number) => void,
): void {
    const oldSize = old.childCount,
        curSize = cur.childCount;
    outer: for (let i = 0, j = 0; i < curSize; i++) {
        const child = cur.child(i);
        for (let scan = j, e = Math.min(oldSize, i + 3); scan < e; scan++) {
            if (old.child(scan) == child) {
                j = scan + 1;
                offset += child.nodeSize;
                continue outer;
            }
        }
        f(child, offset);
        if (j < oldSize && old.child(j).sameMarkup(child))
            changedDescendants(old.child(j), child, offset + 1, f);
        else child.nodesBetween(0, child.content.size, f, offset + 1);
        offset += child.nodeSize;
    }
}

/**
 * Inspect all tables in the given state's document and return a
 * transaction that fixes them, if necessary. If `oldState` was
 * provided, that is assumed to hold a previous, known-good state,
 * which will be used to avoid re-scanning unchanged parts of the
 * document.
 */
export function fixContentTables(
    state: EditorState,
    oldState?: EditorState,
): Transaction | undefined {
    let tr: Transaction | undefined;
    const check = (node: Node, pos: number) => {
        if (node.type.name === "table") tr = fixTable(state, node, pos, tr);
    };
    if (!oldState) state.doc.descendants(check);
    else if (oldState.doc != state.doc) changedDescendants(oldState.doc, state.doc, 0, check);
    return tr;
}

// Fix the given table, if necessary. Will append to the transaction
// it was given, if non-null, or create a new one if necessary.
function fixTable(
    state: EditorState,
    table: Node,
    tablePos: number,
    tr: Transaction | undefined,
): Transaction | undefined {
    const tableMap = ContentTableMap.get(table);
    if (!tableMap.problems) return tr;
    if (!tr) tr = state.tr;

    // Track which rows need cells added to match the widest row
    const maxWidth = tableMap.width;
    const mustAdd: Array<number> = [];
    for (let i = 0; i < tableMap.height; i++) {
        const rowWidth = table.child(i).childCount;
        mustAdd.push(maxWidth - rowWidth);
    }

    // Fix columnWidths array if needed
    const currentColumnWidths = table.attrs.columnWidths || [];
    if (currentColumnWidths.length !== maxWidth) {
        // Trim columnWidths array
        const newColumnWidths = currentColumnWidths.slice(0, maxWidth);

        // Extend columnWidths array
        while (newColumnWidths.length < maxWidth) {
            newColumnWidths.push(1);
        }

        tr.setNodeAttribute(tablePos, "columnWidths", newColumnWidths);
    }

    // Add missing cells to rows
    let pos = tablePos + 1;
    for (let i = 0; i < tableMap.height; i++) {
        const row = table.child(i);
        const end = pos + row.nodeSize;
        const add = mustAdd[i]!;

        if (add > 0) {
            const nodes: Array<Node> = [];
            for (let j = 0; j < add; j++) {
                const cell = state.schema.nodes.tableCell!.createAndFill();
                if (cell) nodes.push(cell);
            }
            // Always add cells at the end of the row for consistency
            tr.insert(tr.mapping.map(end - 1), nodes);
        }
        pos = end;
    }

    return tr.setMeta(fixTablesKey, {contentTableFixTables: true});
}
