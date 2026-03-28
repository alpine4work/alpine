import {fromApiContent} from "~/shared/api/content/closed_source/from_api_content.js";
import {intoApiContent} from "~/shared/api/content/closed_source/into_api_content.js";
import {normalizeApiContent} from "~/shared/api/content/normalize_api_content.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {DocumentWithoutTitleContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {assertId} from "~/shared/id/id.js";
import {FileId} from "~/shared/id/types/id_types.js";

test("converts empty quote block from API content", () => {
    // When API content has an empty Quote, we should create a quoteBlock with an empty
    // paragraph This can happen when importing markdown like "> \n> \n" (empty
    // blockquote)
    const apiContent: ApiContent = {
        elements: [
            {
                type: "Quote",
                elements: [],
            },
        ],
    };

    const content = fromApiContent(schema, apiContent);

    // The quoteBlock should have an empty paragraph inside
    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [{type: "quoteBlock", content: [{type: "paragraph"}]}],
    });
});

test("converts quote block with empty ordered list inside", () => {
    const apiContent: ApiContent = {
        elements: [
            {
                type: "Quote",
                elements: [{type: "OrderedList", items: []}],
            },
        ],
    };

    const content = fromApiContent(schema, apiContent);

    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "quoteBlock",
                content: [{type: "paragraph"}],
            },
        ],
    });
});

test("converts empty unordered list item from API content", () => {
    const apiContent: ApiContent = {
        elements: [
            {
                type: "UnorderedList",
                items: [{elements: []}],
            },
        ],
    };

    const content = fromApiContent(schema, apiContent);

    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "unorderedListItem",
                attrs: {indent: 0},
                content: [{type: "paragraph"}],
            },
        ],
    });
});

test("converts empty ordered list item from API content", () => {
    const apiContent: ApiContent = {
        elements: [
            {
                type: "OrderedList",
                items: [{elements: []}],
            },
        ],
    };

    const content = fromApiContent(schema, apiContent);

    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "orderedListItem",
                attrs: {indent: 0, orderStart: null},
                content: [{type: "paragraph"}],
            },
        ],
    });
});

test("converts empty unordered list item from API content with nested list item", () => {
    const apiContent: ApiContent = {
        elements: [
            {
                type: "UnorderedList",
                items: [
                    {
                        elements: [],
                        nestedListElements: [
                            {
                                type: "UnorderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "a"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    };

    const content = fromApiContent(schema, apiContent);

    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [{type: "paragraph", content: [{type: "text", text: "a"}]}],
            },
        ],
    });
});

test("converts empty ordered list item from API content with nested list item", () => {
    const apiContent: ApiContent = {
        elements: [
            {
                type: "OrderedList",
                items: [
                    {
                        elements: [],
                        nestedListElements: [
                            {
                                type: "UnorderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "a"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    };

    const content = fromApiContent(schema, apiContent);

    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "orderedListItem",
                attrs: {indent: 0, orderStart: null},
                content: [{type: "paragraph"}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [{type: "paragraph", content: [{type: "text", text: "a"}]}],
            },
        ],
    });
});

test("converts empty table cells from API content", () => {
    const apiContent: ApiContent = {
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [],
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "a1"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "b1"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "c1"}]},
                                ],
                            },
                        ],
                    },
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "a2"}]},
                                ],
                            },
                        ],
                    },
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "a3"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "b3"}]},
                                ],
                            },
                        ],
                    },
                    {
                        cells: [],
                    },
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "a4"}]},
                                ],
                            },
                            {
                                elements: [],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "c4"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    };

    const content = fromApiContent(schema, apiContent);

    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "table",
                attrs: {
                    columnWidths: [],
                    hasHeaderColumn: false,
                    hasHeaderRow: false,
                    tableWidth: 1,
                },
                content: [
                    {
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "c1"}]},
                                ],
                            },
                        ],
                        type: "tableRow",
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a2"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [{type: "paragraph"}],
                            },
                        ],
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a3"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b3"}]},
                                ],
                            },
                        ],
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [{type: "paragraph"}],
                            },
                            {
                                type: "tableCell",
                                content: [{type: "paragraph"}],
                            },
                        ],
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a4"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [{type: "paragraph"}],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "c4"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("converts empty table cells from API content (normalized)", () => {
    const apiContent: ApiContent = normalizeApiContent({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [],
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "a1"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "b1"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "c1"}]},
                                ],
                            },
                        ],
                    },
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "a2"}]},
                                ],
                            },
                        ],
                    },
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "a3"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "b3"}]},
                                ],
                            },
                        ],
                    },
                    {
                        cells: [],
                    },
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "a4"}]},
                                ],
                            },
                            {
                                elements: [],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "c4"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });

    const content = fromApiContent(schema, apiContent);

    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "table",
                attrs: {
                    columnWidths: [1, 1, 1],
                    hasHeaderColumn: false,
                    hasHeaderRow: false,
                    tableWidth: 1,
                },
                content: [
                    {
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "c1"}]},
                                ],
                            },
                        ],
                        type: "tableRow",
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a2"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [{type: "paragraph"}],
                            },
                        ],
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a3"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b3"}]},
                                ],
                            },
                        ],
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [{type: "paragraph"}],
                            },
                            {
                                type: "tableCell",
                                content: [{type: "paragraph"}],
                            },
                        ],
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a4"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [{type: "paragraph"}],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "c4"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("nested list within ordered list with empty elements list", () => {
    const apiContent: ApiContent = {
        elements: [
            {
                type: "OrderedList",
                items: [
                    {
                        elements: [{type: "Paragraph", elements: []}],
                        nestedListElements: [
                            {
                                type: "CheckList",
                                items: [
                                    {
                                        checked: false,
                                        elements: [],
                                        nestedListElements: [],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    };

    const content = fromApiContent(schema, apiContent);

    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "orderedListItem",
                attrs: {indent: 0, orderStart: null},
                content: [{type: "paragraph"}],
            },
            {
                type: "checkListItem",
                attrs: {checked: false, indent: 1},
                content: [{type: "paragraph"}],
            },
        ],
    });
});

test("three cells with no elements", () => {
    const apiContent: ApiContent = {
        elements: [
            {
                type: "Table",
                width: 1,
                hasHeaderRow: false,
                hasHeaderColumn: false,
                columns: [{width: 0.009999999776482582}, {width: 0.009999999776482582}],
                rows: [{cells: [{elements: []}, {elements: []}, {elements: []}]}],
            },
        ],
    };

    const content = fromApiContent(schema, apiContent);

    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "table",
                attrs: {
                    columnWidths: [0.009999999776482582, 0.009999999776482582],
                    hasHeaderColumn: false,
                    hasHeaderRow: false,
                    tableWidth: 1,
                },
                content: [
                    {
                        type: "tableRow",
                        content: [
                            {type: "tableCell", content: [{type: "paragraph"}]},
                            {type: "tableCell", content: [{type: "paragraph"}]},
                            {type: "tableCell", content: [{type: "paragraph"}]},
                        ],
                    },
                ],
            },
        ],
    });

    expect(
        normalizeApiContent(
            intoApiContent(content, {
                getAccountMentionTitleIfExists: () => undefined,
                getSearchEntityMentionTitleIfExists: () => undefined,
                getSearchTaskEntityDisplayStatusIfExists: () => undefined,
                getFileIfExists: () => undefined,
            }),
        ),
    ).toEqual(normalizeApiContent(apiContent));
});

