import {Node} from "prosemirror-model";
import {fromApiContent} from "~/shared/api/content/closed_source/from_api_content.js";
import {
    ApiContentMarkdownIntoOptionsWithoutKeys,
    intoApiContent,
} from "~/shared/api/content/closed_source/into_api_content.js";
import {unknownFileId} from "~/shared/api/content/closed_source/unknown_file_id.js";
import {normalizeApiContent} from "~/shared/api/content/normalize_api_content.open_source.js";
import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.open_source.js";
import {printApiContentToMarkdown} from "~/shared/api/content/print_api_content_to_markdown.open_source.js";
import {
    ApiContent,
    ApiContentResponseWithoutKeys,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {FileModelData} from "~/shared/files/file_model.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {ChannelId, DocumentId, FileId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

const schema = DocumentWithoutTitleContentProsemirrorSchema;

function testIntoApiContentAndPrintToMarkdown(
    expectedProsemirrorNode: Node,
    expectedApiContent: ApiContent,
    expectedMarkdown: string,
) {
    expectedProsemirrorNode.check();

    expectedApiContent = normalizeApiContent(expectedApiContent);

    const actualApiContent = intoApiContent(expectedProsemirrorNode, {
        getAccountIfExists: () => undefined,
        getSearchEntityMentionTitleIfExists: () => undefined,
        getSearchTaskEntityDisplayStatusIfExists: () => undefined,
        getFileIfExists: () => undefined,
    });

    expect(actualApiContent).toEqual(expectedApiContent);

    const actualMarkdown = printApiContentToMarkdown(actualApiContent, {});
    expect(actualMarkdown).toEqual(expectedMarkdown);

    const actualApiContent2 = parseApiContentFromMarkdown(actualMarkdown);
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

test("ordered list item with order start 1", () => {
    testIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.orderedListItem.create({orderStart: 1}, [
                schema.nodes.paragraph.create(null, [schema.text("foo")]),
            ]),
            schema.nodes.orderedListItem.create(null, [
                schema.nodes.paragraph.create(null, [schema.text("bar")]),
            ]),
        ]),
        {
            elements: [
                {
                    type: "OrderedList",
                    orderStart: 1,
                    items: [
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "foo"}]},
                            ],
                        },
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "bar"}]},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
1. <span data-start=\u201D1\u201D></span>foo

2. bar
`,
    );
});

test("ordered list item with order start 1 and and reset to 1", () => {
    testIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.orderedListItem.create({orderStart: 1}, [
                schema.nodes.paragraph.create(null, [schema.text("foo")]),
            ]),
            schema.nodes.orderedListItem.create(null, [
                schema.nodes.paragraph.create(null, [schema.text("bar")]),
            ]),
            schema.nodes.orderedListItem.create({orderStart: 1}, [
                schema.nodes.paragraph.create(null, [schema.text("restart 1")]),
            ]),
        ]),
        {
            elements: [
                {
                    type: "OrderedList",
                    orderStart: 1,
                    items: [
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "foo"}]},
                            ],
                        },
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "bar"}]},
                            ],
                        },
                    ],
                },
                {
                    type: "OrderedList",
                    orderStart: 1,
                    items: [
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "restart 1"}]},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
1. <span data-start=\u201D1\u201D></span>foo

2. bar

1) <span data-start=\u201D1\u201D></span>restart 1
`,
    );
});

test("ordered list item with order start 3", () => {
    testIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.orderedListItem.create({orderStart: 3}, [
                schema.nodes.paragraph.create(null, [schema.text("foo")]),
            ]),
            schema.nodes.orderedListItem.create(null, [
                schema.nodes.paragraph.create(null, [schema.text("bar")]),
            ]),
        ]),
        {
            elements: [
                {
                    type: "OrderedList",
                    orderStart: 3,
                    items: [
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "foo"}]},
                            ],
                        },
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "bar"}]},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
3. foo

4. bar
`,
    );
});

test("second ordered list item with order start 2", () => {
    testIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.orderedListItem.create(null, [
                schema.nodes.paragraph.create(null, [schema.text("foo")]),
            ]),
            schema.nodes.orderedListItem.create({orderStart: 2}, [
                schema.nodes.paragraph.create(null, [schema.text("bar")]),
            ]),
            schema.nodes.orderedListItem.create(null, [
                schema.nodes.paragraph.create(null, [schema.text("baz")]),
            ]),
            schema.nodes.orderedListItem.create({orderStart: 4}, [
                schema.nodes.paragraph.create(null, [schema.text("boozy")]),
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
                {
                    type: "OrderedList",
                    orderStart: 2,
                    items: [
                        {elements: [{type: "Paragraph", elements: [{type: "Text", text: "bar"}]}]},
                        {elements: [{type: "Paragraph", elements: [{type: "Text", text: "baz"}]}]},
                    ],
                },
                {
                    type: "OrderedList",
                    orderStart: 4,
                    items: [
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "boozy"}]},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
1. foo

2) bar

3) baz

4. boozy
`,
    );
});

