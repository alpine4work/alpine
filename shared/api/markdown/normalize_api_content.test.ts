import {normalizeApiContent} from "~/shared/api/markdown/normalize_api_content.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId, FileId} from "~/shared/id/types/id_types.js";

const fileId1 = generateChronologicalId<FileId>();
const fileId2 = generateChronologicalId<FileId>();
const fileId3 = generateChronologicalId<FileId>();
const fileId4 = generateChronologicalId<FileId>();
const fileId5 = generateChronologicalId<FileId>();

test("FileGallery with single row and single file unwraps to standalone File", () => {
    const content: ApiContent = {
        elements: [
            {
                type: "FileGallery",
                rows: [{items: [{element: {type: "File", id: fileId1}}]}],
            },
        ],
    };

    expect(normalizeApiContent(content)).toEqual({
        elements: [{type: "File", id: fileId1}],
    });
});

test("FileGallery with single row and single Preview unwraps to standalone Preview", () => {
    const documentId = generateId<DocumentId>();
    const content: ApiContent = {
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {
                                element: {
                                    type: "Preview",
                                    target: {type: "Document", id: documentId},
                                    title: "Doc",
                                },
                            },
                        ],
                    },
                ],
            },
        ],
    };

    expect(normalizeApiContent(content)).toEqual({
        elements: [{type: "Preview", target: {type: "Document", id: documentId}}],
    });
});

test("Preview title is stripped during normalization", () => {
    const documentId = generateId<DocumentId>();
    const content: ApiContent = {
        elements: [
            {
                type: "Preview",
                target: {type: "Document", id: documentId},
                title: "My Document",
            },
        ],
    };

    const normalized = normalizeApiContent(content);
    expect(normalized).toEqual({
        elements: [{type: "Preview", target: {type: "Document", id: documentId}}],
    });
});

test("Preview without title is unchanged", () => {
    const documentId = generateId<DocumentId>();
    const content: ApiContent = {
        elements: [{type: "Preview", target: {type: "Document", id: documentId}}],
    };

    expect(normalizeApiContent(content)).toEqual(content);
});

test("FileGallery with multiple items in a row is preserved", () => {
    const content: ApiContent = {
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId1}},
                            {element: {type: "File", id: fileId2}},
                        ],
                    },
                ],
            },
        ],
    };

    expect(normalizeApiContent(content)).toEqual(content);
});

test("adjacent FileGalleries are merged into one", () => {
    const content: ApiContent = {
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId1}},
                            {element: {type: "File", id: fileId2}},
                        ],
                    },
                ],
            },
            {
                type: "FileGallery",
                rows: [{items: [{element: {type: "File", id: fileId3}}]}],
            },
        ],
    };

    expect(normalizeApiContent(content)).toEqual({
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId1}},
                            {element: {type: "File", id: fileId2}},
                        ],
                    },
                    {items: [{element: {type: "File", id: fileId3}}]},
                ],
            },
        ],
    });
});

test("three adjacent single-item FileGalleries merge into one", () => {
    const content: ApiContent = {
        elements: [
            {type: "FileGallery", rows: [{items: [{element: {type: "File", id: fileId1}}]}]},
            {type: "FileGallery", rows: [{items: [{element: {type: "File", id: fileId2}}]}]},
            {type: "FileGallery", rows: [{items: [{element: {type: "File", id: fileId3}}]}]},
        ],
    };

    expect(normalizeApiContent(content)).toEqual({
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {items: [{element: {type: "File", id: fileId1}}]},
                    {items: [{element: {type: "File", id: fileId2}}]},
                    {items: [{element: {type: "File", id: fileId3}}]},
                ],
            },
        ],
    });
});

test("three adjacent multi-item FileGalleries merge into one", () => {
    const content: ApiContent = {
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId1}},
                            {element: {type: "File", id: fileId2}},
                        ],
                    },
                ],
            },
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId2}},
                            {element: {type: "File", id: fileId3}},
                        ],
                    },
                ],
            },
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId3}},
                            {element: {type: "File", id: fileId1}},
                        ],
                    },
                ],
            },
        ],
    };

    expect(normalizeApiContent(content)).toEqual({
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId1}},
                            {element: {type: "File", id: fileId2}},
                        ],
                    },
                    {
                        items: [
                            {element: {type: "File", id: fileId2}},
                            {element: {type: "File", id: fileId3}},
                        ],
                    },
                    {
                        items: [
                            {element: {type: "File", id: fileId3}},
                            {element: {type: "File", id: fileId1}},
                        ],
                    },
                ],
            },
        ],
    });
});

test("non-adjacent FileGalleries are not merged", () => {
    const content: ApiContent = {
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId1}},
                            {element: {type: "File", id: fileId2}},
                        ],
                    },
                ],
            },
            {type: "Paragraph", elements: [{type: "Text", text: "hello"}]},
            {
                type: "FileGallery",
                rows: [{items: [{element: {type: "File", id: fileId3}}]}],
            },
        ],
    };

    // The second gallery has a single item, so it unwraps to standalone File.
    expect(normalizeApiContent(content)).toEqual({
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId1}},
                            {element: {type: "File", id: fileId2}},
                        ],
                    },
                ],
            },
            {type: "Paragraph", elements: [{type: "Text", text: "hello"}]},
            {type: "File", id: fileId3},
        ],
    });
});

