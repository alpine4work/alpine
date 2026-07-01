import {Node} from "prosemirror-model";
import {createContentBuilder} from "~/shared/content/create_content_builder.js";
import {
    DocumentCommentThreadSnippet,
    createDocumentCommentThreadSnippetCollector,
} from "~/shared/documents/create_document_comment_thread_snippet_collector.js";
import {
    assertDocumentContent,
    DocumentContentProsemirrorSchema as schema,
} from "~/shared/documents/document_content_schema.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, FileId} from "~/shared/id/types/id_types.js";

const {
    doc,
    paragraph,
    quoteBlock,
    table,
    tableRow,
    tableCell,
    fileRow,
    fileRowTable,
    file,
    fileFloat,
    comment,
} = createContentBuilder(schema);

function getSnippet(
    content: Node,
    commentThreadId: DocumentCommentThreadId,
): DocumentCommentThreadSnippet {
    return assertExists(
        createDocumentCommentThreadSnippetCollector([commentThreadId])(
            assertDocumentContent(content),
        ).get(commentThreadId),
    );
}

test("returns the top-level block position when the snippet starts between document children", () => {
    const commentThreadId = generateId<DocumentCommentThreadId>();
    const content = doc(
        paragraph("Paragraph 1"),
        paragraph("Paragraph 2"),
        paragraph("Paragraph 3"),
        paragraph("Paragraph 4"),
        paragraph(comment(commentThreadId, "Paragraph 5")),
        paragraph("Paragraph 6"),
    );

    const snippet = getSnippet(content, commentThreadId);

    expect(snippet.node.toJSON()).toEqual({
        from: 13,
        to: 78,
        openFrom: 0,
        openTo: 0,
        node: doc(
            paragraph("Paragraph 2"),
            paragraph("Paragraph 3"),
            paragraph("Paragraph 4"),
            paragraph(comment(commentThreadId, "Paragraph 5")),
            paragraph("Paragraph 6"),
        ).toJSON(),
    });
});

test("subtracts open depth when the snippet starts inside a quote block", () => {
    const commentThreadId = generateId<DocumentCommentThreadId>();
    const content = doc(
        paragraph("Intro"),
        quoteBlock(
            paragraph("Quote 1"),
            paragraph("Quote 2"),
            paragraph("Quote 3"),
            paragraph(comment(commentThreadId, "Quote 4")),
            paragraph("Quote 5"),
        ),
        paragraph("Outro"),
    );

    const snippet = getSnippet(content, commentThreadId);

    expect(snippet.node.toJSON()).toEqual({
        from: 8,
        to: 61,
        openFrom: 1,
        openTo: 0,
        node: doc(
            quoteBlock(
                paragraph("Quote 1"),
                paragraph("Quote 2"),
                paragraph("Quote 3"),
                paragraph(comment(commentThreadId, "Quote 4")),
                paragraph("Quote 5"),
            ),
            paragraph("Outro"),
        ).toJSON(),
    });
});

test("subtracts open depth when the snippet starts inside a very long quote block", () => {
    const commentThreadId = generateId<DocumentCommentThreadId>();
    const content = doc(
        paragraph("Intro"),
        quoteBlock(
            paragraph("Quote 1"),
            paragraph("Quote 2"),
            paragraph("Quote 3"),
            paragraph("Quote 4"),
            paragraph("Quote 5"),
            paragraph("Quote 6"),
            paragraph("Quote 7"),
            paragraph("Quote 8"),
            paragraph(comment(commentThreadId, "Quote 9")),
            paragraph("Quote 10"),
            paragraph("Quote 11"),
            paragraph("Quote 12"),
        ),
        paragraph("Outro"),
    );

    const snippet = getSnippet(content, commentThreadId);

    expect(snippet.node.toJSON()).toEqual({
        from: 53,
        to: 127,
        openFrom: 1,
        openTo: 0,
        node: doc(
            quoteBlock(
                paragraph("Quote 6"),
                paragraph("Quote 7"),
                paragraph("Quote 8"),
                paragraph(comment(commentThreadId, "Quote 9")),
                paragraph("Quote 10"),
                paragraph("Quote 11"),
                paragraph("Quote 12"),
            ),
            paragraph("Outro"),
        ).toJSON(),
    });
});

test("cuts entirely within a quote block", () => {
    const commentThreadId = generateId<DocumentCommentThreadId>();
    const content = doc(
        paragraph("Intro"),
        quoteBlock(
            paragraph("Quote 1"),
            paragraph("Quote 2"),
            paragraph("Quote 3"),
            paragraph("Quote 4"),
            paragraph("Quote 5"),
            paragraph(comment(commentThreadId, "Quote 6")),
            paragraph("Quote 7"),
            paragraph("Quote 8"),
            paragraph("Quote 9"),
            paragraph("Quote 10"),
            paragraph("Quote 11"),
            paragraph("Quote 12"),
            paragraph("Quote 13"),
            paragraph("Quote 14"),
            paragraph("Quote 15"),
            paragraph("Quote 16"),
        ),
        paragraph("Outro"),
    );

    const snippet = getSnippet(content, commentThreadId);

    expect(snippet.node.toJSON()).toEqual({
        from: 26,
        to: 139,
        openFrom: 1,
        openTo: 1,
        node: doc(
            quoteBlock(
                paragraph("Quote 3"),
                paragraph("Quote 4"),
                paragraph("Quote 5"),
                paragraph(comment(commentThreadId, "Quote 6")),
                paragraph("Quote 7"),
                paragraph("Quote 8"),
                paragraph("Quote 9"),
                paragraph("Quote 10"),
                paragraph("Quote 11"),
                paragraph("Quote 12"),
                paragraph("Quote 13"),
                paragraph("Quote 14"),
            ),
        ).toJSON(),
    });
});