// =========================================================================== //
// File block elements //
// =========================================================================== //

// File block elements use HTML syntax in markdown (`<div data-file="..."/>` etc.).
// The markdown round-trip loses server-populated fields (contentType,
// contentLength) so we test ProseMirror -> API content and API content -> markdown
// separately.

const fileId1 = generateId<DocumentId>() as string as FileId;
const fileId2 = generateId<DocumentId>() as string as FileId;
const fileId3 = generateId<DocumentId>() as string as FileId;
const spaceId = generateId<SpaceId>();
const testDocumentId = generateId<DocumentId>();
const testChannelId = generateId<ChannelId>();
const documentEntityId = `Document:${testDocumentId}` as const;
const channelEntityId = `Channel:${testChannelId}` as const;

function createFileModelData(fileId: FileId): FileModelData {
    return {
        id: fileId,
        spaceId,
        contentType: "image/png",
        contentLength: 1024,
        isUploading: false,
        alternative: null,
        preview: {
            type: "Image",
            isProcessing: true,
            size: "Processing",
            placeholder: "Processing",
        },
        analysis: null,
        transcript: null,
    };
}

const fileOptions: ApiContentMarkdownIntoOptionsWithoutKeys = {
    getAccountIfExists: () => undefined,
    getSearchEntityMentionTitleIfExists: entityId => {
        if (entityId === documentEntityId) return "My Document";
        if (entityId === channelEntityId) return "General";
        return undefined;
    },
    getSearchTaskEntityDisplayStatusIfExists: () => undefined,
    getFileIfExists: fileId => createFileModelData(fileId),
};

function fileUrl(fileId: FileId) {
    return `https://alpine.inc/file/${fileId}/content`;
}

function previewUrl(entityPath: string) {
    return `https://alpine.inc/${entityPath}/preview`;
}

function testFileIntoApiContentAndPrintToMarkdown(
    prosemirrorNode: Node,
    expectedApiContent: ApiContentResponseWithoutKeys,
    expectedMarkdown: string,
) {
    prosemirrorNode.check();

    const actualApiContent = intoApiContent(prosemirrorNode, fileOptions);
    expect(actualApiContent).toEqual(expectedApiContent);

    const actualMarkdown = printApiContentToMarkdown(actualApiContent);
    expect(actualMarkdown).toEqual(expectedMarkdown);
}

test("single file in a fileRow", () => {
    testFileIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.fileRow!.create(null, [schema.nodes.file!.create({fileId: fileId1})]),
        ]),
        {
            elements: [
                {
                    type: "File",
                    file: {
                        id: fileId1,
                        contentType: "image/png",
                        contentLength: 1024,
                    },
                },
            ],
        },
        `\
![](${fileUrl(fileId1)})
`,
    );
});

test("fileFloat with left direction", () => {
    testFileIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.fileFloat.create({direction: "left"}, [
                schema.nodes.file!.create({fileId: fileId1}),
            ]),
        ]),
        {
            elements: [
                {
                    type: "FileFloat",
                    side: "Left",
                    element: {
                        type: "File",
                        file: {
                            id: fileId1,
                            contentType: "image/png",
                            contentLength: 1024,
                        },
                    },
                },
            ],
        },
        `\
<div style="float: left; clear: both">
<img src="${fileUrl(fileId1)}" />
</div>
`,
    );
});

test("fileFloat with right direction", () => {
    testFileIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.fileFloat.create({direction: "right"}, [
                schema.nodes.file!.create({fileId: fileId1}),
            ]),
        ]),
        {
            elements: [
                {
                    type: "FileFloat",
                    side: "Right",
                    element: {
                        type: "File",
                        file: {
                            id: fileId1,
                            contentType: "image/png",
                            contentLength: 1024,
                        },
                    },
                },
            ],
        },
        `\
<div style="float: right; clear: both">
<img src="${fileUrl(fileId1)}" />
</div>
`,
    );
});

test("file gallery with multiple files", () => {
    testFileIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.fileRow!.create(null, [
                schema.nodes.file!.create({fileId: fileId1}),
                schema.nodes.file!.create({fileId: fileId2}),
            ]),
        ]),
        {
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
                                        file: {
                                            id: fileId1,
                                            contentType: "image/png",
                                            contentLength: 1024,
                                        },
                                    },
                                },
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: fileId2,
                                            contentType: "image/png",
                                            contentLength: 1024,
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<div style="display: flex; align-items: stretch">
<img src="${fileUrl(fileId1)}" style="flex: 0 0 50%" />
<img src="${fileUrl(fileId2)}" style="flex: 0 0 50%" />
</div>
`,
    );
});

test("file gallery with three files", () => {
    testFileIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.fileRow!.create(null, [
                schema.nodes.file!.create({fileId: fileId1}),
                schema.nodes.file!.create({fileId: fileId2}),
                schema.nodes.file!.create({fileId: fileId3}),
            ]),
        ]),
        {
            elements: [
                {
                    type: "FileGallery",
                    rows: [
                        {
                            items: [
                                {
                                    width: 0.33,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: fileId1,
                                            contentType: "image/png",
                                            contentLength: 1024,
                                        },
                                    },
                                },
                                {
                                    width: 0.33,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: fileId2,
                                            contentType: "image/png",
                                            contentLength: 1024,
                                        },
                                    },
                                },
                                {
                                    width: 0.34,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: fileId3,
                                            contentType: "image/png",
                                            contentLength: 1024,
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<div style="display: flex; align-items: stretch">
<img src="${fileUrl(fileId1)}" style="flex: 0 0 33%" />
<img src="${fileUrl(fileId2)}" style="flex: 0 0 33%" />
<img src="${fileUrl(fileId3)}" style="flex: 0 0 34%" />
</div>
`,
    );
});