test("separate FileGalleries with a single-element gallery between them normalize the same as one combined gallery", () => {
    const separate: ApiContent = {
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId1}},
                            {element: {type: "File", id: fileId2}},
                        ],
                    },
                ],
            },
            {
                type: "FileGallery",
                rows: [{items: [{element: {type: "File", id: fileId3}}]}],
            },
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId4}},
                            {element: {type: "File", id: fileId5}},
                        ],
                    },
                ],
            },
        ],
    };

    const combined: ApiContent = {
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId1}},
                            {element: {type: "File", id: fileId2}},
                        ],
                    },
                    {items: [{element: {type: "File", id: fileId3}}]},
                    {
                        items: [
                            {element: {type: "File", id: fileId4}},
                            {element: {type: "File", id: fileId5}},
                        ],
                    },
                ],
            },
        ],
    };

    expect(normalizeApiContent(separate)).toEqual(normalizeApiContent(combined));
});

test("standalone File between two FileGalleries normalizes the same as one combined gallery", () => {
    const withStandalone: ApiContent = {
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId1}},
                            {element: {type: "File", id: fileId2}},
                        ],
                    },
                ],
            },
            {type: "File", id: fileId3},
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId4}},
                            {element: {type: "File", id: fileId5}},
                        ],
                    },
                ],
            },
        ],
    };

    const combined: ApiContent = {
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId1}},
                            {element: {type: "File", id: fileId2}},
                        ],
                    },
                    {items: [{element: {type: "File", id: fileId3}}]},
                    {
                        items: [
                            {element: {type: "File", id: fileId4}},
                            {element: {type: "File", id: fileId5}},
                        ],
                    },
                ],
            },
        ],
    };

    expect(normalizeApiContent(withStandalone)).toEqual(normalizeApiContent(combined));
});

test("single empty paragraph in table cell is removed", () => {
    const content: ApiContent = {
        elements: [
            {
                type: "Table",
                width: 2,
                hasHeaderRow: undefined,
                hasHeaderColumn: undefined,
                columns: [{width: 1}, {width: 1}],
                rows: [
                    {
                        cells: [
                            {elements: [{type: "Paragraph", elements: []}]},
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "hi"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    };

    expect(normalizeApiContent(content).elements[0]).toMatchObject({
        rows: [
            {
                cells: [
                    {elements: []},
                    {elements: [{type: "Paragraph", elements: [{type: "Text", text: "hi"}]}]},
                ],
            },
        ],
    });
});

test("empty paragraph alongside File in table cell is preserved", () => {
    const content: ApiContent = {
        elements: [
            {
                type: "Table",
                width: 2,
                hasHeaderRow: undefined,
                hasHeaderColumn: undefined,
                columns: [{width: 1}, {width: 1}],
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: []},
                                    {type: "File", id: fileId1},
                                ],
                            },
                            {elements: []},
                        ],
                    },
                ],
            },
        ],
    };

    expect(normalizeApiContent(content).elements[0]).toMatchObject({
        rows: [
            {
                cells: [
                    {
                        elements: [
                            {type: "Paragraph", elements: []},
                            {type: "File", id: fileId1},
                        ],
                    },
                    {elements: []},
                ],
            },
        ],
    });
});

test("FileFloat normalizes inner element", () => {
    const documentId = generateId<DocumentId>();
    const content: ApiContent = {
        elements: [
            {
                type: "FileFloat",
                side: "Left",
                element: {
                    type: "Preview",
                    target: {type: "Document", id: documentId},
                    title: "My Document",
                },
            },
        ],
    };

    expect(normalizeApiContent(content)).toEqual({
        elements: [
            {
                type: "FileFloat",
                side: "Left",
                element: {type: "Preview", target: {type: "Document", id: documentId}},
            },
        ],
    });
});

test("adjacent standalone Files merge into a FileGallery", () => {
    const content: ApiContent = {
        elements: [
            {type: "File", id: fileId1},
            {type: "File", id: fileId2},
        ],
    };

    expect(normalizeApiContent(content)).toEqual({
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {items: [{element: {type: "File", id: fileId1}}]},
                    {items: [{element: {type: "File", id: fileId2}}]},
                ],
            },
        ],
    });
});

test("FileGallery normalizes Preview title inside items", () => {
    const documentId = generateId<DocumentId>();
    const content: ApiContent = {
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId1}},
                            {
                                element: {
                                    type: "Preview",
                                    target: {type: "Document", id: documentId},
                                    title: "My Document",
                                },
                            },
                        ],
                    },
                ],
            },
        ],
    };

    expect(normalizeApiContent(content)).toEqual({
        elements: [
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {element: {type: "File", id: fileId1}},
                            {
                                element: {
                                    type: "Preview",
                                    target: {type: "Document", id: documentId},
                                },
                            },
                        ],
                    },
                ],
            },
        ],
    });
});