test("empty cell and the file cell in row", () => {
    const apiContent: ApiContent = {
        elements: [
            {
                type: "Table",
                width: 1,
                hasHeaderRow: false,
                hasHeaderColumn: false,
                columns: [{width: 0.009999999776482582}, {width: 0.009999999776482582}],
                rows: [
                    {
                        cells: [
                            {elements: []},
                            {
                                elements: [
                                    {
                                        type: "File",
                                        file: {id: assertId<FileId>("00000000000000000000000000")},
                                        marks: [],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    };

    const content = fromApiContent(schema, apiContent);

    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "table",
                attrs: {
                    columnWidths: [0.009999999776482582, 0.009999999776482582],
                    hasHeaderColumn: false,
                    hasHeaderRow: false,
                    tableWidth: 1,
                },
                content: [
                    {
                        type: "tableRow",
                        content: [
                            {type: "tableCell", content: [{type: "paragraph"}]},
                            {
                                type: "tableCell",
                                content: [
                                    {
                                        type: "fileRowTable",
                                        content: [
                                            {
                                                type: "file",
                                                attrs: {fileId: "00000000000000000000000000"},
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });

    expect(
        normalizeApiContent(
            intoApiContent(content, {
                getAccountMentionTitleIfExists: () => undefined,
                getSearchEntityMentionTitleIfExists: () => undefined,
                getSearchTaskEntityDisplayStatusIfExists: () => undefined,
                getFileIfExists: () => undefined,
            }),
        ),
    ).toEqual(normalizeApiContent(apiContent));
});

test("unordered list with no items nested in unordered list with no items", () => {
    const apiContent: ApiContent = {
        elements: [
            {
                type: "UnorderedList",
                items: [
                    {
                        elements: [],
                        nestedListElements: [{type: "UnorderedList", items: []}],
                    },
                ],
            },
        ],
    };

    const content = fromApiContent(schema, apiContent);

    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [{type: "unorderedListItem", attrs: {indent: 0}, content: [{type: "paragraph"}]}],
    });

    expect(
        normalizeApiContent(
            intoApiContent(content, {
                getAccountMentionTitleIfExists: () => undefined,
                getSearchEntityMentionTitleIfExists: () => undefined,
                getSearchTaskEntityDisplayStatusIfExists: () => undefined,
                getFileIfExists: () => undefined,
            }),
        ),
    ).toEqual(normalizeApiContent(apiContent));
});

test("ordered list item phantom wrapper", () => {
    const apiContent: ApiContent = {
        elements: [
            {
                type: "OrderedList",
                items: [
                    {
                        elements: [],
                        nestedListElements: [
                            {
                                type: "CheckList",
                                items: [
                                    {
                                        checked: false,
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [],
                                            },
                                        ],
                                        nestedListElements: [],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    };

    const content = fromApiContent(schema, apiContent);

    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "orderedListItem",
                attrs: {indent: 0, orderStart: null},
                content: [{type: "paragraph"}],
            },
            {
                type: "checkListItem",
                attrs: {indent: 1, checked: false},
                content: [{type: "paragraph"}],
            },
        ],
    });

    expect(
        normalizeApiContent(
            intoApiContent(content, {
                getAccountMentionTitleIfExists: () => undefined,
                getSearchEntityMentionTitleIfExists: () => undefined,
                getSearchTaskEntityDisplayStatusIfExists: () => undefined,
                getFileIfExists: () => undefined,
            }),
        ),
    ).toEqual(normalizeApiContent(apiContent));
});

test("marks in code block", () => {
    const apiContent: ApiContent = {
        elements: [
            {
                type: "Code",
                language: "assembly",
                lines: [
                    {
                        elements: [
                            {type: "Text", text: " ", marks: [{type: "Strike"}, {type: "Italic"}]},
                        ],
                    },
                ],
            },
        ],
    };

    const content = fromApiContent(schema, apiContent);

    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "codeBlock",
                attrs: {language: "assembly"},
                content: [
                    {
                        type: "codeBlockLine",
                        content: [
                            {type: "text", text: " ", marks: [{type: "italic"}, {type: "strike"}]},
                        ],
                    },
                ],
            },
        ],
    });

    expect(
        normalizeApiContent(
            intoApiContent(content, {
                getAccountMentionTitleIfExists: () => undefined,
                getSearchEntityMentionTitleIfExists: () => undefined,
                getSearchTaskEntityDisplayStatusIfExists: () => undefined,
                getFileIfExists: () => undefined,
            }),
        ),
    ).toEqual(normalizeApiContent(apiContent));
});

test("unordered list item followed by phantom indented ordered list item", () => {
    const apiContent: ApiContent = {
        elements: [
            {
                type: "UnorderedList",
                items: [
                    {
                        elements: [{type: "Paragraph", elements: []}],
                        nestedListElements: [],
                    },
                    {
                        elements: [],
                        nestedListElements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [{type: "Paragraph", elements: []}],
                                        nestedListElements: [],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    };

    const content = fromApiContent(schema, apiContent);

    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [
            {type: "unorderedListItem", attrs: {indent: 0}, content: [{type: "paragraph"}]},
            {type: "unorderedListItem", attrs: {indent: 0}, content: [{type: "paragraph"}]},
            {
                type: "orderedListItem",
                attrs: {indent: 1, orderStart: null},
                content: [{type: "paragraph"}],
            },
        ],
    });

    expect(
        normalizeApiContent(
            intoApiContent(content, {
                getAccountMentionTitleIfExists: () => undefined,
                getSearchEntityMentionTitleIfExists: () => undefined,
                getSearchTaskEntityDisplayStatusIfExists: () => undefined,
                getFileIfExists: () => undefined,
            }),
        ),
    ).toEqual(normalizeApiContent(apiContent));
});

test("unordered list item followed by phantom indented ordered list item (with unordered list item after)", () => {
    const apiContent: ApiContent = {
        elements: [
            {
                type: "UnorderedList",
                items: [
                    {
                        elements: [{type: "Paragraph", elements: []}],
                        nestedListElements: [
                            {
                                type: "UnorderedList",
                                items: [
                                    {
                                        elements: [{type: "Paragraph", elements: []}],
                                        nestedListElements: [],
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        elements: [{type: "Paragraph", elements: []}],
                        nestedListElements: [],
                    },
                ],
            },
        ],
    };

    const content = fromApiContent(schema, apiContent);

    expect(content.toJSON()).toEqual({
        type: "doc",
        content: [
            {type: "unorderedListItem", attrs: {indent: 0}, content: [{type: "paragraph"}]},
            {type: "unorderedListItem", attrs: {indent: 1}, content: [{type: "paragraph"}]},
            {type: "unorderedListItem", attrs: {indent: 0}, content: [{type: "paragraph"}]},
        ],
    });

    expect(
        normalizeApiContent(
            intoApiContent(content, {
                getAccountMentionTitleIfExists: () => undefined,
                getSearchEntityMentionTitleIfExists: () => undefined,
                getSearchTaskEntityDisplayStatusIfExists: () => undefined,
                getFileIfExists: () => undefined,
            }),
        ),
    ).toEqual(normalizeApiContent(apiContent));
});
