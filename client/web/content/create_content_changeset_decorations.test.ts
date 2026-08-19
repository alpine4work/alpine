import {Fragment, Node, Slice} from "prosemirror-model";
import {
    AddMarkStep,
    AddNodeMarkStep,
    DocAttrStep,
    RemoveMarkStep,
    ReplaceStep,
} from "prosemirror-transform";
import {createContentChangesetDecorations} from "~/client/web/content/create_content_changeset_decorations.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {DocumentContentCover} from "~/shared/documents/document_content_cover.js";
import {DocumentContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {DocumentCommentThreadId, FileId} from "~/shared/id/types/id_types.open_source.js";

function getContentChangesetDecorationTestValues(
    decorations: ReturnType<typeof createContentChangesetDecorations>["decorations"],
) {
    return decorations.map(decoration => {
        switch (decoration.type) {
            case "Inline":
                return {
                    type: decoration.type,
                    from: decoration.from,
                    to: decoration.to,
                    nodeName: decoration.attrs.nodeName,
                    class: decoration.attrs.class,
                };
            case "Node":
                return {
                    type: decoration.type,
                    from: decoration.from,
                    to: decoration.to,
                    class: decoration.attrs.class,
                };
            case "Widget":
                return {
                    type: decoration.type,
                    pos: decoration.pos,
                    html: decoration.html.generateHtml(),
                };
            default:
                throw exhaustive(decoration);
        }
    });
}

function getContentChangesetTableCellRanges(doc: Node): Array<{from: number; to: number}> {
    const tableCellRanges: Array<{from: number; to: number}> = [];

    doc.descendants((node, pos) => {
        if (node.type.name === "tableCell") {
            tableCellRanges.push({from: pos, to: pos + node.nodeSize});
        }
    });

    return tableCellRanges;
}

function createContentChangesetTestTable(rows: ReadonlyArray<ReadonlyArray<string>>) {
    return schema.node(
        "table",
        {},
        rows.map(row =>
            schema.node(
                "tableRow",
                {},
                row.map(text =>
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text(text)]),
                    ]),
                ),
            ),
        ),
    );
}

function expectContentChangesetTableCellDecorations({
    decorations,
    tableCellRanges,
    className,
}: {
    decorations: ReturnType<typeof createContentChangesetDecorations>["decorations"];
    tableCellRanges: ReadonlyArray<{from: number; to: number}>;
    className: string;
}) {
    expect(getContentChangesetDecorationTestValues(decorations)).toEqual(
        tableCellRanges.map(({from, to}) => ({
            type: "Node",
            from,
            to,
            class: className,
        })),
    );
}

test("inserts deleted content into the rendered document before inserted content", () => {
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("paragraph", undefined, [schema.text("hello world")]),
    ]);
    const deleteStep = new ReplaceStep(9, 14, Slice.empty);
    const insertStep = new ReplaceStep(9, 9, new Slice(Fragment.from(schema.text("Alpine")), 0, 0));

    const {endDoc, renderedDoc, decorations} = createContentChangesetDecorations({
        startDoc,
        steps: [deleteStep, insertStep],
    });

    expect(endDoc.textBetween(0, endDoc.content.size)).toBe("hello Alpine");
    expect(renderedDoc.textBetween(0, renderedDoc.content.size)).toBe("hello worldAlpine");
    expect(getContentChangesetDecorationTestValues(decorations)).toEqual([
        {
            type: "Inline",
            from: 9,
            to: 14,
            nodeName: "del",
            class: contentStyles.contentChangesetDeletedClassName,
        },
        {
            type: "Inline",
            from: 14,
            to: 20,
            nodeName: "ins",
            class: contentStyles.contentChangesetInsertedClassName,
        },
    ]);
});

test("renders a title insertion without duplicating the required title node", () => {
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("paragraph", undefined, [schema.text("hello")]),
    ]);
    const insertTitleStep = new ReplaceStep(
        1,
        1,
        new Slice(Fragment.from(schema.text("Test")), 0, 0),
    );

    const {endDoc, renderedDoc, decorations} = createContentChangesetDecorations({
        startDoc,
        steps: [insertTitleStep],
    });

    expect(endDoc.textBetween(0, endDoc.content.size)).toBe("Testhello");
    expect(renderedDoc.textBetween(0, renderedDoc.content.size)).toBe("Testhello");
    expect(renderedDoc.childCount).toBe(2);
    expect(renderedDoc.child(0).type.name).toBe("title");
    expect(getContentChangesetDecorationTestValues(decorations)).toEqual([
        {
            type: "Inline",
            from: 1,
            to: 5,
            nodeName: "ins",
            class: contentStyles.contentChangesetInsertedClassName,
        },
    ]);
});

