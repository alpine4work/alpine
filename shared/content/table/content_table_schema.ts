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
// package at https://github.com/ProseMirror/prosemirror-tables/blob/master/src/schema.ts
//
import "~/shared/content/table/content_table_cell_selection.js";

import {NodeSpec, NodeType, Schema as ProsemirrorSchema} from "prosemirror-model";
import {tableCellClassName, tableClassName} from "~/shared/content/content_styles.js";
import {Schema} from "~/shared/schema/schema.js";

export const contentTableProsemirrorNodeSpec = {
    name: "table",
    content: "tableRow{2,}",
    group: "block",
    attrs: {
        isHeader: {default: true, schema: Schema.boolean},
        columnsWidth: {default: [], schema: Schema.array(Schema.float)},
    },
    copyable: true,
    selectable: true,
    isolating: true,
    tableRole: "table",
    parseDOM: [{tag: "table"}],
    toDOM() {
        return ["table", {class: tableClassName}, ["tbody", 0]] as const;
    },
};

export const contentTableRowProsemirrorNodeSpec = {
    name: "tableRow",
    content: "tableCell+",
    tableRole: "row",
    isolating: true,
    selectable: true,
    copyable: true,
    parseDOM: [{tag: "tr"}],
    toDOM() {
        return ["tr", 0] as const;
    },
};

export const contentTableCellProsemirrorNodeSpec = {
    name: "tableCell",
    content: "tableBlock+",
    tableRole: "cell",
    selectable: true,
    isolating: true,
    copyable: true,
    parseDOM: [{tag: "td"}],
    toDOM() {
        return ["td", {class: tableCellClassName}, 0] as const;
    },
};

// A function to get the node types for the table.
export function contentTableNodeTypes(
    schema: ProsemirrorSchema,
): Record<contentTableRole, NodeType> {
    return {
        table: schema.nodes.table as NodeType,
        row: schema.nodes.tableRow as NodeType,
        cell: schema.nodes.tableCell as NodeType,
    };
}
export type contentTableNodes = Record<"table" | "tableRow" | "tableCell", NodeSpec>;
export type contentTableRole = "table" | "row" | "cell";
