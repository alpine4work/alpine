import {Node} from "prosemirror-model";
import {fromApiContent} from "~/server/api/content/from_api_content.js";
import {intoApiContent} from "~/server/api/content/into_api_content.js";
import {normalizeApiContent} from "~/server/api/markdown/normalize_api_content.js";
import {parseApiContentFromMarkdown} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {printApiContentToMarkdown} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {ApiContent} from "~/shared/api/types/api_specification_convenience_types.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

const schema = DocumentWithoutTitleContentProsemirrorSchema;

const spaceId = generateId<SpaceId>();

function testIntoApiContentAndPrintToMarkdown(
    expectedProsemirrorNode: Node,
    expectedApiContent: ApiContent,
    expectedMarkdown: string,
) {
    expectedProsemirrorNode.check();

    expectedApiContent = normalizeApiContent(expectedApiContent);

    const actualApiContent = intoApiContent(expectedProsemirrorNode, {
        getAccountMentionTitleIfExists: () => undefined,
        getSearchEntityMentionTitleIfExists: () => undefined,
        getSearchTaskEntityDisplayStatusIfExists: () => undefined,
    });

    expect(actualApiContent).toEqual(expectedApiContent);

    const actualMarkdown = printApiContentToMarkdown(actualApiContent, {spaceId});
    expect(actualMarkdown).toEqual(expectedMarkdown);

    const actualApiContent2 = parseApiContentFromMarkdown(actualMarkdown, {spaceId});
    expect(actualApiContent2).toEqual(expectedApiContent);

    const actualProsemirrorNode = fromApiContent(
        expectedProsemirrorNode.type.schema,
        actualApiContent2,
    );
    expect(actualProsemirrorNode.toJSON()).toEqual(expectedProsemirrorNode.toJSON());
}

test("phantom unordered list item", () => {
    testIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.unorderedListItem.create({indent: 2}, [
                schema.nodes.paragraph.create(null, [schema.text("foo")]),
            ]),
        ]),
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
                                                            elements: [
                                                                {
                                                                    type: "Paragraph",
                                                                    elements: [
                                                                        {type: "Text", text: "foo"},
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
        `\
- - - foo
`,
    );
});

test("phantom check list item with no content", () => {
    testIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [schema.nodes.checkListItem.createAndFill({indent: 2})!]),
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
                                                    type: "CheckList",
                                                    items: [
                                                        {
                                                            checked: false,
                                                            elements: [],
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
        `\
- - - [ ] <span></span>
`,
    );
});

// TODO(#public-api): This test should pass. We don't have perfect end-to-end
// printing of this ProseMirror content to Markdown.
// eslint-disable-next-line jest/no-disabled-tests
test.skip("ordered list item with order start 1", () => {
    testIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.orderedListItem.create({orderStart: 1}, [
                schema.nodes.paragraph.create(null, [schema.text("foo")]),
            ]),
        ]),
        {
            elements: [
                {
                    type: "OrderedList",
                    items: [
                        {elements: [{type: "Paragraph", elements: [{type: "Text", text: "foo"}]}]},
                    ],
                },
            ],
        },
        `\
1. foo
`,
    );
});

// TODO(#public-api): This test should pass. We don't have perfect end-to-end
// printing of this ProseMirror content to Markdown.
// eslint-disable-next-line jest/no-disabled-tests
test.skip("ordered list item with order start 3", () => {
    testIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.orderedListItem.create({orderStart: 3}, [
                schema.nodes.paragraph.create(null, [schema.text("foo")]),
            ]),
        ]),
        {
            elements: [
                {
                    type: "OrderedList",
                    items: [
                        {elements: [{type: "Paragraph", elements: [{type: "Text", text: "foo"}]}]},
                    ],
                },
            ],
        },
        `\
3. foo
`,
    );
});

// TODO(#public-api): This test should pass. We don't have perfect end-to-end
// printing of this ProseMirror content to Markdown.
// eslint-disable-next-line jest/no-disabled-tests
test.skip("second ordered list item with order start 2", () => {
    testIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.orderedListItem.create(null, [
                schema.nodes.paragraph.create(null, [schema.text("foo")]),
            ]),
            schema.nodes.orderedListItem.create({orderStart: 2}, [
                schema.nodes.paragraph.create(null, [schema.text("bar")]),
            ]),
        ]),
        {
            elements: [
                {
                    type: "OrderedList",
                    items: [
                        {elements: [{type: "Paragraph", elements: [{type: "Text", text: "foo"}]}]},
                        {elements: [{type: "Paragraph", elements: [{type: "Text", text: "bar"}]}]},
                    ],
                },
            ],
        },
        `\
1. foo

2. bar
`,
    );
});