test("subtracts multiple open depths when the snippet starts inside a table cell", () => {
    const commentThreadId = generateId<DocumentCommentThreadId>();
    const content = doc(
        paragraph("Intro"),
        table(
            {columnWidths: []},
            tableRow(
                tableCell(
                    paragraph("Cell 1"),
                    paragraph("Cell 2"),
                    paragraph("Cell 3"),
                    paragraph(comment(commentThreadId, "Cell 4")),
                    paragraph("Cell 5"),
                ),
            ),
        ),
        paragraph("Outro"),
    );

    const snippet = getSnippet(content, commentThreadId);

    expect(snippet.node.toJSON()).toEqual({
        from: 9,
        to: 60,
        openFrom: 2,
        openTo: 0,
        node: doc(
            table(
                {columnWidths: []},
                tableRow(
                    tableCell(
                        paragraph("Cell 1"),
                        paragraph("Cell 2"),
                        paragraph("Cell 3"),
                        paragraph(comment(commentThreadId, "Cell 4")),
                        paragraph("Cell 5"),
                    ),
                ),
            ),
            paragraph("Outro"),
        ).toJSON(),
    });
});

test("collects snippets for comments on files in file rows", () => {
    const commentThreadId = generateId<DocumentCommentThreadId>();
    const fileId = generateChronologicalId<FileId>();
    const content = doc(
        paragraph("Paragraph 1"),
        paragraph("Paragraph 2"),
        paragraph("Paragraph 3"),
        paragraph("Paragraph 4"),
        fileRow(comment(commentThreadId, file({fileId}))),
        paragraph("Paragraph 5"),
    );

    const snippet = getSnippet(content, commentThreadId);

    expect(snippet.node.toJSON()).toEqual({
        from: 13,
        to: 68,
        openFrom: 0,
        openTo: 0,
        node: doc(
            paragraph("Paragraph 2"),
            paragraph("Paragraph 3"),
            paragraph("Paragraph 4"),
            fileRow(comment(commentThreadId, file({fileId}))),
            paragraph("Paragraph 5"),
        ).toJSON(),
    });
});

test("collects snippets for comments on floated files", () => {
    const commentThreadId = generateId<DocumentCommentThreadId>();
    const fileId = generateChronologicalId<FileId>();
    const content = doc(
        paragraph("Paragraph 1"),
        paragraph("Paragraph 2"),
        paragraph("Paragraph 3"),
        paragraph("Paragraph 4"),
        fileFloat({direction: "left"}, comment(commentThreadId, file({fileId}))),
        paragraph("Paragraph 5"),
    );

    const snippet = getSnippet(content, commentThreadId);

    expect(snippet.node.toJSON()).toEqual({
        from: 13,
        to: 68,
        openFrom: 0,
        openTo: 0,
        node: doc(
            paragraph("Paragraph 2"),
            paragraph("Paragraph 3"),
            paragraph("Paragraph 4"),
            fileFloat({direction: "left"}, comment(commentThreadId, file({fileId}))),
            paragraph("Paragraph 5"),
        ).toJSON(),
    });
});

test("collects snippets for comments on files in table cells", () => {
    const commentThreadId = generateId<DocumentCommentThreadId>();
    const fileId = generateChronologicalId<FileId>();
    const content = doc(
        paragraph("Intro"),
        table(
            {columnWidths: []},
            tableRow(
                tableCell(
                    paragraph("Cell 1"),
                    paragraph("Cell 2"),
                    paragraph("Cell 3"),
                    fileRowTable(comment(commentThreadId, file({fileId}))),
                    paragraph("Cell 5"),
                ),
            ),
        ),
        paragraph("Outro"),
    );

    const snippet = getSnippet(content, commentThreadId);

    expect(snippet.node.toJSON()).toEqual({
        from: 9,
        to: 55,
        openFrom: 2,
        openTo: 0,
        node: doc(
            table(
                {columnWidths: []},
                tableRow(
                    tableCell(
                        paragraph("Cell 1"),
                        paragraph("Cell 2"),
                        paragraph("Cell 3"),
                        fileRowTable(comment(commentThreadId, file({fileId}))),
                        paragraph("Cell 5"),
                    ),
                ),
            ),
            paragraph("Outro"),
        ).toJSON(),
    });
});
