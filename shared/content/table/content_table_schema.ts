/**
 * NOTE(rohitt-gupta, 2024-11-26): This file has been modified to remove
 * features we don't use and customize the user experience. You can find the
 * original file in the `prosemirror-tables` package at:
 * https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/schema.ts
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

import {SchemaSpec} from "prosemirror-model";
import {tableCellClassName, tableClassName} from "~/shared/content/content_styles.js";
import {Schema} from "~/shared/schema/schema.js";

function createProsemirrorSchemaSpec<Schema extends SchemaSpec<string, string>>(
    schema: Schema,
): Schema {
    return schema;
}

export const contentTableProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
    nodes: {
        table: {
            content: "tableRow{2,}",
            group: "block",
            attrs: {
                columnsWidth: {
                    default: [],
                    schema: Schema.array(Schema.float),
                },
            },
            copyable: true,
            selectable: true,
            isolating: true,
            parseDOM: [{tag: "table"}],
            toDOM() {
                return ["table", {class: tableClassName}, ["tbody", 0]];
            },
        },
        tableRow: {
            content: "tableCell+",
            isolating: true,
            selectable: true,
            copyable: true,
            parseDOM: [{tag: "tr"}],
            toDOM() {
                return ["tr", 0];
            },
        },
        tableCell: {
            content: "tableBlock+",
            selectable: true,
            isolating: true,
            copyable: true,
            parseDOM: [{tag: "td"}],
            toDOM() {
                return ["td", {class: tableCellClassName}, 0];
            },
        },
    },
});
