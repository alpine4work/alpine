import {Table} from "mdast";
import {computeApiContentGfmTableLayout} from "~/shared/api/content/compute_api_content_gfm_table_layout.open_source.js";

test("computes relative GFM table column widths from visible content", () => {
    // Arrange
    const table: Table = {
        type: "table",
        children: [
            {
                type: "tableRow",
                children: [
                    {type: "tableCell", children: [{type: "text", value: "Alice"}]},
                    {type: "tableCell", children: [{type: "text", value: "Age"}]},
                    {
                        type: "tableCell",
                        children: [{type: "text", value: "12345678901234567890"}],
                    },
                ],
            },
        ],
    };

    // Act
    const tableLayout = computeApiContentGfmTableLayout(table);

    // Assert
    expect(tableLayout).toEqual({tableWidth: 1, columnWidths: [1, 1, 1.43]});
});

test("grows GFM tables wider than four columns", () => {
    // Arrange
    const table: Table = {
        type: "table",
        children: [
            {
                type: "tableRow",
                children: [
                    {type: "tableCell", children: []},
                    {type: "tableCell", children: []},
                    {type: "tableCell", children: []},
                    {type: "tableCell", children: []},
                    {type: "tableCell", children: []},
                ],
            },
        ],
    };

    // Act
    const tableLayout = computeApiContentGfmTableLayout(table);

    // Assert
    expect(tableLayout).toEqual({tableWidth: 1.25, columnWidths: [1, 1, 1, 1, 1]});
});

test("measures link labels instead of Markdown destinations", () => {
    // Arrange
    const table: Table = {
        type: "table",
        children: [
            {
                type: "tableRow",
                children: [
                    {
                        type: "tableCell",
                        children: [
                            {
                                type: "link",
                                url: "https://example.com/a/very/long/path/that/is/not/visible",
                                children: [{type: "text", value: "Short"}],
                            },
                        ],
                    },
                    {type: "tableCell", children: [{type: "text", value: "12345"}]},
                ],
            },
        ],
    };

    // Act
    const tableLayout = computeApiContentGfmTableLayout(table);

    // Assert
    expect(tableLayout).toEqual({tableWidth: 1, columnWidths: [1, 1]});
});
