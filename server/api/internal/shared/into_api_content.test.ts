/* eslint-disable string-quotes */

import {Mark, Node} from "prosemirror-model";
import {fromApiContent} from "~/server/api/internal/shared/from_api_content.js";
import {intoApiContent} from "~/server/api/internal/shared/into_api_content.js";
import {ApiContentResponse} from "~/shared/api/types/api_specification_convenience_types.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {HighlightColor} from "~/shared/design/core/highlight_color.js";
import {DocumentWithoutTitleContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    DocumentCommentThreadId,
    DocumentId,
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

    // The API will use the normalized format for `columnWidths`. Make sure we
    // expect normalized attributes.
    if (node.type.name === "table") {
        const tableMap = ContentTableMap.get(node);
        attrs = {...attrs, columnWidths: tableMap.columnWidths};
    }

    const content = node.content.content.map(normalizeNode);

    return node.type.create(attrs, content, node.marks);
}

function testIntoApiContent(node: Node, content: ApiContentResponse) {
    expect(
        fromApiContent(
            node.type.schema,
            intoApiContent(node, {
                getAccountMentionTitleIfExists: () => undefined,
                getSearchEntityMentionTitleIfExists: () => undefined,
            }),
        ).toJSON(),
    ).toEqual(normalizeNode(node).toJSON());

    expect(
        intoApiContent(node, {
            getAccountMentionTitleIfExists: () => undefined,
            getSearchEntityMentionTitleIfExists: () => undefined,
        }),
    ).toEqual(content);
}

function testIntoApiContentOnly(node: Node, content: ApiContentResponse) {
    // Only test the intoApiContent conversion (not round-trip)
    // This is for cases where the schema doesn't support certain marks
    expect(
        intoApiContent(node, {
            getAccountMentionTitleIfExists: () => undefined,
            getSearchEntityMentionTitleIfExists: () => undefined,
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
                        target: {type: "Account", path: `/accounts/${accountId}`, id: accountId},
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
                        target: {type: "Account", path: `/accounts/${accountId}`, id: accountId},
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
                        target: {
                            type: "Document",
                            path: `/documents/${documentId}`,
                            id: documentId,
                        },
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
                        target: {type: "Channel", path: `/channels/${channelId}`, id: channelId},
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
                        target: {type: "Task", path: `/tasks/${taskId}`, id: taskId},
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
                        target: {
                            type: "TaskCollection",
                            path: `/task-collections/${taskCollectionId}`,
                            id: taskCollectionId,
                        },
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
                        target: {type: "Post", path: `/posts/${postId}`, id: postId},
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
                            target: {
                                type: "Account",
                                path: `/accounts/${accountId}`,
                                id: accountId,
                            },
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
    // The code mark is explicitly not supported within code blocks
    // This test verifies that attempting to use it throws an error
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
        }),
    ).toThrow("`Code` mark isn’t supported in `Code` block element");
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
                        {type: "Text", text: "commented", marks: [{type: "Comment", threadId}]},
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
                                {type: "Comment", threadId},
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
                                {type: "Comment", threadId},
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
                                {type: "Comment", threadId: threadId1},
                                {type: "Comment", threadId: threadId2},
                                {type: "Comment", threadId: threadId3},
                            ],
                        },
                        {type: "Text", text: " on it"},
                    ],
                },
            ],
        },
    );
});