test("preview of a document entity", () => {
    testFileIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.fileRow!.create(null, [
                schema.nodes.file!.create({fileId: documentEntityId}),
            ]),
        ]),
        {
            elements: [
                {
                    type: "Preview",
                    reference: {type: "Document", id: testDocumentId, title: "My Document"},
                },
            ],
        },
        `\
![My Document](${previewUrl(`doc/${testDocumentId}`)})
`,
    );
});

test("fileFloat with preview entity", () => {
    testFileIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.fileFloat.create({direction: "left"}, [
                schema.nodes.file!.create({fileId: channelEntityId}),
            ]),
        ]),
        {
            elements: [
                {
                    type: "FileFloat",
                    side: "Left",
                    element: {
                        type: "Preview",
                        reference: {type: "Channel", id: testChannelId, title: "General"},
                    },
                },
            ],
        },
        `\
<div style="float: left; clear: both">
<img alt="General" src="${previewUrl(`channel/${testChannelId}`)}" />
</div>
`,
    );
});

test("file gallery with mixed files and previews", () => {
    testFileIntoApiContentAndPrintToMarkdown(
        schema.nodes.doc.create(null, [
            schema.nodes.fileRow!.create(null, [
                schema.nodes.file!.create({fileId: fileId1}),
                schema.nodes.file!.create({fileId: documentEntityId}),
            ]),
        ]),
        {
            elements: [
                {
                    type: "FileGallery",
                    rows: [
                        {
                            items: [
                                {
                                    width: 0.53,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: fileId1,
                                            contentType: "image/png",
                                            contentLength: 1024,
                                        },
                                    },
                                },
                                {
                                    width: 0.47,
                                    element: {
                                        type: "Preview",
                                        reference: {
                                            type: "Document",
                                            id: testDocumentId,
                                            title: "My Document",
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<div style="display: flex; align-items: stretch">
<img src="${fileUrl(fileId1)}" style="flex: 0 0 53%" />
<img alt="My Document" src="${previewUrl(`doc/${testDocumentId}`)}" style="flex: 0 0 47%" />
</div>
`,
    );
});

test("null fileId round-trips through ApiContent as unknownFileId", () => {
    const prosemirrorNode = schema.nodes.doc.create(null, [
        schema.nodes.fileRow!.create(null, [schema.nodes.file!.create({fileId: null})]),
    ]);

    prosemirrorNode.check();

    const apiContent = intoApiContent(prosemirrorNode, fileOptions);

    // null fileId in ProseMirror should produce unknownFileId in the API.
    expect(apiContent).toEqual({
        elements: [
            {
                type: "File",
                file: {
                    id: unknownFileId,
                    contentType: "application/octet-stream",
                    contentLength: 0,
                },
            },
        ],
    });

    // Round-trip back to ProseMirror and verify the null fileId is preserved.
    // fromApiContent converts unknownFileId back to null.
    const roundTripped = fromApiContent(schema, apiContent);
    const fileRow = roundTripped.content.content[0]!;
    const fileNode = fileRow.content.content[0]!;
    expect(fileNode.attrs.fileId).toBeNull();
});

test("fileRowTable in a table cell", () => {
    const prosemirrorNode = schema.nodes.doc.create(null, [
        schema.nodes.table.create({tableWidth: 2, columnWidths: [1, 1]}, [
            schema.nodes.tableRow.create(null, [
                schema.nodes.tableCell.create(null, [
                    schema.nodes.paragraph.create(null, [schema.text("text")]),
                ]),
                schema.nodes.tableCell.create(null, [
                    schema.nodes.fileRowTable!.create(null, [
                        schema.nodes.file!.create({fileId: fileId1}),
                    ]),
                ]),
            ]),
        ]),
    ]);

    prosemirrorNode.check();

    const actualApiContent = intoApiContent(prosemirrorNode, fileOptions);

    expect(actualApiContent).toMatchObject({
        elements: [
            {
                type: "Table",
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "text"}]},
                                ],
                            },
                            {
                                elements: [
                                    {
                                        type: "File",
                                        file: {
                                            id: fileId1,
                                            contentType: "image/png",
                                            contentLength: 1024,
                                        },
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