test("renders a whole paragraph replacement after preceding blocks", () => {
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("paragraph", undefined, [schema.text("first")]),
        schema.node("paragraph", undefined, [schema.text("old")]),
    ]);
    const replaceStep = new ReplaceStep(10, 13, new Slice(Fragment.from(schema.text("new")), 0, 0));

    const {endDoc, renderedDoc} = createContentChangesetDecorations({
        startDoc,
        steps: [replaceStep],
    });

    expect(endDoc.textBetween(0, endDoc.content.size)).toBe("firstnew");
    expect(renderedDoc.childCount).toBe(4);
    expect(renderedDoc.child(2).textBetween(0, renderedDoc.child(2).content.size)).toBe("old");
    expect(renderedDoc.child(3).textBetween(0, renderedDoc.child(3).content.size)).toBe("new");
});

test("renders formatting-only changes as deletion and insertion", () => {
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("paragraph", undefined, [schema.text("hello")]),
    ]);
    const formatStep = new AddMarkStep(3, 8, schema.mark("bold"));

    const {endDoc, renderedDoc, decorations} = createContentChangesetDecorations({
        startDoc,
        steps: [formatStep],
    });

    expect(endDoc.textBetween(0, endDoc.content.size)).toBe("hello");
    expect(renderedDoc.textBetween(0, renderedDoc.content.size)).toBe("hellohello");
    expect(getContentChangesetDecorationTestValues(decorations)).toEqual([
        {
            type: "Inline",
            from: 2,
            to: 9,
            nodeName: "del",
            class: contentStyles.contentChangesetDeletedClassName,
        },
        {
            type: "Inline",
            from: 9,
            to: 16,
            nodeName: "ins",
            class: contentStyles.contentChangesetInsertedClassName,
        },
    ]);
});

test("preserves the deleted content\\u2019s marks", () => {
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("paragraph", undefined, [schema.text("hello", [schema.mark("code")])]),
    ]);
    const formatStep = new RemoveMarkStep(3, 8, schema.mark("code"));

    const {renderedDoc} = createContentChangesetDecorations({
        startDoc,
        steps: [formatStep],
    });

    expect(renderedDoc.child(1).firstChild?.marks).toContainEqual(schema.mark("code"));
});

test("renders file comment updates as a deletion and insertion", () => {
    const fileId = generateChronologicalId<FileId>();
    const commentThreadId = generateId<DocumentCommentThreadId>();
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("fileRow", {}, [schema.node("file", {fileId})]),
    ]);

    const {renderedDoc, decorations} = createContentChangesetDecorations({
        startDoc,
        steps: [new AddNodeMarkStep(3, schema.mark("comment", {commentThreadId}))],
    });

    expect(renderedDoc.childCount).toBe(2);
    expect(renderedDoc.child(1).childCount).toBe(2);
    expect(renderedDoc.child(1).child(0).marks).toEqual([]);
    expect(renderedDoc.child(1).child(1).marks).toContainEqual(
        schema.mark("comment", {commentThreadId}),
    );
    expect(getContentChangesetDecorationTestValues(decorations)).toEqual([
        {
            type: "Node",
            from: 3,
            to: 4,
            class: contentStyles.contentChangesetDeletedClassName,
        },
        {
            type: "Node",
            from: 4,
            to: 5,
            class: contentStyles.contentChangesetInsertedClassName,
        },
    ]);
});

test("renders deleted empty blocks as document nodes", () => {
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("paragraph"),
        schema.node("paragraph", undefined, [schema.text("after")]),
    ]);

    const {endDoc, renderedDoc, decorations} = createContentChangesetDecorations({
        startDoc,
        steps: [new ReplaceStep(2, 4, Slice.empty)],
    });

    expect(endDoc.childCount).toBe(2);
    expect(renderedDoc.childCount).toBe(3);
    expect(renderedDoc.child(1).type.name).toBe("paragraph");
    expect(getContentChangesetDecorationTestValues(decorations)).toEqual([
        {
            type: "Node",
            from: 2,
            to: 4,
            class: contentStyles.contentChangesetDeletedClassName,
        },
    ]);
});

test("marks every cell when inserting a table", () => {
    const insertedTable = createContentChangesetTestTable([
        ["a", "b"],
        ["c", "d"],
    ]);
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("paragraph"),
    ]);

    const {renderedDoc, decorations} = createContentChangesetDecorations({
        startDoc,
        steps: [new ReplaceStep(4, 4, new Slice(Fragment.from(insertedTable), 0, 0))],
    });

    expectContentChangesetTableCellDecorations({
        decorations,
        tableCellRanges: getContentChangesetTableCellRanges(renderedDoc),
        className: contentStyles.contentChangesetInsertedTableCellClassName,
    });
});

