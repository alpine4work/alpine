/**
 * NOTE(rohitt-gupta, 2024-11-26): This file has been modified to remove features
 * we don't use and customize the user experience. You can find the original file
 * in the `prosemirror-tables` package at:
 * https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/schema.ts
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
import {SchemaSpec} from "prosemirror-model";
import {
    tableWrapper2ClassName,
    tableWrapper3ClassName,
    tableWrapperClassName,
} from "~/shared/design/core/constant_class_names.js";
import {Schema} from "~/shared/schema/schema.js";

function createProsemirrorSchemaSpec<Schema extends SchemaSpec<string, string>>(
    schema: Schema,
): Schema {
    return schema;
}

export const contentTableProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
    nodes: {
        table: {
            content: "tableRow+",
            group: "block",
            attrs: {
                // The width of each column in a table. Each width represents a fraction of the
                // available space in the table. We use CSS grid to layout the table so each width
                // is expressed with the [CSS `fr` unit][1].
                //
                // For example, say we have two columns and `columnWidths` is set to `[1, 3]`. To
                // compute the amount of space each column occupies we divide each individual width
                // value by the total after summing up all width values. So the total of all width
                // values here is 4 (1 + 3). So the percentage widths of our columns is 25% (1 / 4)
                // and 75% (3 / 4).
                //
                // If `columnWidths` is missing a value for a column (say a table has three columns
                // and the length of `columnWidths` is 2) then the default width of the column
                // is 1.
                //
                // Columns have a minimum and maximum width in pixels. So even if a column width in
                // this array is very small or very large the actual rendered column width will
                // still be in a reasonable bound.
                //
                // [1]: https://css-tricks.com/introduction-fr-css-unit/
                columnWidths: {
                    default: [],
                    schema: Schema.array(Schema.float),
                },

                // The width of the table as a percent of the block width. So for example, if
                // `tableWidth` is 1.2 that means the table is 20% wider than the block width.
                //
                // The minimum value of `tableWidth` is 1. Tables must be at least as wide as the
                // block width. Tables still have a maximum width in pixels that's the maximum
                // column width times the column count. A `tableWidth` value that creates a wider
                // table than that will be ignored.
                tableWidth: {
                    default: 1,
                    schema: Schema.float,
                },
                hasHeaderRow: {
                    default: false,
                    schema: Schema.boolean,
                },
                hasHeaderColumn: {
                    default: false,
                    schema: Schema.boolean,
                },
            },
            copyable: true,
            selectable: false,
            isolating: true,
            parseDOM: [
                {
                    tag: "table",
                    getAttrs: (dom: HTMLElement) => {
                        const columnWidthsAttributeString =
                            dom.getAttribute("data-cy-column-widths") || "";
                        const columnWidths = columnWidthsAttributeString
                            .split(",")
                            .map(columnWidthAttributeString => columnWidthAttributeString.trim())
                            .filter(Boolean)
                            .map(columnWidthAttributeString => {
                                let columnWidthAttribute;
                                try {
                                    columnWidthAttribute = JSON.parse(columnWidthAttributeString);
                                } catch {
                                    return 1;
                                }
                                const columnWidth =
                                    !isNaN(columnWidthAttribute) &&
                                    typeof columnWidthAttribute === "number"
                                        ? columnWidthAttribute
                                        : 1;
                                return columnWidth;
                            });

                        const tableWidthAttributeString = dom.getAttribute("data-cy-width") || "1";
                        let tableWidthAttribute;
                        try {
                            tableWidthAttribute = JSON.parse(tableWidthAttributeString);
                        } catch {
                            tableWidthAttribute = 1;
                        }
                        const tableWidth =
                            !isNaN(tableWidthAttribute) && typeof tableWidthAttribute === "number"
                                ? tableWidthAttribute
                                : 1;

                        const hasHeaderRow = dom.hasAttribute("data-cy-header-row");
                        const hasHeaderColumn = dom.hasAttribute("data-cy-header-column");

                        return {
                            columnWidths,
                            tableWidth,
                            hasHeaderRow,
                            hasHeaderColumn,
                        };
                    },
                },
            ],
            toDOM() {
                return [
                    "div",
                    {class: tableWrapperClassName},
                    [
                        "div",
                        {class: tableWrapper2ClassName},
                        ["div", {class: tableWrapper3ClassName}, ["table", ["tbody", 0]]],
                    ],
                ];
            },
        },
        tableRow: {
            content: "tableCell{2,}",
            isolating: true,
            selectable: false,
            copyable: true,
            parseDOM: [{tag: "tr"}],
            toDOM() {
                return ["tr", 0];
            },
        },
        tableCell: {
            content: "tableBlock+",
            selectable: false,
            isolating: true,
            copyable: true,
            parseDOM: [{tag: "td"}],
            toDOM() {
                return ["td", 0];
            },
        },
    },
});
