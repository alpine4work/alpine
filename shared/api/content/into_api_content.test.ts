/* eslint-disable cyberworlds/string-quotes */

import {Mark, Node} from "prosemirror-model";
import {fromApiContent} from "~/shared/api/content/from_api_content.js";
import {
    ApiContentMarkdownIntoOptionsWithoutKeys,
    intoApiContent,
} from "~/shared/api/content/into_api_content.js";
import {unknownFileId} from "~/shared/api/content/unknown_file_id.js";
import {normalizeApiContent} from "~/shared/api/markdown/normalize_api_content.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {printApiContentToMarkdown} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {MessageContentProsemirrorSchema} from "~/shared/content/message_content_schema.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {HighlightColor} from "~/shared/design/core/highlight_color.js";
import {DocumentWithoutTitleContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

// Node builders
const doc = (...content: Array<Node>) => schema.nodes.doc.create(null, content);
const paragraph = (...content: Array<Node>) => schema.nodes.paragraph.create(null, content);
const text = (string: string, marks?: Array<Mark>) => schema.text(string, marks);
const quoteBlock = (...content: Array<Node>) => schema.nodes.quoteBlock.create(null, content);
const codeBlock = (language: string, ...lines: Array<Node>) =>
    schema.nodes.codeBlock.create({language}, lines);
const codeBlockLine = (...content: Array<Node>) => schema.nodes.codeBlockLine.create(null, content);
const unorderedListItem = (indent: number, ...content: Array<Node>) =>
    schema.nodes.unorderedListItem.create({indent}, content);
const orderedListItem = (indent: number, ...content: Array<Node>) =>
    schema.nodes.orderedListItem.create({indent}, content);
const checkListItem = (indent: number, checked: boolean, ...content: Array<Node>) =>
    schema.nodes.checkListItem.create({indent, checked}, content);
const br = (marks?: Array<Mark>) => schema.nodes.break.create(null, null, marks);
const mention = (mentionData: ContentMention, marks?: Array<Mark>) =>
    schema.nodes.mention.create({mention: mentionData}, null, marks);
const table = (
    attrs: {
        tableWidth?: number;
        columnWidths: Array<number>;
        hasHeaderRow?: boolean;
        hasHeaderColumn?: boolean;
    },
    ...rows: Array<Node>
) => schema.nodes.table.create(attrs, rows);
const tableRow = (...cells: Array<Node>) => schema.nodes.tableRow.create(null, cells);
const tableCell = (...content: Array<Node>) => schema.nodes.tableCell.create(null, content);
const heading = (level: number, ...content: Array<Node>) =>
    schema.nodes.heading.create({level}, content);
const divider = () => schema.nodes.divider.create();
const fileRow = (...content: Array<Node>) => schema.nodes.fileRow!.create(null, content);
const file = (attrs: {fileId: string | null}) => schema.nodes.file!.create(attrs);
const fileFloat = (attrs: {direction: string}, ...content: Array<Node>) =>
    schema.nodes.fileFloat!.create(attrs, content);
const fileRowTable = (...content: Array<Node>) => schema.nodes.fileRowTable!.create(null, content);

// Mark builders
const bold = () => schema.marks.bold.create();
const italic = () => schema.marks.italic.create();
const code = () => schema.marks.code.create();
const link = (url: string) => schema.marks.link.create({url});
const strike = () => schema.marks.strike.create();
const highlight = (color: HighlightColor) => schema.marks.highlight.create({color});
const comment = (commentThreadId: string) => schema.marks.comment.create({commentThreadId});

function normalizeNode(node: Node): Node {
    if (node.isText) return node;

    let attrs = node.attrs;

    // The API will use the normalized format for `columnWidths`. Make sure we expect
    // normalized attributes.
    if (node.type.name === "table") {
        const tableMap = ContentTableMap.get(node);
        attrs = {...attrs, columnWidths: tableMap.columnWidths};
    }

    const content = node.content.content.map(normalizeNode);

    return node.type.create(attrs, content, node.marks);
}

function testIntoApiContent(node: Node, content: ApiContentResponseWithoutKeys) {
    expect(
        fromApiContent(
            node.type.schema,
            intoApiContent(node, {
                getAccountMentionTitleIfExists: () => undefined,
                getSearchEntityMentionTitleIfExists: () => undefined,
                getSearchTaskEntityDisplayStatusIfExists: () => undefined,
                getFileIfExists: () => undefined,
            }),
        ).toJSON(),
    ).toEqual(normalizeNode(node).toJSON());

    expect(
        intoApiContent(node, {
            getAccountMentionTitleIfExists: () => undefined,
            getSearchEntityMentionTitleIfExists: () => undefined,
            getSearchTaskEntityDisplayStatusIfExists: () => undefined,
            getFileIfExists: () => undefined,
        }),
    ).toEqual(content);
}

function testIntoApiContentOnly(node: Node, content: ApiContentResponseWithoutKeys) {
    // Only test the intoApiContent conversion (not round-trip) This is for cases where
    // the schema doesn't support certain marks
    expect(
        intoApiContent(node, {
            getAccountMentionTitleIfExists: () => undefined,
            getSearchEntityMentionTitleIfExists: () => undefined,
            getSearchTaskEntityDisplayStatusIfExists: () => undefined,
            getFileIfExists: () => undefined,
        }),
    ).toEqual(content);
}
test("converts empty paragraph into API content", () => {
    testIntoApiContent(doc(paragraph()), {
        elements: [
            {
                type: "Paragraph",
                elements: [],
            },
        ],
    });
});

test("converts paragraph with text into API content", () => {
    testIntoApiContent(doc(paragraph(text("Hello, world!"))), {
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "Hello, world!"}],
            },
        ],
    });
});

test("converts multiple paragraphs into API content", () => {
    testIntoApiContent(
        doc(
            paragraph(text("First paragraph")),
            paragraph(text("Second paragraph")),
            paragraph(text("Third paragraph")),
        ),
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "First paragraph"}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Second paragraph"}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Third paragraph"}],
                },
            ],
        },
    );
});

test("converts paragraph with line break into API content", () => {
    testIntoApiContent(doc(paragraph(text("Line one"), br(), text("Line two"))), {
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Line one"},
                    {type: "Break"},
                    {type: "Text", text: "Line two"},
                ],
            },
        ],
    });
});

test("converts quote block into API content", () => {
    testIntoApiContent(doc(quoteBlock(paragraph(text("This is a quote")))), {
        elements: [
            {
                type: "Quote",
                elements: [
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text: "This is a quote"}],
                    },
                ],
            },
        ],
    });
});

test("converts empty quote block from API content", () => {
    // When API content has an empty Quote, we should create a quoteBlock with an empty
    // paragraph This can happen when importing markdown like "> \n> \n" (empty
    // blockquote)
    const apiContent = {
        elements: [
            {
                type: "Quote" as const,
                elements: [],
            },
        ],
    };

    const result = fromApiContent(schema, apiContent);

    // The quoteBlock should have an empty paragraph inside
    expect(result.toJSON()).toEqual(doc(quoteBlock(paragraph())).toJSON());
});

test("converts code block into API content", () => {
    testIntoApiContent(
        doc(
            codeBlock(
                "javascript",
                codeBlockLine(text("function hello() {")),
                codeBlockLine(text("  console.log('Hello');")),
                codeBlockLine(text("}")),
            ),
        ),
        {
            elements: [
                {
                    type: "Code",
                    language: "javascript",
                    lines: [
                        {elements: [{type: "Text", text: "function hello() {"}]},
                        {elements: [{type: "Text", text: "  console.log('Hello');"}]},
                        {elements: [{type: "Text", text: "}"}]},
                    ],
                },
            ],
        },
    );
});

test("converts code block with default language into API content", () => {
    testIntoApiContent(doc(codeBlock("text", codeBlockLine(text("Plain text")))), {
        elements: [
            {
                type: "Code",
                language: "text",
                lines: [{elements: [{type: "Text", text: "Plain text"}]}],
            },
        ],
    });
});