test("marks every cell when inserting a table row", () => {
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        createContentChangesetTestTable([
            ["a", "b"],
            ["c", "d"],
        ]),
    ]);
    const startTable = startDoc.child(1);
    const firstRow = startTable.child(0);
    const insertedRow = createContentChangesetTestTable([["e", "f"]]).child(0);
    const tablePosition = startDoc.child(0).nodeSize;
    const insertPosition = tablePosition + 1 + firstRow.nodeSize;

    const {renderedDoc, decorations} = createContentChangesetDecorations({
        startDoc,
        steps: [
            new ReplaceStep(
                insertPosition,
                insertPosition,
                new Slice(Fragment.from(insertedRow), 0, 0),
            ),
        ],
    });

    expectContentChangesetTableCellDecorations({
        decorations,
        tableCellRanges: getContentChangesetTableCellRanges(renderedDoc).slice(2, 4),
        className: contentStyles.contentChangesetInsertedTableCellClassName,
    });
});

test("marks every cell when inserting a table column", () => {
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        createContentChangesetTestTable([
            ["a", "b"],
            ["c", "d"],
        ]),
    ]);
    const insertedTopCell = createContentChangesetTestTable([["e", "f"]])
        .child(0)
        .child(0);
    const insertedBottomCell = createContentChangesetTestTable([["g", "h"]])
        .child(0)
        .child(1);
    const topRowEnd = getContentChangesetTableCellRanges(startDoc)[1]!.to;
    const insertTopCellStep = new ReplaceStep(
        topRowEnd,
        topRowEnd,
        new Slice(Fragment.from(insertedTopCell), 0, 0),
    );
    const documentWithInsertedTopCell = assertExists(insertTopCellStep.apply(startDoc).doc);
    const bottomRowEnd = getContentChangesetTableCellRanges(documentWithInsertedTopCell)[4]!.to;
    const insertBottomCellStep = new ReplaceStep(
        bottomRowEnd,
        bottomRowEnd,
        new Slice(Fragment.from(insertedBottomCell), 0, 0),
    );

    const {renderedDoc, decorations} = createContentChangesetDecorations({
        startDoc,
        steps: [insertTopCellStep, insertBottomCellStep],
    });

    const tableCellRanges = getContentChangesetTableCellRanges(renderedDoc);
    expectContentChangesetTableCellDecorations({
        decorations,
        tableCellRanges: [tableCellRanges[2]!, tableCellRanges[5]!],
        className: contentStyles.contentChangesetInsertedTableCellClassName,
    });
});

test("marks every cell when deleting a table", () => {
    const deletedTable = createContentChangesetTestTable([
        ["a", "b"],
        ["c", "d"],
    ]);
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        deletedTable,
        schema.node("paragraph"),
    ]);
    const tablePosition = startDoc.child(0).nodeSize;

    const {renderedDoc, decorations} = createContentChangesetDecorations({
        startDoc,
        steps: [new ReplaceStep(tablePosition, tablePosition + deletedTable.nodeSize, Slice.empty)],
    });

    expectContentChangesetTableCellDecorations({
        decorations,
        tableCellRanges: getContentChangesetTableCellRanges(renderedDoc),
        className: contentStyles.contentChangesetDeletedTableCellClassName,
    });
});

test("marks every cell when deleting a table row", () => {
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        createContentChangesetTestTable([
            ["a", "b"],
            ["c", "d"],
        ]),
    ]);
    const startTable = startDoc.child(1);
    const firstRow = startTable.child(0);
    const deletedRow = startTable.child(1);
    const tablePosition = startDoc.child(0).nodeSize;
    const deletePosition = tablePosition + 1 + firstRow.nodeSize;

    const {renderedDoc, decorations} = createContentChangesetDecorations({
        startDoc,
        steps: [new ReplaceStep(deletePosition, deletePosition + deletedRow.nodeSize, Slice.empty)],
    });

    expectContentChangesetTableCellDecorations({
        decorations,
        tableCellRanges: getContentChangesetTableCellRanges(renderedDoc).slice(2, 4),
        className: contentStyles.contentChangesetDeletedTableCellClassName,
    });
});

