/* eslint-disable cyberworlds/string-quotes -- Tests need straight quotes for CSV content */
import {notionImportCsvToApiContent} from "~/server/importer/notion/internal/notion_import_csv_to_api_content.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";

describe("notionImportCsvToApiContent", () => {
    test("converts simple CSV to table", () => {
        const csv = `Name,Status
Task 1,Done
Task 2,Pending`;

        const result = notionImportCsvToApiContent(csv);

        expect(result).toMatchObject({
            type: "Table",
            width: 1,
            hasHeaderRow: true,
            columns: [{width: 1}, {width: 1}],
            rows: [
                {
                    cells: [
                        {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Name"}]}]},
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "Status"}]},
                            ],
                        },
                    ],
                },
                {
                    cells: [
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "Task 1"}]},
                            ],
                        },
                        {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Done"}]}]},
                    ],
                },
                {
                    cells: [
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "Task 2"}]},
                            ],
                        },
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "Pending"}]},
                            ],
                        },
                    ],
                },
            ],
        });
    });

    test("returns null for empty CSV", () => {
        const result = notionImportCsvToApiContent("");
        expect(result).toBeNull();
    });

    test("returns null for single column CSV", () => {
        const csv = `Name
Task 1
Task 2`;

        const result = notionImportCsvToApiContent(csv);
        expect(result).toBeNull();
    });

    test("handles CSV with only headers", () => {
        const csv = `Name,Status`;

        const result = notionImportCsvToApiContent(csv);

        expect(result).toMatchObject({
            type: "Table",
            hasHeaderRow: true,
            rows: [
                {
                    cells: [
                        {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Name"}]}]},
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "Status"}]},
                            ],
                        },
                    ],
                },
            ],
        });
    });

    test("escapes pipe characters in cells", () => {
        const csv = `Name,Description
Item|A,Has pipe`;

        const result = notionImportCsvToApiContent(csv);

        expect(result?.rows[1]).toMatchObject({
            cells: [
                {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Item\\|A"}]}]},
                {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Has pipe"}]}]},
            ],
        });
    });

    test("handles quoted fields with commas", () => {
        const csv = `Name,Description
"Item, with comma",Normal`;

        const result = notionImportCsvToApiContent(csv);

        expect(result?.rows[1]).toMatchObject({
            cells: [
                {
                    elements: [
                        {type: "Paragraph", elements: [{type: "Text", text: "Item, with comma"}]},
                    ],
                },
                {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Normal"}]}]},
            ],
        });
    });

    test("handles quoted fields with escaped quotes", () => {
        const csv = `Name,Description
"Item ""quoted""",Normal`;

        const result = notionImportCsvToApiContent(csv);

        expect(result?.rows[1]).toMatchObject({
            cells: [
                {
                    elements: [
                        {type: "Paragraph", elements: [{type: "Text", text: 'Item "quoted"'}]},
                    ],
                },
                {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Normal"}]}]},
            ],
        });
    });

    test("converts matching cells to mentions when childTitleToDocumentId is provided", () => {
        const csv = `Name,Status
Task 1,Done
Task 2,Pending`;
        const childTitleToDocumentId = new Map<string, DocumentId>([
            ["Task 1", "doc1" as DocumentId],
            ["Task 2", "doc2" as DocumentId],
        ]);

        const result = notionImportCsvToApiContent(csv, childTitleToDocumentId);

        expect(result?.rows[1]).toMatchObject({
            cells: [
                {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {type: "Mention", reference: {type: "Document", id: "doc1"}},
                            ],
                        },
                    ],
                },
                {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Done"}]}]},
            ],
        });
        expect(result?.rows[2]).toMatchObject({
            cells: [
                {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {type: "Mention", reference: {type: "Document", id: "doc2"}},
                            ],
                        },
                    ],
                },
                {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Pending"}]}]},
            ],
        });
    });

    test("does not convert header cells to mentions", () => {
        const csv = `Name,Status
Task 1,Done`;
        const childTitleToDocumentId = new Map<string, DocumentId>([
            ["Name", "docHeader" as DocumentId],
            ["Task 1", "doc1" as DocumentId],
        ]);

        const result = notionImportCsvToApiContent(csv, childTitleToDocumentId);

        // Header row should have text, not mention
        expect(result?.rows[0]).toMatchObject({
            cells: [
                {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Name"}]}]},
                {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Status"}]}]},
            ],
        });

        // Data row should have mention
        expect(result?.rows[1]).toMatchObject({
            cells: [
                {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {type: "Mention", reference: {type: "Document", id: "doc1"}},
                            ],
                        },
                    ],
                },
                {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Done"}]}]},
            ],
        });
    });

    test("handles whitespace in CSV values", () => {
        const csv = `Name,Status
  Task 1  ,  Done  `;

        const result = notionImportCsvToApiContent(csv);

        expect(result?.rows[1]).toMatchObject({
            cells: [
                {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Task 1"}]}]},
                {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Done"}]}]},
            ],
        });
    });

    // Tests for handling unquoted commas and malformed CSV content.
    describe("unquoted commas in content (malformed CSV)", () => {
        test("dumps extra fields into last cell when row has more fields than headers", () => {
            const csv = `Name,Description
Task 1,hello, world`;

            const result = notionImportCsvToApiContent(csv);

            expect(result?.rows[1]).toMatchObject({
                cells: [
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Task 1"}]}]},
                    {
                        elements: [
                            {type: "Paragraph", elements: [{type: "Text", text: "hello, world"}]},
                        ],
                    },
                ],
            });
        });

        test("handles multiple unquoted commas in content", () => {
            const csv = `Name,Value
Item,a, b, c, d`;

            const result = notionImportCsvToApiContent(csv);

            expect(result?.rows[1]).toMatchObject({
                cells: [
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "Item"}]}]},
                    {
                        elements: [
                            {type: "Paragraph", elements: [{type: "Text", text: "a, b, c, d"}]},
                        ],
                    },
                ],
            });
        });

        test("handles unquoted commas with three column table", () => {
            const csv = `Col1,Col2,Col3
A,B,C
D,E,F, G, H`;

            const result = notionImportCsvToApiContent(csv);

            expect(result?.rows[1]).toMatchObject({
                cells: [
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "A"}]}]},
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "B"}]}]},
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "C"}]}]},
                ],
            });
            expect(result?.rows[2]).toMatchObject({
                cells: [
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "D"}]}]},
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "E"}]}]},
                    {
                        elements: [
                            {type: "Paragraph", elements: [{type: "Text", text: "F, G, H"}]},
                        ],
                    },
                ],
            });
        });
    });

    describe("table structure and column widths", () => {
        test("uses width 1 for columns to match markdown parser", () => {
            const csv = `A,B,C
1,2,3`;

            const result = notionImportCsvToApiContent(csv);

            expect(result).toMatchObject({
                type: "Table",
                width: 1,
                hasHeaderRow: true,
                columns: [{width: 1}, {width: 1}, {width: 1}],
            });
        });

        test("creates correct number of columns for 4 column table", () => {
            const csv = `A,B,C,D
1,2,3,4`;

            const result = notionImportCsvToApiContent(csv);

            expect(result).toMatchObject({
                type: "Table",
                width: 1,
                hasHeaderRow: true,
                columns: [{width: 1}, {width: 1}, {width: 1}, {width: 1}],
            });
        });

        test("creates correct number of columns for 5 column table", () => {
            const csv = `A,B,C,D,E
1,2,3,4,5`;

            const result = notionImportCsvToApiContent(csv);

            expect(result).toMatchObject({
                type: "Table",
                width: 1,
                hasHeaderRow: true,
                columns: [{width: 1}, {width: 1}, {width: 1}, {width: 1}, {width: 1}],
            });
        });

        test("returns correct number of rows", () => {
            const csv = `Name,Status
Task 1,Done
Task 2,Pending
Task 3,In Progress`;

            const result = notionImportCsvToApiContent(csv);

            expect(result?.rows).toHaveLength(4); // 1 header + 3 data rows
        });
    });

    describe("additional edge cases", () => {
        test("handles empty cells in the middle", () => {
            const csv = `A,B,C
1,,3`;

            const result = notionImportCsvToApiContent(csv);

            expect(result?.rows[1]).toMatchObject({
                cells: [
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "1"}]}]},
                    {elements: [{type: "Paragraph", elements: []}]},
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "3"}]}]},
                ],
            });
        });

        test("handles trailing comma (empty last cell)", () => {
            const csv = `A,B
1,`;

            const result = notionImportCsvToApiContent(csv);

            expect(result?.rows[1]).toMatchObject({
                cells: [
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "1"}]}]},
                    {elements: [{type: "Paragraph", elements: []}]},
                ],
            });
        });

        test("handles leading comma (empty first cell)", () => {
            const csv = `A,B
,2`;

            const result = notionImportCsvToApiContent(csv);

            expect(result?.rows[1]).toMatchObject({
                cells: [
                    {elements: [{type: "Paragraph", elements: []}]},
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "2"}]}]},
                ],
            });
        });

        test("handles multiple consecutive commas", () => {
            const csv = `A,B,C,D
1,,,4`;

            const result = notionImportCsvToApiContent(csv);

            expect(result?.rows[1]).toMatchObject({
                cells: [
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "1"}]}]},
                    {elements: [{type: "Paragraph", elements: []}]},
                    {elements: [{type: "Paragraph", elements: []}]},
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "4"}]}]},
                ],
            });
        });

        test("row with fewer fields than headers gets padded", () => {
            const csv = `A,B,C
1,2`;

            const result = notionImportCsvToApiContent(csv);

            expect(result?.rows[1]).toMatchObject({
                cells: [
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "1"}]}]},
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "2"}]}]},
                    {elements: [{type: "Paragraph", elements: []}]},
                ],
            });
        });
    });
});
/* eslint-enable cyberworlds/string-quotes */