test("converts simple unordered list into API content", () => {
    testIntoApiContent(
        doc(
            unorderedListItem(0, paragraph(text("First item"))),
            unorderedListItem(0, paragraph(text("Second item"))),
            unorderedListItem(0, paragraph(text("Third item"))),
        ),
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "First item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Second item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Third item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts simple ordered list into API content", () => {
    testIntoApiContent(
        doc(
            orderedListItem(0, paragraph(text("First item"))),
            orderedListItem(0, paragraph(text("Second item"))),
            orderedListItem(0, paragraph(text("Third item"))),
        ),
        {
            elements: [
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "First item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Second item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Third item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts nested unordered list into API content", () => {
    testIntoApiContent(
        doc(
            unorderedListItem(0, paragraph(text("Parent item"))),
            unorderedListItem(1, paragraph(text("Child item 1"))),
            unorderedListItem(1, paragraph(text("Child item 2"))),
            unorderedListItem(0, paragraph(text("Another parent"))),
        ),
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Parent item"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {
                                                            type: "Text",
                                                            text: "Child item 1",
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {
                                                            type: "Text",
                                                            text: "Child item 2",
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Another parent"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts deeply nested mixed lists into API content", () => {
    testIntoApiContent(
        doc(
            unorderedListItem(0, paragraph(text("Level 0"))),
            orderedListItem(1, paragraph(text("Level 1 ordered"))),
            unorderedListItem(2, paragraph(text("Level 2 unordered"))),
            orderedListItem(3, paragraph(text("Level 3 ordered"))),
        ),
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Level 0"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "OrderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {
                                                            type: "Text",
                                                            text: "Level 1 ordered",
                                                        },
                                                    ],
                                                },
                                            ],
                                            nestedListElements: [
                                                {
                                                    type: "UnorderedList",
                                                    items: [
                                                        {
                                                            elements: [
                                                                {
                                                                    type: "Paragraph",
                                                                    elements: [
                                                                        {
                                                                            type: "Text",
                                                                            text: "Level 2 unordered",
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                            nestedListElements: [
                                                                {
                                                                    type: "OrderedList",
                                                                    items: [
                                                                        {
                                                                            elements: [
                                                                                {
                                                                                    type: "Paragraph",
                                                                                    elements: [
                                                                                        {
                                                                                            type: "Text",
                                                                                            text: "Level 3 ordered",
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
        },
    );
});

test("converts list with phantom indentation into API content", () => {
    // First item has indent 2, which should create phantom items for indent 0 and 1
    testIntoApiContent(doc(unorderedListItem(2, paragraph(text("Starts at indent 2")))), {
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
                                        elements: [],
                                        nestedListElements: [
                                            {
                                                type: "UnorderedList",
                                                items: [
                                                    {
                                                        elements: [
                                                            {
                                                                type: "Paragraph",
                                                                elements: [
                                                                    {
                                                                        type: "Text",
                                                                        text: "Starts at indent 2",
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
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("converts mixed unordered and ordered list items at same indentation", () => {
    testIntoApiContent(
        doc(
            unorderedListItem(0, paragraph(text("Unordered 1"))),
            unorderedListItem(0, paragraph(text("Unordered 2"))),
            orderedListItem(0, paragraph(text("Ordered 1"))),
            orderedListItem(0, paragraph(text("Ordered 2"))),
            unorderedListItem(0, paragraph(text("Unordered 3"))),
        ),
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Unordered 1"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Unordered 2"}],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Ordered 1"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Ordered 2"}],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Unordered 3"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts list with phantom jump from indent 1 to 3", () => {
    testIntoApiContent(
        doc(
            unorderedListItem(0, paragraph(text("Level 0"))),
            unorderedListItem(1, paragraph(text("Level 1"))),
            unorderedListItem(3, paragraph(text("Level 3 (jumps from 1 to 3)"))),
        ),
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Level 0"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [{type: "Text", text: "Level 1"}],
                                                },
                                            ],
                                            nestedListElements: [
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
                                                                                    elements: [
                                                                                        {
                                                                                            type: "Text",
                                                                                            text: "Level 3 (jumps from 1 to 3)",
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
        },
    );
});

test("converts list with big phantom jump from indent 0 to 4", () => {
    testIntoApiContent(
        doc(
            orderedListItem(0, paragraph(text("Level 0"))),
            orderedListItem(4, paragraph(text("Level 4 (big jump)"))),
            orderedListItem(2, paragraph(text("Level 2 (back down)"))),
        ),
        {
            elements: [
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Level 0"}],
                                },
                            ],
                            nestedListElements: [
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
                                                            elements: [],
                                                            nestedListElements: [
                                                                {
                                                                    type: "UnorderedList",
                                                                    items: [
                                                                        {
                                                                            elements: [],
                                                                            nestedListElements: [
                                                                                {
                                                                                    type: "OrderedList",
                                                                                    items: [
                                                                                        {
                                                                                            elements:
                                                                                                [
                                                                                                    {
                                                                                                        type: "Paragraph",
                                                                                                        elements:
                                                                                                            [
                                                                                                                {
                                                                                                                    type: "Text",
                                                                                                                    text: "Level 4 (big jump)",
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
                                                                },
                                                            ],
                                                        },
                                                    ],
                                                },
                                                {
                                                    type: "OrderedList",
                                                    items: [
                                                        {
                                                            elements: [
                                                                {
                                                                    type: "Paragraph",
                                                                    elements: [
                                                                        {
                                                                            type: "Text",
                                                                            text: "Level 2 (back down)",
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
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts complex list with multiple type changes and indentations", () => {
    testIntoApiContent(
        doc(
            unorderedListItem(0, paragraph(text("Unordered 0"))),
            orderedListItem(1, paragraph(text("Ordered 1"))),
            orderedListItem(1, paragraph(text("Ordered 1 again"))),
            unorderedListItem(2, paragraph(text("Unordered 2"))),
            unorderedListItem(2, paragraph(text("Unordered 2 again"))),
            orderedListItem(3, paragraph(text("Ordered 3"))),
            unorderedListItem(1, paragraph(text("Back to unordered 1"))),
            orderedListItem(0, paragraph(text("Back to ordered 0"))),
        ),
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Unordered 0"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "OrderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {
                                                            type: "Text",
                                                            text: "Ordered 1",
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {
                                                            type: "Text",
                                                            text: "Ordered 1 again",
                                                        },
                                                    ],
                                                },
                                            ],
                                            nestedListElements: [
                                                {
                                                    type: "UnorderedList",
                                                    items: [
                                                        {
                                                            elements: [
                                                                {
                                                                    type: "Paragraph",
                                                                    elements: [
                                                                        {
                                                                            type: "Text",
                                                                            text: "Unordered 2",
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                        {
                                                            elements: [
                                                                {
                                                                    type: "Paragraph",
                                                                    elements: [
                                                                        {
                                                                            type: "Text",
                                                                            text: "Unordered 2 again",
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                            nestedListElements: [
                                                                {
                                                                    type: "OrderedList",
                                                                    items: [
                                                                        {
                                                                            elements: [
                                                                                {
                                                                                    type: "Paragraph",
                                                                                    elements: [
                                                                                        {
                                                                                            type: "Text",
                                                                                            text: "Ordered 3",
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
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {
                                                            type: "Text",
                                                            text: "Back to unordered 1",
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
                },
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Back to ordered 0"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts list starting with phantom indent at level 3", () => {
    testIntoApiContent(
        doc(
            unorderedListItem(3, paragraph(text("Starts at level 3"))),
            unorderedListItem(3, paragraph(text("Another at level 3"))),
            unorderedListItem(4, paragraph(text("Goes to level 4"))),
            unorderedListItem(1, paragraph(text("Back to level 1"))),
        ),
        {
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
                                            elements: [],
                                            nestedListElements: [
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
                                                                                    elements: [
                                                                                        {
                                                                                            type: "Text",
                                                                                            text: "Starts at level 3",
                                                                                        },
                                                                                    ],
                                                                                },
                                                                            ],
                                                                        },
                                                                        {
                                                                            elements: [
                                                                                {
                                                                                    type: "Paragraph",
                                                                                    elements: [
                                                                                        {
                                                                                            type: "Text",
                                                                                            text: "Another at level 3",
                                                                                        },
                                                                                    ],
                                                                                },
                                                                            ],
                                                                            nestedListElements: [
                                                                                {
                                                                                    type: "UnorderedList",
                                                                                    items: [
                                                                                        {
                                                                                            elements:
                                                                                                [
                                                                                                    {
                                                                                                        type: "Paragraph",
                                                                                                        elements:
                                                                                                            [
                                                                                                                {
                                                                                                                    type: "Text",
                                                                                                                    text: "Goes to level 4",
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
                                                                },
                                                            ],
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {
                                                            type: "Text",
                                                            text: "Back to level 1",
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
                },
            ],
        },
    );
});

test("converts list with maximum indentation level", () => {
    testIntoApiContent(
        doc(
            unorderedListItem(0, paragraph(text("Level 0"))),
            unorderedListItem(1, paragraph(text("Level 1"))),
            unorderedListItem(2, paragraph(text("Level 2"))),
            unorderedListItem(3, paragraph(text("Level 3"))),
            unorderedListItem(4, paragraph(text("Level 4"))),
            unorderedListItem(5, paragraph(text("Level 5 (max)"))),
        ),
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Level 0"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [{type: "Text", text: "Level 1"}],
                                                },
                                            ],
                                            nestedListElements: [
                                                {
                                                    type: "UnorderedList",
                                                    items: [
                                                        {
                                                            elements: [
                                                                {
                                                                    type: "Paragraph",
                                                                    elements: [
                                                                        {
                                                                            type: "Text",
                                                                            text: "Level 2",
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                            nestedListElements: [
                                                                {
                                                                    type: "UnorderedList",
                                                                    items: [
                                                                        {
                                                                            elements: [
                                                                                {
                                                                                    type: "Paragraph",
                                                                                    elements: [
                                                                                        {
                                                                                            type: "Text",
                                                                                            text: "Level 3",
                                                                                        },
                                                                                    ],
                                                                                },
                                                                            ],
                                                                            nestedListElements: [
                                                                                {
                                                                                    type: "UnorderedList",
                                                                                    items: [
                                                                                        {
                                                                                            elements:
                                                                                                [
                                                                                                    {
                                                                                                        type: "Paragraph",
                                                                                                        elements:
                                                                                                            [
                                                                                                                {
                                                                                                                    type: "Text",
                                                                                                                    text: "Level 4",
                                                                                                                },
                                                                                                            ],
                                                                                                    },
                                                                                                ],
                                                                                            nestedListElements:
                                                                                                [
                                                                                                    {
                                                                                                        type: "UnorderedList",
                                                                                                        items: [
                                                                                                            {
                                                                                                                elements:
                                                                                                                    [
                                                                                                                        {
                                                                                                                            type: "Paragraph",
                                                                                                                            elements:
                                                                                                                                [
                                                                                                                                    {
                                                                                                                                        type: "Text",
                                                                                                                                        text: "Level 5 (max)",
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
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts table into API content", () => {
    testIntoApiContent(
        doc(
            table(
                {columnWidths: [50, 50]},
                tableRow(
                    tableCell(paragraph(text("Cell 1"))),
                    tableCell(paragraph(text("Cell 2"))),
                ),
                tableRow(
                    tableCell(paragraph(text("Cell 3"))),
                    tableCell(paragraph(text("Cell 4"))),
                ),
            ),
        ),
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 50}, {width: 50}],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Cell 1"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Cell 2"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Cell 3"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Cell 4"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts table with header row and column into API content", () => {
    testIntoApiContent(
        doc(
            table(
                {columnWidths: [50, 50], hasHeaderRow: true, hasHeaderColumn: true},
                tableRow(
                    tableCell(paragraph(text("Header 1"))),
                    tableCell(paragraph(text("Header 2"))),
                ),
                tableRow(
                    tableCell(paragraph(text("Row header"))),
                    tableCell(paragraph(text("Data"))),
                ),
            ),
        ),
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: true,
                    columns: [{width: 50}, {width: 50}],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Header 1"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Header 2"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Row header"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Data"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts account mention into API content", () => {
    const accountId = generateId<AccountId>();

    const accountMention: ContentMention = {
        type: "Account",
        accountId,
        isShort: false,
    };

    testIntoApiContent(doc(paragraph(text("Hello "), mention(accountMention), text("!"))), {
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Hello "},
                    {
                        type: "Mention",
                        reference: {type: "Account", id: accountId},
                        title: "Unknown",
                        isAccountShortName: false,
                    },
                    {type: "Text", text: "!"},
                ],
            },
        ],
    });
});

test("converts account mention with short name into API content", () => {
    const accountId = generateId<AccountId>();

    const accountMention: ContentMention = {
        type: "Account",
        accountId,
        isShort: true,
    };

    testIntoApiContent(doc(paragraph(mention(accountMention))), {
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Mention",
                        reference: {type: "Account", id: accountId},
                        title: "Unknown",
                        isAccountShortName: true,
                    },
                ],
            },
        ],
    });
});

test("converts document mention into API content", () => {
    const documentId = generateId<DocumentId>();

    const documentMention: ContentMention = {
        type: "SearchEntity",
        entityId: `Document:${documentId}`,
    };

    testIntoApiContent(doc(paragraph(text("See "), mention(documentMention))), {
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "See "},
                    {
                        type: "Mention",
                        reference: {type: "Document", id: documentId},
                        title: "Unknown document",
                    },
                ],
            },
        ],
    });
});

test("converts channel mention into API content", () => {
    const channelId = generateId<ChannelId>();

    const channelMention: ContentMention = {
        type: "SearchEntity",
        entityId: `Channel:${channelId}`,
    };

    testIntoApiContent(doc(paragraph(mention(channelMention))), {
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Mention",
                        reference: {type: "Channel", id: channelId},
                        title: "Unknown channel",
                    },
                ],
            },
        ],
    });
});

test("converts task mention into API content", () => {
    const taskId = generateId<TaskId>();

    const taskMention: ContentMention = {
        type: "SearchEntity",
        entityId: `Task:${taskId}`,
    };

    testIntoApiContent(doc(paragraph(mention(taskMention))), {
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Mention",
                        reference: {type: "Task", id: taskId, status: {type: "Closed"}},
                        title: "Unknown task",
                    },
                ],
            },
        ],
    });
});

test("converts task collection mention into API content", () => {
    const taskCollectionId = generateId<TaskCollectionId>();

    const collectionMention: ContentMention = {
        type: "SearchEntity",
        entityId: `TaskCollection:${taskCollectionId}`,
    };

    testIntoApiContent(doc(paragraph(mention(collectionMention))), {
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Mention",
                        reference: {type: "TaskCollection", id: taskCollectionId},
                        title: "Unknown task collection",
                    },
                ],
            },
        ],
    });
});

test("converts post mention into API content", () => {
    const postId = generateId<PostId>();

    const postMention: ContentMention = {
        type: "SearchEntity",
        entityId: `Post:${postId}`,
    };

    testIntoApiContent(doc(paragraph(mention(postMention))), {
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Mention",
                        reference: {type: "Post", id: postId},
                        title: "Unknown post",
                    },
                ],
            },
        ],
    });
});

test("converts text with bold mark into API content", () => {
    testIntoApiContent(doc(paragraph(text("This is "), text("bold", [bold()]), text(" text"))), {
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "This is "},
                    {type: "Text", text: "bold", marks: [{type: "Bold"}]},
                    {type: "Text", text: " text"},
                ],
            },
        ],
    });
});

test("converts text with italic mark into API content", () => {
    testIntoApiContent(
        doc(paragraph(text("This is "), text("italic", [italic()]), text(" text"))),
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {type: "Text", text: "italic", marks: [{type: "Italic"}]},
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
    );
});

test("converts text with code mark into API content", () => {
    testIntoApiContent(
        doc(paragraph(text("Run "), text("npm install", [code()]), text(" to start"))),
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Run "},
                        {type: "Text", text: "npm install", marks: [{type: "Code"}]},
                        {type: "Text", text: " to start"},
                    ],
                },
            ],
        },
    );
});

test("converts text with link mark into API content", () => {
    testIntoApiContent(
        doc(
            paragraph(
                text("Visit "),
                text("our website", [link("https://example.com")]),
                text(" today"),
            ),
        ),
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Visit "},
                        {
                            type: "Text",
                            text: "our website",
                            marks: [{type: "Link", url: "https://example.com"}],
                        },
                        {type: "Text", text: " today"},
                    ],
                },
            ],
        },
    );
});

test("converts text with strike mark into API content", () => {
    testIntoApiContent(
        doc(paragraph(text("This is "), text("strikethrough", [strike()]), text(" text"))),
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {type: "Text", text: "strikethrough", marks: [{type: "Strike"}]},
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
    );
});

test("converts text with multiple marks into API content", () => {
    testIntoApiContent(
        doc(
            paragraph(text("This is "), text("bold and italic", [bold(), italic()]), text(" text")),
        ),
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {
                            type: "Text",
                            text: "bold and italic",
                            marks: [{type: "Bold"}, {type: "Italic"}],
                        },
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
    );
});

test("converts marked line break into API content", () => {
    testIntoApiContent(doc(paragraph(text("Bold"), br([bold()]), text("text", [bold()]))), {
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Bold"},
                    {type: "Break", marks: [{type: "Bold"}]},
                    {type: "Text", text: "text", marks: [{type: "Bold"}]},
                ],
            },
        ],
    });
});

test("converts marked mention into API content", () => {
    const accountId = generateId<AccountId>();

    const accountMention: ContentMention = {
        type: "Account",
        accountId,
        isShort: false,
    };

    testIntoApiContent(
        doc(paragraph(text("Hello "), mention(accountMention, [bold(), italic()]))),
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Hello "},
                        {
                            type: "Mention",
                            reference: {type: "Account", id: accountId},
                            title: "Unknown",
                            isAccountShortName: false,
                            marks: [{type: "Bold"}, {type: "Italic"}],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts complex nested content into API content", () => {
    testIntoApiContent(
        doc(
            paragraph(
                text("Introduction with "),
                text("bold", [bold()]),
                text(" and "),
                text("italic", [italic()]),
            ),
            quoteBlock(
                paragraph(text("A quote with "), text("code", [code()])),
                unorderedListItem(0, paragraph(text("List in quote"))),
                unorderedListItem(1, paragraph(text("Nested item"))),
            ),
            codeBlock("typescript", codeBlockLine(text("const greeting = 'Hello';"))),
            table(
                {columnWidths: [50, 50]},
                tableRow(
                    tableCell(
                        paragraph(text("Cell with "), text("link", [link("https://example.com")])),
                    ),
                    tableCell(paragraph(text("Quote in table"))),
                ),
            ),
        ),
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Introduction with "},
                        {type: "Text", text: "bold", marks: [{type: "Bold"}]},
                        {type: "Text", text: " and "},
                        {type: "Text", text: "italic", marks: [{type: "Italic"}]},
                    ],
                },
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {type: "Text", text: "A quote with "},
                                {type: "Text", text: "code", marks: [{type: "Code"}]},
                            ],
                        },
                        {
                            type: "UnorderedList",
                            items: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "List in quote"}],
                                        },
                                    ],
                                    nestedListElements: [
                                        {
                                            type: "UnorderedList",
                                            items: [
                                                {
                                                    elements: [
                                                        {
                                                            type: "Paragraph",
                                                            elements: [
                                                                {
                                                                    type: "Text",
                                                                    text: "Nested item",
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
                        },
                    ],
                },
                {
                    type: "Code",
                    language: "typescript",
                    lines: [{elements: [{type: "Text", text: "const greeting = 'Hello';"}]}],
                },
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 50}, {width: 50}],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [
                                                {type: "Text", text: "Cell with "},
                                                {
                                                    type: "Text",
                                                    text: "link",
                                                    marks: [
                                                        {type: "Link", url: "https://example.com"},
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Quote in table"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts mixed list types with alternating indents into API content", () => {
    testIntoApiContent(
        doc(
            unorderedListItem(0, paragraph(text("Unordered 1"))),
            orderedListItem(0, paragraph(text("Ordered 1"))),
            unorderedListItem(1, paragraph(text("Nested unordered"))),
            orderedListItem(0, paragraph(text("Ordered 2"))),
            unorderedListItem(0, paragraph(text("Unordered 2"))),
        ),
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Unordered 1"}],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Ordered 1"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {
                                                            type: "Text",
                                                            text: "Nested unordered",
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Ordered 2"}],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Unordered 2"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts list item with multiple paragraphs into API content", () => {
    testIntoApiContent(
        doc(
            unorderedListItem(
                0,
                paragraph(text("First paragraph")),
                paragraph(text("Second paragraph")),
                paragraph(text("Third paragraph")),
            ),
        ),
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "First paragraph"}],
                                },
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Second paragraph"}],
                                },
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Third paragraph"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts empty code block lines into API content", () => {
    testIntoApiContent(
        doc(
            codeBlock(
                "python",
                codeBlockLine(text("def hello():")),
                codeBlockLine(),
                codeBlockLine(text("    print('Hello')")),
                codeBlockLine(),
            ),
        ),
        {
            elements: [
                {
                    type: "Code",
                    language: "python",
                    lines: [
                        {elements: [{type: "Text", text: "def hello():"}]},
                        {elements: []},
                        {elements: [{type: "Text", text: "    print('Hello')"}]},
                        {elements: []},
                    ],
                },
            ],
        },
    );
});

test("converts code block with marks into API content", () => {
    // Marks are supported on text within code blocks (except the code mark itself)
    testIntoApiContent(
        doc(
            codeBlock(
                "javascript",
                codeBlockLine(
                    text("const ", [bold()]),
                    text("greeting", [bold()]),
                    text(" = 'Hello';"),
                ),
                codeBlockLine(
                    text("console.log(", [italic()]),
                    text("greeting", [link("https://example.com")]),
                    text(");", [strike()]),
                ),
            ),
        ),
        {
            elements: [
                {
                    type: "Code",
                    language: "javascript",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "const greeting", marks: [{type: "Bold"}]},
                                {type: "Text", text: " = 'Hello';"},
                            ],
                        },
                        {
                            elements: [
                                {type: "Text", text: "console.log(", marks: [{type: "Italic"}]},
                                {
                                    type: "Text",
                                    text: "greeting",
                                    marks: [{type: "Link", url: "https://example.com"}],
                                },
                                {type: "Text", text: ");", marks: [{type: "Strike"}]},
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("code mark is not allowed in code blocks", () => {
    // The code mark is explicitly not supported within code blocks This test verifies
    // that attempting to use it throws an error
    const node = doc(
        codeBlock(
            "javascript",
            codeBlockLine(text("const ", [code()]), text("x", [code()]), text(" = 5;")),
        ),
    );

    expect(() =>
        intoApiContent(node, {
            getAccountMentionTitleIfExists: () => undefined,
            getSearchEntityMentionTitleIfExists: () => undefined,
            getSearchTaskEntityDisplayStatusIfExists: () => undefined,
            getFileIfExists: () => undefined,
        }),
    ).toThrow("`Code` mark isn\u2019t supported in `Code` block element");
});

test("converts code block with multiple marks on same text", () => {
    testIntoApiContent(
        doc(
            codeBlock(
                "typescript",
                codeBlockLine(
                    text("interface ", [bold(), italic()]),
                    text("User", [bold(), italic(), link("https://api.com/user")]),
                    text(" {"),
                ),
                codeBlockLine(
                    text("  "),
                    text("name", [bold()]),
                    text(": "),
                    text("string", [strike()]),
                    text(";"),
                ),
            ),
        ),
        {
            elements: [
                {
                    type: "Code",
                    language: "typescript",
                    lines: [
                        {
                            elements: [
                                {
                                    type: "Text",
                                    text: "interface ",
                                    marks: [{type: "Bold"}, {type: "Italic"}],
                                },
                                {
                                    type: "Text",
                                    text: "User",
                                    marks: [
                                        {type: "Link", url: "https://api.com/user"},
                                        {type: "Bold"},
                                        {type: "Italic"},
                                    ],
                                },
                                {type: "Text", text: " {"},
                            ],
                        },
                        {
                            elements: [
                                {type: "Text", text: "  "},
                                {type: "Text", text: "name", marks: [{type: "Bold"}]},
                                {type: "Text", text: ": "},
                                {type: "Text", text: "string", marks: [{type: "Strike"}]},
                                {type: "Text", text: ";"},
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts table with empty cells into API content", () => {
    testIntoApiContent(
        doc(
            table(
                {columnWidths: [50, 50]},
                tableRow(tableCell(paragraph(text("Has content"))), tableCell(paragraph())),
                tableRow(tableCell(paragraph()), tableCell(paragraph(text("Also has content")))),
            ),
        ),
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 50}, {width: 50}],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Has content"}],
                                        },
                                    ],
                                },
                                {elements: [{type: "Paragraph", elements: []}]},
                            ],
                        },
                        {
                            cells: [
                                {elements: [{type: "Paragraph", elements: []}]},
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Also has content"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts table with many columns into API content", () => {
    // Test a table with 10 columns
    const columnCount = 10;
    const columnWidths = Array.from({length: columnCount}, (_, i) => 1 + i * 0.1);

    testIntoApiContent(
        doc(
            table(
                {tableWidth: 2, columnWidths, hasHeaderRow: true, hasHeaderColumn: false},
                tableRow(
                    ...Array.from({length: columnCount}, (_, i) =>
                        tableCell(paragraph(text(`Header ${i + 1}`))),
                    ),
                ),
                tableRow(
                    ...Array.from({length: columnCount}, (_, i) =>
                        tableCell(paragraph(text(`Cell ${i + 1}`))),
                    ),
                ),
            ),
        ),
        {
            elements: [
                {
                    type: "Table",
                    width: 2,
                    hasHeaderRow: true,
                    columns: columnWidths.map(width => ({width})),
                    rows: [
                        {
                            cells: Array.from({length: columnCount}, (_, i) => ({
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: `Header ${i + 1}`}],
                                    },
                                ],
                            })),
                        },
                        {
                            cells: Array.from({length: columnCount}, (_, i) => ({
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: `Cell ${i + 1}`}],
                                    },
                                ],
                            })),
                        },
                    ],
                },
            ],
        },
    );
});

test("converts table with rows having different number of columns", () => {
    // Table where rows have different numbers of cells
    testIntoApiContent(
        doc(
            table(
                {
                    tableWidth: 1,
                    columnWidths: [1, 1, 1],
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                },
                tableRow(
                    tableCell(paragraph(text("Row 1 Cell 1"))),
                    tableCell(paragraph(text("Row 1 Cell 2"))),
                    tableCell(paragraph(text("Row 1 Cell 3"))),
                ),
                tableRow(
                    tableCell(paragraph(text("Row 2 Cell 1"))),
                    tableCell(paragraph(text("Row 2 Cell 2"))),
                    // Missing third cell
                ),
                tableRow(
                    tableCell(paragraph(text("Row 3 Cell 1"))),
                    tableCell(paragraph(text("Row 3 Cell 2"))),
                    tableCell(paragraph(text("Row 3 Cell 3"))),
                    tableCell(paragraph(text("Row 3 Cell 4"))), // Extra cell
                ),
            ),
        ),
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 1}, {width: 1}, {width: 1}, {width: 1}], // 4 columns (max row width)
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Row 1 Cell 1"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Row 1 Cell 2"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Row 1 Cell 3"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Row 2 Cell 1"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Row 2 Cell 2"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Row 3 Cell 1"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Row 3 Cell 2"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Row 3 Cell 3"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Row 3 Cell 4"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts table with more columnWidths than actual columns", () => {
    // columnWidths has 5 values but table only has 3 columns
    testIntoApiContent(
        doc(
            table(
                {
                    tableWidth: 1.2,
                    columnWidths: [1, 2, 1.5, 3, 2.5],
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                },
                tableRow(
                    tableCell(paragraph(text("Cell 1"))),
                    tableCell(paragraph(text("Cell 2"))),
                    tableCell(paragraph(text("Cell 3"))),
                ),
                tableRow(
                    tableCell(paragraph(text("Cell 4"))),
                    tableCell(paragraph(text("Cell 5"))),
                    tableCell(paragraph(text("Cell 6"))),
                ),
            ),
        ),
        {
            elements: [
                {
                    type: "Table",
                    width: 1.2,
                    columns: [{width: 1}, {width: 2}, {width: 1.5}], // Only 3 columns used
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Cell 1"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Cell 2"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Cell 3"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Cell 4"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Cell 5"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Cell 6"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts table with fewer columnWidths than actual columns", () => {
    // columnWidths has 2 values but table has 4 columns
    testIntoApiContent(
        doc(
            table(
                {tableWidth: 1.8, columnWidths: [2, 3], hasHeaderRow: false, hasHeaderColumn: true},
                tableRow(
                    tableCell(paragraph(text("A"))),
                    tableCell(paragraph(text("B"))),
                    tableCell(paragraph(text("C"))),
                    tableCell(paragraph(text("D"))),
                ),
                tableRow(
                    tableCell(paragraph(text("E"))),
                    tableCell(paragraph(text("F"))),
                    tableCell(paragraph(text("G"))),
                    tableCell(paragraph(text("H"))),
                ),
            ),
        ),
        {
            elements: [
                {
                    type: "Table",
                    width: 1.8,
                    hasHeaderColumn: true,
                    columns: [{width: 2}, {width: 3}, {width: 1}, {width: 1}], // Default width 1 for missing
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "A"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "B"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "C"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "D"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "E"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "F"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "G"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "H"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

// ProseMirror handles our validation that a table cell has children, but we need
// to make sure we don't throw an error when converting to and from API content.
test("converts table with cell containing only empty paragraph into API content", () => {
    testIntoApiContent(
        doc(
            table(
                {columnWidths: [50, 50]},
                tableRow(tableCell(paragraph()), tableCell(paragraph())),
            ),
        ),
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 50}, {width: 50}],
                    rows: [
                        {
                            cells: [
                                {elements: [{type: "Paragraph", elements: []}]},
                                {elements: [{type: "Paragraph", elements: []}]},
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts quote block with lists inside into API content", () => {
    testIntoApiContent(
        doc(
            quoteBlock(
                paragraph(text("Quote intro")),
                unorderedListItem(0, paragraph(text("Item 1"))),
                unorderedListItem(0, paragraph(text("Item 2"))),
                orderedListItem(0, paragraph(text("Ordered 1"))),
                orderedListItem(0, paragraph(text("Ordered 2"))),
            ),
        ),
        {
            elements: [
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Quote intro"}],
                        },
                        {
                            type: "UnorderedList",
                            items: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Item 1"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Item 2"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            type: "OrderedList",
                            items: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Ordered 1"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Ordered 2"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts headings into API content", () => {
    testIntoApiContent(
        doc(
            heading(1, text("Heading 1")),
            heading(2, text("Heading 2")),
            heading(3, text("Heading 3")),
        ),
        {
            elements: [
                {type: "Heading", level: 1, elements: [{type: "Text", text: "Heading 1"}]},
                {type: "Heading", level: 2, elements: [{type: "Text", text: "Heading 2"}]},
                {type: "Heading", level: 3, elements: [{type: "Text", text: "Heading 3"}]},
            ],
        },
    );
});

test("converts dividers into API content", () => {
    testIntoApiContent(doc(divider()), {
        elements: [{type: "Divider"}],
    });
});

test("converts text with highlight mark into API content", () => {
    testIntoApiContentOnly(
        doc(
            paragraph(
                text("This is "),
                text("highlighted", [highlight(HighlightColor.Red)]),
                text(" text"),
            ),
        ),
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {
                            type: "Text",
                            text: "highlighted",
                            marks: [{type: "Highlight", color: "Red"}],
                        },
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
    );
});

test("converts text with comment mark into API content", () => {
    const threadId = generateId<DocumentCommentThreadId>();

    testIntoApiContentOnly(
        doc(paragraph(text("This is "), text("commented", [comment(threadId)]), text(" text"))),
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {
                            type: "Text",
                            text: "commented",
                            marks: [{type: "Comment", thread: {id: threadId}}],
                        },
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
    );
});

test("converts text with multiple highlight colors into API content", () => {
    testIntoApiContentOnly(
        doc(
            paragraph(
                text("Red ", [highlight(HighlightColor.Red)]),
                text("Orange ", [highlight(HighlightColor.Orange)]),
                text("Green ", [highlight(HighlightColor.Green)]),
                text("Blue ", [highlight(HighlightColor.Blue)]),
                text("Purple", [highlight(HighlightColor.Purple)]),
            ),
        ),
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Red ", marks: [{type: "Highlight", color: "Red"}]},
                        {
                            type: "Text",
                            text: "Orange ",
                            marks: [{type: "Highlight", color: "Orange"}],
                        },
                        {
                            type: "Text",
                            text: "Green ",
                            marks: [{type: "Highlight", color: "Green"}],
                        },
                        {type: "Text", text: "Blue ", marks: [{type: "Highlight", color: "Blue"}]},
                        {
                            type: "Text",
                            text: "Purple",
                            marks: [{type: "Highlight", color: "Purple"}],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts text with combined highlight and comment marks into API content", () => {
    const threadId = generateId<DocumentCommentThreadId>();

    testIntoApiContentOnly(
        doc(
            paragraph(
                text("This is "),
                text("highlighted and commented", [
                    highlight(HighlightColor.Blue),
                    comment(threadId),
                ]),
                text(" text"),
            ),
        ),
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {
                            type: "Text",
                            text: "highlighted and commented",
                            marks: [
                                {type: "Comment", thread: {id: threadId}},
                                {type: "Highlight", color: "Blue"},
                            ],
                        },
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
    );
});

test("converts text with highlight, comment, and other marks into API content", () => {
    const threadId = generateId<DocumentCommentThreadId>();

    testIntoApiContentOnly(
        doc(
            paragraph(
                text("This is "),
                text("bold highlighted commented", [
                    bold(),
                    italic(),
                    highlight(HighlightColor.Purple),
                    comment(threadId),
                ]),
                text(" text"),
            ),
        ),
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {
                            type: "Text",
                            text: "bold highlighted commented",
                            marks: [
                                {type: "Comment", thread: {id: threadId}},
                                {type: "Bold"},
                                {type: "Italic"},
                                {type: "Highlight", color: "Purple"},
                            ],
                        },
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
    );
});

test("converts text with multiple comment marks into API content", () => {
    const threadId1 = generateId<DocumentCommentThreadId>();
    const threadId2 = generateId<DocumentCommentThreadId>();
    const threadId3 = generateId<DocumentCommentThreadId>();

    testIntoApiContentOnly(
        doc(
            paragraph(
                text("This text has "),
                text("multiple comments", [
                    comment(threadId1),
                    comment(threadId2),
                    comment(threadId3),
                ]),
                text(" on it"),
            ),
        ),
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This text has "},
                        {
                            type: "Text",
                            text: "multiple comments",
                            marks: [
                                {type: "Comment", thread: {id: threadId1}},
                                {type: "Comment", thread: {id: threadId2}},
                                {type: "Comment", thread: {id: threadId3}},
                            ],
                        },
                        {type: "Text", text: " on it"},
                    ],
                },
            ],
        },
    );
});

describe("checklist", () => {
    test("converts simple checklist into API content", () => {
        testIntoApiContent(
            doc(
                checkListItem(0, false, paragraph(text("Unchecked item"))),
                checkListItem(0, true, paragraph(text("Checked item"))),
                checkListItem(0, false, paragraph(text("Another unchecked"))),
            ),
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Unchecked item"}],
                                    },
                                ],
                            },
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Checked item"}],
                                    },
                                ],
                            },
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Another unchecked"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        );
    });

    test("converts checklist with all items checked into API content", () => {
        testIntoApiContent(
            doc(
                checkListItem(0, true, paragraph(text("Task 1"))),
                checkListItem(0, true, paragraph(text("Task 2"))),
                checkListItem(0, true, paragraph(text("Task 3"))),
            ),
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Task 1"}],
                                    },
                                ],
                            },
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Task 2"}],
                                    },
                                ],
                            },
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Task 3"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        );
    });

    test("converts nested checklist into API content", () => {
        testIntoApiContent(
            doc(
                checkListItem(0, true, paragraph(text("Parent task"))),
                checkListItem(1, false, paragraph(text("Subtask 1"))),
                checkListItem(1, true, paragraph(text("Subtask 2"))),
                checkListItem(0, false, paragraph(text("Another parent"))),
            ),
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Parent task"}],
                                    },
                                ],
                                nestedListElements: [
                                    {
                                        type: "CheckList",
                                        items: [
                                            {
                                                checked: false,
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {type: "Text", text: "Subtask 1"},
                                                        ],
                                                    },
                                                ],
                                            },
                                            {
                                                checked: true,
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {type: "Text", text: "Subtask 2"},
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Another parent"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        );
    });

    test("converts deeply nested checklist into API content", () => {
        testIntoApiContent(
            doc(
                checkListItem(0, true, paragraph(text("Level 0"))),
                checkListItem(1, false, paragraph(text("Level 1"))),
                checkListItem(2, true, paragraph(text("Level 2"))),
                checkListItem(3, false, paragraph(text("Level 3"))),
            ),
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Level 0"}],
                                    },
                                ],
                                nestedListElements: [
                                    {
                                        type: "CheckList",
                                        items: [
                                            {
                                                checked: false,
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [{type: "Text", text: "Level 1"}],
                                                    },
                                                ],
                                                nestedListElements: [
                                                    {
                                                        type: "CheckList",
                                                        items: [
                                                            {
                                                                checked: true,
                                                                elements: [
                                                                    {
                                                                        type: "Paragraph",
                                                                        elements: [
                                                                            {
                                                                                type: "Text",
                                                                                text: "Level 2",
                                                                            },
                                                                        ],
                                                                    },
                                                                ],
                                                                nestedListElements: [
                                                                    {
                                                                        type: "CheckList",
                                                                        items: [
                                                                            {
                                                                                checked: false,
                                                                                elements: [
                                                                                    {
                                                                                        type: "Paragraph",
                                                                                        elements: [
                                                                                            {
                                                                                                type: "Text",
                                                                                                text: "Level 3",
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
            },
        );
    });

    test("converts checklist with big phantom jump from indent 0 to 4", () => {
        testIntoApiContent(
            doc(
                checkListItem(0, true, paragraph(text("Level 0"))),
                checkListItem(4, false, paragraph(text("Level 4 (big jump)"))),
                checkListItem(2, true, paragraph(text("Level 2 (back down)"))),
            ),
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Level 0"}],
                                    },
                                ],
                                nestedListElements: [
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
                                                                elements: [],
                                                                nestedListElements: [
                                                                    {
                                                                        type: "UnorderedList",
                                                                        items: [
                                                                            {
                                                                                elements: [],
                                                                                nestedListElements:
                                                                                    [
                                                                                        {
                                                                                            type: "CheckList",
                                                                                            items: [
                                                                                                {
                                                                                                    checked: false,
                                                                                                    elements:
                                                                                                        [
                                                                                                            {
                                                                                                                type: "Paragraph",
                                                                                                                elements:
                                                                                                                    [
                                                                                                                        {
                                                                                                                            type: "Text",
                                                                                                                            text: "Level 4 (big jump)",
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
                                                                    },
                                                                ],
                                                            },
                                                        ],
                                                    },
                                                    {
                                                        type: "CheckList",
                                                        items: [
                                                            {
                                                                checked: true,
                                                                elements: [
                                                                    {
                                                                        type: "Paragraph",
                                                                        elements: [
                                                                            {
                                                                                type: "Text",
                                                                                text: "Level 2 (back down)",
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
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        );
    });

    test("converts mixed unordered, ordered, and checklist items at same indentation into list group elements", () => {
        testIntoApiContent(
            doc(
                unorderedListItem(0, paragraph(text("Unordered 1"))),
                unorderedListItem(0, paragraph(text("Unordered 2"))),
                orderedListItem(0, paragraph(text("Ordered 1"))),
                orderedListItem(0, paragraph(text("Ordered 2"))),
                checkListItem(0, true, paragraph(text("Checked 1"))),
                checkListItem(0, false, paragraph(text("Unchecked 1"))),
                unorderedListItem(0, paragraph(text("Unordered 3"))),
            ),
            {
                elements: [
                    {
                        type: "UnorderedList",
                        items: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Unordered 1"}],
                                    },
                                ],
                            },
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Unordered 2"}],
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "OrderedList",
                        items: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Ordered 1"}],
                                    },
                                ],
                            },
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Ordered 2"}],
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Checked 1"}],
                                    },
                                ],
                            },
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Unchecked 1"}],
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "UnorderedList",
                        items: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Unordered 3"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        );
    });

    test("converts mixed nested list types with checklists", () => {
        testIntoApiContent(
            doc(
                checkListItem(0, true, paragraph(text("Checklist parent"))),
                unorderedListItem(1, paragraph(text("Unordered child"))),
                orderedListItem(2, paragraph(text("Ordered grandchild"))),
                checkListItem(3, false, paragraph(text("Checklist great-grandchild"))),
            ),
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Checklist parent"}],
                                    },
                                ],
                                nestedListElements: [
                                    {
                                        type: "UnorderedList",
                                        items: [
                                            {
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {type: "Text", text: "Unordered child"},
                                                        ],
                                                    },
                                                ],
                                                nestedListElements: [
                                                    {
                                                        type: "OrderedList",
                                                        items: [
                                                            {
                                                                elements: [
                                                                    {
                                                                        type: "Paragraph",
                                                                        elements: [
                                                                            {
                                                                                type: "Text",
                                                                                text: "Ordered grandchild",
                                                                            },
                                                                        ],
                                                                    },
                                                                ],
                                                                nestedListElements: [
                                                                    {
                                                                        type: "CheckList",
                                                                        items: [
                                                                            {
                                                                                checked: false,
                                                                                elements: [
                                                                                    {
                                                                                        type: "Paragraph",
                                                                                        elements: [
                                                                                            {
                                                                                                type: "Text",
                                                                                                text: "Checklist great-grandchild",
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
            },
        );
    });

    test("converts checklist item with multiple paragraphs into API content", () => {
        testIntoApiContent(
            doc(
                checkListItem(
                    0,
                    true,
                    paragraph(text("First paragraph")),
                    paragraph(text("Second paragraph")),
                    paragraph(text("Third paragraph")),
                ),
            ),
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "First paragraph"}],
                                    },
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Second paragraph"}],
                                    },
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Third paragraph"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        );
    });

    test("converts complex mixed list with alternating checklist types", () => {
        testIntoApiContent(
            doc(
                unorderedListItem(0, paragraph(text("Unordered 1"))),
                checkListItem(1, true, paragraph(text("Nested checklist"))),
                checkListItem(1, false, paragraph(text("Another nested checklist"))),
                orderedListItem(0, paragraph(text("Ordered 1"))),
                checkListItem(1, true, paragraph(text("Checklist under ordered"))),
                unorderedListItem(2, paragraph(text("Unordered nested deeper"))),
                checkListItem(0, false, paragraph(text("Back to checklist at root"))),
            ),
            {
                elements: [
                    {
                        type: "UnorderedList",
                        items: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Unordered 1"}],
                                    },
                                ],
                                nestedListElements: [
                                    {
                                        type: "CheckList",
                                        items: [
                                            {
                                                checked: true,
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {
                                                                type: "Text",
                                                                text: "Nested checklist",
                                                            },
                                                        ],
                                                    },
                                                ],
                                            },
                                            {
                                                checked: false,
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {
                                                                type: "Text",
                                                                text: "Another nested checklist",
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
                    },
                    {
                        type: "OrderedList",
                        items: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Ordered 1"}],
                                    },
                                ],
                                nestedListElements: [
                                    {
                                        type: "CheckList",
                                        items: [
                                            {
                                                checked: true,
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {
                                                                type: "Text",
                                                                text: "Checklist under ordered",
                                                            },
                                                        ],
                                                    },
                                                ],
                                                nestedListElements: [
                                                    {
                                                        type: "UnorderedList",
                                                        items: [
                                                            {
                                                                elements: [
                                                                    {
                                                                        type: "Paragraph",
                                                                        elements: [
                                                                            {
                                                                                type: "Text",
                                                                                text: "Unordered nested deeper",
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
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {type: "Text", text: "Back to checklist at root"},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        );
    });

    test("converts checklist with formatted text into API content", () => {
        testIntoApiContent(
            doc(
                checkListItem(
                    0,
                    true,
                    paragraph(text("Task with "), text("bold", [bold()]), text(" text")),
                ),
                checkListItem(
                    0,
                    false,
                    paragraph(
                        text("Task with "),
                        text("link", [link("https://example.com")]),
                        text(" and "),
                        text("italic", [italic()]),
                    ),
                ),
            ),
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {type: "Text", text: "Task with "},
                                            {type: "Text", text: "bold", marks: [{type: "Bold"}]},
                                            {type: "Text", text: " text"},
                                        ],
                                    },
                                ],
                            },
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {type: "Text", text: "Task with "},
                                            {
                                                type: "Text",
                                                text: "link",
                                                marks: [{type: "Link", url: "https://example.com"}],
                                            },
                                            {type: "Text", text: " and "},
                                            {
                                                type: "Text",
                                                text: "italic",
                                                marks: [{type: "Italic"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        );
    });

    test("converts checklist with maximum indentation level", () => {
        testIntoApiContent(
            doc(
                checkListItem(0, true, paragraph(text("Level 0"))),
                checkListItem(1, false, paragraph(text("Level 1"))),
                checkListItem(2, true, paragraph(text("Level 2"))),
                checkListItem(3, false, paragraph(text("Level 3"))),
                checkListItem(4, true, paragraph(text("Level 4"))),
                checkListItem(5, false, paragraph(text("Level 5 (max)"))),
            ),
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Level 0"}],
                                    },
                                ],
                                nestedListElements: [
                                    {
                                        type: "CheckList",
                                        items: [
                                            {
                                                checked: false,
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [{type: "Text", text: "Level 1"}],
                                                    },
                                                ],
                                                nestedListElements: [
                                                    {
                                                        type: "CheckList",
                                                        items: [
                                                            {
                                                                checked: true,
                                                                elements: [
                                                                    {
                                                                        type: "Paragraph",
                                                                        elements: [
                                                                            {
                                                                                type: "Text",
                                                                                text: "Level 2",
                                                                            },
                                                                        ],
                                                                    },
                                                                ],
                                                                nestedListElements: [
                                                                    {
                                                                        type: "CheckList",
                                                                        items: [
                                                                            {
                                                                                checked: false,
                                                                                elements: [
                                                                                    {
                                                                                        type: "Paragraph",
                                                                                        elements: [
                                                                                            {
                                                                                                type: "Text",
                                                                                                text: "Level 3",
                                                                                            },
                                                                                        ],
                                                                                    },
                                                                                ],
                                                                                nestedListElements:
                                                                                    [
                                                                                        {
                                                                                            type: "CheckList",
                                                                                            items: [
                                                                                                {
                                                                                                    checked: true,
                                                                                                    elements:
                                                                                                        [
                                                                                                            {
                                                                                                                type: "Paragraph",
                                                                                                                elements:
                                                                                                                    [
                                                                                                                        {
                                                                                                                            type: "Text",
                                                                                                                            text: "Level 4",
                                                                                                                        },
                                                                                                                    ],
                                                                                                            },
                                                                                                        ],
                                                                                                    nestedListElements:
                                                                                                        [
                                                                                                            {
                                                                                                                type: "CheckList",
                                                                                                                items: [
                                                                                                                    {
                                                                                                                        checked: false,
                                                                                                                        elements:
                                                                                                                            [
                                                                                                                                {
                                                                                                                                    type: "Paragraph",
                                                                                                                                    elements:
                                                                                                                                        [
                                                                                                                                            {
                                                                                                                                                type: "Text",
                                                                                                                                                text: "Level 5 (max)",
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
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        );
    });

    test("Converts checklist into unordered list when schema doesn't support checklists", () => {
        const result = fromApiContent(MessageContentProsemirrorSchema, {
            elements: [
                {
                    type: "CheckList",
                    items: [
                        {
                            checked: true,
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Checked item"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "CheckList",
                                    items: [
                                        {
                                            checked: false,
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [{type: "Text", text: "Nested item"}],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {type: "Text", text: "Unordered item"},
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "OrderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {type: "Text", text: "Ordered item"},
                                                    ],
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
        expect(result.toJSON()).toEqual(
            doc(
                unorderedListItem(0, paragraph(text("Checked item"))),
                unorderedListItem(1, paragraph(text("Nested item"))),
                unorderedListItem(1, paragraph(text("Unordered item"))),
                orderedListItem(1, paragraph(text("Ordered item"))),
            ).toJSON(),
        );
    });

    test("converts checklists within quote blocks into API content", () => {
        testIntoApiContent(
            doc(
                quoteBlock(
                    paragraph(text("Quote intro")),
                    checkListItem(0, false, paragraph(text("Task"))),
                    unorderedListItem(0, paragraph(text("Item 1"))),
                    orderedListItem(0, paragraph(text("Ordered 1"))),
                    checkListItem(1, true, paragraph(text("Completed task"))),
                    paragraph(text("Quote outro")),
                ),
            ),
            {
                elements: [
                    {
                        type: "Quote",
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Quote intro"}],
                            },
                            {
                                type: "CheckList",
                                items: [
                                    {
                                        checked: false,
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Task"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                            {
                                type: "UnorderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Item 1"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Ordered 1"}],
                                            },
                                        ],
                                        nestedListElements: [
                                            {
                                                type: "CheckList",
                                                items: [
                                                    {
                                                        checked: true,
                                                        elements: [
                                                            {
                                                                type: "Paragraph",
                                                                elements: [
                                                                    {
                                                                        type: "Text",
                                                                        text: "Completed task",
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
                            },
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Quote outro"}],
                            },
                        ],
                    },
                ],
            },
        );
    });
});

test("converts ordered list with orderStart into API content", () => {
    testIntoApiContent(
        doc(
            schema.nodes.orderedListItem.create({indent: 0, orderStart: 5}, [
                paragraph(text("Fifth item")),
                paragraph(text("Sixth item")),
                paragraph(text("Seventh item")),
            ]),
        ),
        {
            elements: [
                {
                    type: "OrderedList",
                    orderStart: 5,
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Fifth item"}],
                                },
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Sixth item"}],
                                },
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Seventh item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts ordered list with orderStart on first item only", () => {
    testIntoApiContentOnly(
        doc(
            schema.nodes.orderedListItem.create({indent: 0, orderStart: 2}, [
                paragraph(text("Second item")),
            ]),
            schema.nodes.orderedListItem.create({indent: 0}, [paragraph(text("Third item"))]),
            schema.nodes.orderedListItem.create({indent: 0}, [paragraph(text("Fourth item"))]),
        ),
        {
            elements: [
                {
                    type: "OrderedList",
                    orderStart: 2,
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Second item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "Third item"}]},
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Fourth item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts nested ordered lists with separate orderStart values", () => {
    testIntoApiContent(
        doc(
            schema.nodes.orderedListItem.create({indent: 0, orderStart: 2}, [
                paragraph(text("Second item")),
            ]),
            schema.nodes.orderedListItem.create({indent: 1, orderStart: 5}, [
                paragraph(text("Nested fifth item")),
            ]),
            schema.nodes.orderedListItem.create({indent: 1}, [
                paragraph(text("Nested sixth item")),
            ]),
            schema.nodes.orderedListItem.create({indent: 0}, [paragraph(text("Third item"))]),
        ),
        {
            elements: [
                {
                    type: "OrderedList",
                    orderStart: 2,
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Second item"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "OrderedList",
                                    orderStart: 5,
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {type: "Text", text: "Nested fifth item"},
                                                    ],
                                                },
                                            ],
                                        },
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {type: "Text", text: "Nested sixth item"},
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "Third item"}]},
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

test("converts ordered list nested inside unordered list with orderStart", () => {
    testIntoApiContent(
        doc(
            schema.nodes.unorderedListItem.create({indent: 0}, [paragraph(text("Bullet item"))]),
            schema.nodes.orderedListItem.create({indent: 1, orderStart: 3}, [
                paragraph(text("Nested third item")),
            ]),
            schema.nodes.orderedListItem.create({indent: 1}, [
                paragraph(text("Nested fourth item")),
            ]),
        ),
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Bullet item"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "OrderedList",
                                    orderStart: 3,
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {type: "Text", text: "Nested third item"},
                                                    ],
                                                },
                                            ],
                                        },
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {type: "Text", text: "Nested fourth item"},
                                                    ],
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
        },
    );
});

test("converts ordered list with second item having different orderStart", () => {
    testIntoApiContent(
        doc(
            schema.nodes.orderedListItem.create({indent: 0, orderStart: 2}, [
                paragraph(text("Second item")),
            ]),
            schema.nodes.orderedListItem.create({indent: 0, orderStart: 5}, [
                paragraph(text("Third item with different order start")),
            ]),
            schema.nodes.orderedListItem.create({indent: 1}, [paragraph(text("Nested item"))]),
            schema.nodes.orderedListItem.create({indent: 0}, [paragraph(text("Fourth item"))]),
        ),
        {
            elements: [
                {
                    type: "OrderedList",
                    orderStart: 2,
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Second item"}],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "OrderedList",
                    orderStart: 5,
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            type: "Text",
                                            text: "Third item with different order start",
                                        },
                                    ],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "OrderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [{type: "Text", text: "Nested item"}],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Fourth item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    );
});

describe("file block elements", () => {
    const fileId1 = generateChronologicalId<FileId>();
    const fileId2 = generateChronologicalId<FileId>();
    const testDocumentId = generateId<DocumentId>();
    const testChannelId = generateId<ChannelId>();
    const documentEntityId = `Document:${testDocumentId}` as const;
    const channelEntityId = `Channel:${testChannelId}` as const;

    const fileOptions: ApiContentMarkdownIntoOptionsWithoutKeys = {
        getAccountMentionTitleIfExists: () => undefined,
        getSearchEntityMentionTitleIfExists: entityId => {
            if (entityId === documentEntityId) return "My Document";
            if (entityId === channelEntityId) return "General";
            return undefined;
        },
        getSearchTaskEntityDisplayStatusIfExists: () => undefined,
        getFileIfExists: () => ({
            contentType: "image/png",
            contentLength: 1024,
        }),
    };

    function testFileIntoApiContent(node: Node, content: ApiContentResponseWithoutKeys) {
        expect(
            fromApiContent(node.type.schema, intoApiContent(node, fileOptions)).toJSON(),
        ).toEqual(normalizeNode(node).toJSON());

        expect(intoApiContent(node, fileOptions)).toEqual(content);
    }

    function testFileIntoApiContentOnly(node: Node, content: ApiContentResponseWithoutKeys) {
        expect(intoApiContent(node, fileOptions)).toEqual(content);
    }

    test("single file in a fileRow converts to File element", () => {
        testFileIntoApiContent(doc(fileRow(file({fileId: fileId1}))), {
            elements: [
                {
                    type: "File",
                    id: fileId1,
                    contentType: "image/png",
                    contentLength: 1024,
                },
            ],
        });
    });

    test("fileFloat left converts to FileFloat element", () => {
        testFileIntoApiContent(doc(fileFloat({direction: "left"}, file({fileId: fileId1}))), {
            elements: [
                {
                    type: "FileFloat",
                    side: "Left",
                    element: {
                        type: "File",
                        id: fileId1,
                        contentType: "image/png",
                        contentLength: 1024,
                    },
                },
            ],
        });
    });

    test("fileFloat right converts to FileFloat element", () => {
        testFileIntoApiContent(doc(fileFloat({direction: "right"}, file({fileId: fileId1}))), {
            elements: [
                {
                    type: "FileFloat",
                    side: "Right",
                    element: {
                        type: "File",
                        id: fileId1,
                        contentType: "image/png",
                        contentLength: 1024,
                    },
                },
            ],
        });
    });

    test("fileRow with two files converts to FileGallery", () => {
        testFileIntoApiContent(doc(fileRow(file({fileId: fileId1}), file({fileId: fileId2}))), {
            elements: [
                {
                    type: "FileGallery",
                    rows: [
                        {
                            items: [
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        id: fileId1,
                                        contentType: "image/png",
                                        contentLength: 1024,
                                    },
                                },
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        id: fileId2,
                                        contentType: "image/png",
                                        contentLength: 1024,
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        });
    });

    test("fileRow with entity preview converts to Preview element", () => {
        testFileIntoApiContentOnly(doc(fileRow(file({fileId: documentEntityId}))), {
            elements: [
                {
                    type: "Preview",
                    reference: {type: "Document", id: testDocumentId},
                    title: "My Document",
                },
            ],
        });
    });

    test("fileFloat with entity preview converts to FileFloat with Preview", () => {
        testFileIntoApiContentOnly(
            doc(fileFloat({direction: "left"}, file({fileId: channelEntityId}))),
            {
                elements: [
                    {
                        type: "FileFloat",
                        side: "Left",
                        element: {
                            type: "Preview",
                            reference: {type: "Channel", id: testChannelId},
                            title: "General",
                        },
                    },
                ],
            },
        );
    });

    test("fileRow with mixed files and previews converts to FileGallery", () => {
        testFileIntoApiContentOnly(
            doc(fileRow(file({fileId: fileId1}), file({fileId: documentEntityId}))),
            {
                elements: [
                    {
                        type: "FileGallery",
                        rows: [
                            {
                                items: [
                                    {
                                        width: 0.337838,
                                        element: {
                                            type: "File",
                                            id: fileId1,
                                            contentType: "image/png",
                                            contentLength: 1024,
                                        },
                                    },
                                    {
                                        width: 0.662162,
                                        element: {
                                            type: "Preview",
                                            reference: {
                                                type: "Document",
                                                id: testDocumentId,
                                            },
                                            title: "My Document",
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        );
    });

    test("null fileId in fileRow produces File with unknownFileId", () => {
        testFileIntoApiContent(doc(fileRow(file({fileId: null}))), {
            elements: [
                {
                    type: "File",
                    id: unknownFileId,
                    contentType: "application/octet-stream",
                    contentLength: 0,
                },
            ],
        });
    });

    test("null fileId in fileFloat produces FileFloat with unknownFileId", () => {
        testFileIntoApiContent(doc(fileFloat({direction: "left"}, file({fileId: null}))), {
            elements: [
                {
                    type: "FileFloat",
                    side: "Left",
                    element: {
                        type: "File",
                        id: unknownFileId,
                        contentType: "application/octet-stream",
                        contentLength: 0,
                    },
                },
            ],
        });
    });

    test("fileRowTable converts to File element in table cell", () => {
        expect(
            intoApiContent(
                doc(
                    table(
                        {columnWidths: [1, 1]},
                        tableRow(
                            tableCell(paragraph(text("text"))),
                            tableCell(fileRowTable(file({fileId: fileId1}))),
                        ),
                    ),
                ),
                fileOptions,
            ),
        ).toMatchObject({
            elements: [
                {
                    type: "Table",
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "text"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "File",
                                            id: fileId1,
                                            contentType: "image/png",
                                            contentLength: 1024,
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        });
    });

    describe("gallery row width computation", () => {
        test("two square files without dimensions default to 50/50", () => {
            // fileOptions doesn't provide width/height, so files assume square.
            const result = intoApiContent(
                doc(fileRow(file({fileId: fileId1}), file({fileId: fileId2}))),
                fileOptions,
            );
            const widths = (result.elements[0] as any).rows[0].items.map(
                (i: any) => i.width,
            ) as Array<number>;
            expect(widths).toEqual([0.5, 0.5]);
        });

        test("proportional to aspect ratios", () => {
            const fileId3 = generateChronologicalId<FileId>();
            const fileOptionsWithDimensions: ApiContentMarkdownIntoOptionsWithoutKeys = {
                ...fileOptions,
                getFileIfExists: fileId => {
                    // Wide landscape photo
                    if (fileId === fileId1) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 2000, height: 1000},
                        };
                    }
                    // Square photo
                    if (fileId === fileId2) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 1000, height: 1000},
                        };
                    }
                    // Tall portrait photo
                    if (fileId === fileId3) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 500, height: 1000},
                        };
                    }
                    return undefined;
                },
            };

            const result = intoApiContent(
                doc(
                    fileRow(
                        file({fileId: fileId1}),
                        file({fileId: fileId2}),
                        file({fileId: fileId3}),
                    ),
                ),
                fileOptionsWithDimensions,
            );
            const widths = (result.elements[0] as any).rows[0].items.map(
                (i: any) => i.width,
            ) as Array<number>;

            expect(widths).toEqual([0.571429, 0.285714, 0.142857]);
        });

        test("same height but different widths", () => {
            const fileId3 = generateChronologicalId<FileId>();
            const fileOptionsWithDimensions: ApiContentMarkdownIntoOptionsWithoutKeys = {
                ...fileOptions,
                getFileIfExists: fileId => {
                    // Wide photo
                    if (fileId === fileId1) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 3000, height: 1000},
                        };
                    }
                    // Medium photo
                    if (fileId === fileId2) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 1500, height: 1000},
                        };
                    }
                    // Narrow photo
                    if (fileId === fileId3) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 800, height: 1000},
                        };
                    }
                    return undefined;
                },
            };

            const result = intoApiContent(
                doc(
                    fileRow(
                        file({fileId: fileId1}),
                        file({fileId: fileId2}),
                        file({fileId: fileId3}),
                    ),
                ),
                fileOptionsWithDimensions,
            );
            const widths = (result.elements[0] as any).rows[0].items.map(
                (i: any) => i.width,
            ) as Array<number>;

            // Wider files get more space, proportional to their aspect ratios.
            expect(widths).toEqual([0.508647, 0.320448, 0.170905]);
        });

        test("all different widths and heights", () => {
            const fileId3 = generateChronologicalId<FileId>();
            const fileOptionsWithDimensions: ApiContentMarkdownIntoOptionsWithoutKeys = {
                ...fileOptions,
                getFileIfExists: fileId => {
                    // Large landscape photo
                    if (fileId === fileId1) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 4000, height: 2000},
                        };
                    }
                    // Standard photo
                    if (fileId === fileId2) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 1200, height: 800},
                        };
                    }
                    // Phone screenshot
                    if (fileId === fileId3) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 828, height: 1792},
                        };
                    }
                    return undefined;
                },
            };

            const result = intoApiContent(
                doc(
                    fileRow(
                        file({fileId: fileId1}),
                        file({fileId: fileId2}),
                        file({fileId: fileId3}),
                    ),
                ),
                fileOptionsWithDimensions,
            );
            const widths = (result.elements[0] as any).rows[0].items.map(
                (i: any) => i.width,
            ) as Array<number>;

            // Landscape photo gets the most space, phone screenshot the least.
            expect(widths).toEqual([0.497065, 0.372798, 0.130137]);
        });

        test("audio file next to image", () => {
            const opts: ApiContentMarkdownIntoOptionsWithoutKeys = {
                ...fileOptions,
                getFileIfExists: fileId => {
                    // Audio file (no image dimensions)
                    if (fileId === fileId1) {
                        return {contentType: "audio/mpeg", contentLength: 5000};
                    }
                    // Standard photo
                    if (fileId === fileId2) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 1000, height: 1000},
                        };
                    }
                    return undefined;
                },
            };

            const result = intoApiContent(
                doc(fileRow(file({fileId: fileId1}), file({fileId: fileId2}))),
                opts,
            );
            const widths = (result.elements[0] as any).rows[0].items.map(
                (i: any) => i.width,
            ) as Array<number>;

            // Audio files are wide and short so they take more horizontal space than a square
            // image.
            expect(widths).toEqual([0.704225, 0.295775]);
        });

        test("code file next to image", () => {
            const opts: ApiContentMarkdownIntoOptionsWithoutKeys = {
                ...fileOptions,
                getFileIfExists: fileId => {
                    // JavaScript code file
                    if (fileId === fileId1) {
                        return {contentType: "text/javascript", contentLength: 2000};
                    }
                    // Standard photo
                    if (fileId === fileId2) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 1000, height: 1000},
                        };
                    }
                    return undefined;
                },
            };

            const result = intoApiContent(
                doc(fileRow(file({fileId: fileId1}), file({fileId: fileId2}))),
                opts,
            );
            const widths = (result.elements[0] as any).rows[0].items.map(
                (i: any) => i.width,
            ) as Array<number>;

            // Code files have a wide aspect ratio (63:32) so they take more horizontal space
            // than a square image.
            expect(widths).toEqual([0.663158, 0.336842]);
        });

        test("audio, code, and image together", () => {
            const fileId3 = generateChronologicalId<FileId>();
            const opts: ApiContentMarkdownIntoOptionsWithoutKeys = {
                ...fileOptions,
                getFileIfExists: fileId => {
                    if (fileId === fileId1) {
                        return {contentType: "audio/wav", contentLength: 10000};
                    }
                    if (fileId === fileId2) {
                        return {contentType: "application/json", contentLength: 500};
                    }
                    if (fileId === fileId3) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 800, height: 600},
                        };
                    }
                    return undefined;
                },
            };

            const result = intoApiContent(
                doc(
                    fileRow(
                        file({fileId: fileId1}),
                        file({fileId: fileId2}),
                        file({fileId: fileId3}),
                    ),
                ),
                opts,
            );
            const widths = (result.elements[0] as any).rows[0].items.map(
                (i: any) => i.width,
            ) as Array<number>;

            // Audio is widest (very short), code is medium (63:32), image is narrowest (4:3).
            expect(widths).toEqual([0.418958, 0.346426, 0.234616]);
        });

        test("binary file next to image", () => {
            const opts: ApiContentMarkdownIntoOptionsWithoutKeys = {
                ...fileOptions,
                getFileIfExists: fileId => {
                    // Binary file with no preview
                    if (fileId === fileId1) {
                        return {contentType: "application/octet-stream", contentLength: 50000};
                    }
                    // Wide landscape photo
                    if (fileId === fileId2) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 2000, height: 1000},
                        };
                    }
                    return undefined;
                },
            };

            const result = intoApiContent(
                doc(fileRow(file({fileId: fileId1}), file({fileId: fileId2}))),
                opts,
            );
            const widths = (result.elements[0] as any).rows[0].items.map(
                (i: any) => i.width,
            ) as Array<number>;

            // Binary files use the small fallback (200x133, 3:2). The landscape photo (2:1)
            // has the same aspect ratio after clamping so they split evenly.
            expect(widths).toEqual([0.5, 0.5]);
        });

        test("mixed known and unknown dimensions", () => {
            const fileOptionsWithPartialDimensions: ApiContentMarkdownIntoOptionsWithoutKeys = {
                ...fileOptions,
                getFileIfExists: fileId => {
                    if (fileId === fileId1) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 3000, height: 1000},
                        };
                    }
                    // No dimensions for fileId2 (e.g. a non-image file).
                    if (fileId === fileId2) {
                        return {contentType: "application/pdf", contentLength: 100};
                    }
                    return undefined;
                },
            };

            const result = intoApiContent(
                doc(fileRow(file({fileId: fileId1}), file({fileId: fileId2}))),
                fileOptionsWithPartialDimensions,
            );
            const widths = (result.elements[0] as any).rows[0].items.map(
                (i: any) => i.width,
            ) as Array<number>;

            expect(widths).toEqual([0.662162, 0.337838]);
        });

        test("file without dimensions next to preview", () => {
            const result = intoApiContent(
                doc(fileRow(file({fileId: fileId1}), file({fileId: documentEntityId}))),
                fileOptions,
            );
            const widths = (result.elements[0] as any).rows[0].items.map(
                (i: any) => i.width,
            ) as Array<number>;

            expect(widths).toEqual([0.337838, 0.662162]);
        });

        test("single file has no widths (unwrapped to standalone)", () => {
            const result = intoApiContent(doc(fileRow(file({fileId: fileId1}))), fileOptions);
            // Single-item gallery is unwrapped to standalone File.
            expect(result.elements[0]).toMatchObject({type: "File", id: fileId1});
        });

        test("widths survive markdown round trip", () => {
            const fileOptionsWithDimensions: ApiContentMarkdownIntoOptionsWithoutKeys = {
                ...fileOptions,
                getFileIfExists: fileId => {
                    if (fileId === fileId1) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 2000, height: 1000},
                        };
                    }
                    if (fileId === fileId2) {
                        return {
                            contentType: "image/png",
                            contentLength: 100,
                            size: {width: 500, height: 1000},
                        };
                    }
                    return undefined;
                },
            };

            const apiContent = intoApiContent(
                doc(fileRow(file({fileId: fileId1}), file({fileId: fileId2}))),
                fileOptionsWithDimensions,
            );

            const markdown = printApiContentToMarkdown(apiContent);
            const parsed = parseApiContentFromMarkdown(markdown);

            // Widths are response-only metadata and don't survive the round-trip (they'll be
            // recomputed on the next response). The parsed content should have the right
            // elements without widths.
            expect(normalizeApiContent(parsed)).toEqual(normalizeApiContent(apiContent));
        });
    });
});