test("marks every cell when deleting a table column", () => {
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        createContentChangesetTestTable([
            ["a", "b", "c"],
            ["d", "e", "f"],
        ]),
    ]);
    const firstDeletedCellRange = getContentChangesetTableCellRanges(startDoc)[1]!;
    const deleteTopCellStep = new ReplaceStep(
        firstDeletedCellRange.from,
        firstDeletedCellRange.to,
        Slice.empty,
    );
    const documentWithDeletedTopCell = assertExists(deleteTopCellStep.apply(startDoc).doc);
    const secondDeletedCellRange = getContentChangesetTableCellRanges(
        documentWithDeletedTopCell,
    )[3]!;
    const deleteBottomCellStep = new ReplaceStep(
        secondDeletedCellRange.from,
        secondDeletedCellRange.to,
        Slice.empty,
    );

    const {renderedDoc, decorations} = createContentChangesetDecorations({
        startDoc,
        steps: [deleteTopCellStep, deleteBottomCellStep],
    });

    const tableCellRanges = getContentChangesetTableCellRanges(renderedDoc);
    expectContentChangesetTableCellDecorations({
        decorations,
        tableCellRanges: [tableCellRanges[1]!, tableCellRanges[4]!],
        className: contentStyles.contentChangesetDeletedTableCellClassName,
    });
});

test("marks inserted formatted text in green", () => {
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("paragraph", undefined, [schema.text("hello")]),
    ]);
    const insertStep = new ReplaceStep(
        8,
        8,
        new Slice(Fragment.from(schema.text(" there", [schema.mark("bold")])), 0, 0),
    );

    const {decorations} = createContentChangesetDecorations({
        startDoc,
        steps: [insertStep],
    });

    expect(getContentChangesetDecorationTestValues(decorations)).toEqual([
        {
            type: "Inline",
            from: 8,
            to: 14,
            nodeName: "ins",
            class: contentStyles.contentChangesetInsertedClassName,
        },
    ]);
});

test("merges inserted text and formatting into one replacement", () => {
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("paragraph", undefined, [schema.text("hello")]),
    ]);
    const insertStep = new ReplaceStep(8, 8, new Slice(Fragment.from(schema.text(" world")), 0, 0));
    const formatStep = new AddMarkStep(3, 14, schema.mark("bold"));

    const {renderedDoc, decorations} = createContentChangesetDecorations({
        startDoc,
        steps: [insertStep, formatStep],
    });

    expect(renderedDoc.textBetween(0, renderedDoc.content.size)).toBe("hellohello world");
    expect(getContentChangesetDecorationTestValues(decorations)).toEqual([
        {
            type: "Inline",
            from: 2,
            to: 9,
            nodeName: "del",
            class: contentStyles.contentChangesetDeletedClassName,
        },
        {
            type: "Inline",
            from: 9,
            to: 22,
            nodeName: "ins",
            class: contentStyles.contentChangesetInsertedClassName,
        },
    ]);
});

test("merges removed text and formatting into one replacement", () => {
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("paragraph", undefined, [schema.text("hello world")]),
    ]);
    const removeStep = new ReplaceStep(8, 14, Slice.empty);
    const formatStep = new AddMarkStep(3, 8, schema.mark("bold"));

    const {renderedDoc, decorations} = createContentChangesetDecorations({
        startDoc,
        steps: [removeStep, formatStep],
    });

    expect(renderedDoc.textBetween(0, renderedDoc.content.size)).toBe("hello worldhello");
    expect(getContentChangesetDecorationTestValues(decorations)).toEqual([
        {
            type: "Inline",
            from: 2,
            to: 15,
            nodeName: "del",
            class: contentStyles.contentChangesetDeletedClassName,
        },
        {
            type: "Inline",
            from: 15,
            to: 22,
            nodeName: "ins",
            class: contentStyles.contentChangesetInsertedClassName,
        },
    ]);
});

test("identifies and applies a cover-only document change", () => {
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("paragraph"),
    ]);
    const cover = {
        type: "Blobs",
        seed: "history-cover",
        themeColor: "indigo",
        hueSpread: 45,
    } satisfies DocumentContentCover;

    const {endDoc, decorations, hasOnlyCoverChanges} = createContentChangesetDecorations({
        startDoc,
        steps: [new DocAttrStep("cover", cover)],
    });

    expect(endDoc.attrs.cover).toEqual(cover);
    expect(decorations).toEqual([]);
    expect(hasOnlyCoverChanges).toBe(true);
});

test("does not identify multiple document attribute changes as cover-only", () => {
    const startDoc = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("paragraph"),
    ]);
    const cover = {
        type: "Blobs",
        seed: "history-cover",
        themeColor: "indigo",
        hueSpread: 45,
    } satisfies DocumentContentCover;

    const {hasOnlyCoverChanges} = createContentChangesetDecorations({
        startDoc,
        steps: [new DocAttrStep("cover", cover), new DocAttrStep("hasPresentShortcut", true)],
    });

    expect(hasOnlyCoverChanges).toBe(false);
});
