import {Node} from "prosemirror-model";
import {EditorState, TextSelection} from "prosemirror-state";
import {createConvertListItemsAtIndentCommand} from "~/client/web/content/internal/helpers/create_convert_list_items_at_indent_command.js";
import {createContentBuilder} from "~/shared/content/create_content_builder.js";
import {MessageContentProsemirrorSchema as schema} from "~/shared/content/message_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

const {doc, paragraph, quoteBlock, table, tableRow, tableCell, unorderedListItem, orderedListItem} =
    createContentBuilder(schema);

test("converts top-level list items without converting nested children", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph("a")),
        unorderedListItem(1, paragraph("b")),
        unorderedListItem(0, paragraph("c")),
    );
    const expectedDoc = doc(
        orderedListItem(0, paragraph("a")),
        unorderedListItem(1, paragraph("b")),
        orderedListItem(0, paragraph("c")),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "a");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts only top-level items across double and triple nested bullets", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph("a")),
        unorderedListItem(1, paragraph("a.1")),
        unorderedListItem(2, paragraph("a.1.a")),
        unorderedListItem(3, paragraph("a.1.a.i")),
        unorderedListItem(0, paragraph("b")),
        unorderedListItem(1, paragraph("b.1")),
        unorderedListItem(2, paragraph("b.1.a")),
        unorderedListItem(0, paragraph("c")),
    );
    const expectedDoc = doc(
        orderedListItem(0, paragraph("a")),
        unorderedListItem(1, paragraph("a.1")),
        unorderedListItem(2, paragraph("a.1.a")),
        unorderedListItem(3, paragraph("a.1.a.i")),
        orderedListItem(0, paragraph("b")),
        unorderedListItem(1, paragraph("b.1")),
        unorderedListItem(2, paragraph("b.1.a")),
        orderedListItem(0, paragraph("c")),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "b");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts second-tier items in the middle of first and third tiers", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph("a")),
        unorderedListItem(1, paragraph("b")),
        unorderedListItem(2, paragraph("c")),
        unorderedListItem(1, paragraph("d")),
        unorderedListItem(0, paragraph("e")),
    );
    const expectedDoc = doc(
        unorderedListItem(0, paragraph("a")),
        orderedListItem(1, paragraph("b")),
        unorderedListItem(2, paragraph("c")),
        orderedListItem(1, paragraph("d")),
        unorderedListItem(0, paragraph("e")),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "b");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts third-tier items without converting fourth-tier children", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph("a")),
        unorderedListItem(1, paragraph("b")),
        unorderedListItem(2, paragraph("c")),
        unorderedListItem(3, paragraph("d")),
        unorderedListItem(2, paragraph("e")),
        unorderedListItem(1, paragraph("f")),
    );
    const expectedDoc = doc(
        unorderedListItem(0, paragraph("a")),
        unorderedListItem(1, paragraph("b")),
        orderedListItem(2, paragraph("c")),
        unorderedListItem(3, paragraph("d")),
        orderedListItem(2, paragraph("e")),
        unorderedListItem(1, paragraph("f")),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "c");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts deepest nested items in a triple-nested run", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph("a")),
        unorderedListItem(1, paragraph("b")),
        unorderedListItem(2, paragraph("c")),
        unorderedListItem(3, paragraph("d")),
        unorderedListItem(3, paragraph("e")),
        unorderedListItem(2, paragraph("f")),
        unorderedListItem(1, paragraph("g")),
    );
    const expectedDoc = doc(
        unorderedListItem(0, paragraph("a")),
        unorderedListItem(1, paragraph("b")),
        unorderedListItem(2, paragraph("c")),
        orderedListItem(3, paragraph("d")),
        orderedListItem(3, paragraph("e")),
        unorderedListItem(2, paragraph("f")),
        unorderedListItem(1, paragraph("g")),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "d");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("does not convert same-indent nested list items under a later parent", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph("a")),
        unorderedListItem(1, paragraph("b")),
        unorderedListItem(0, paragraph("c")),
        unorderedListItem(1, paragraph("d")),
    );
    const expectedDoc = doc(
        unorderedListItem(0, paragraph("a")),
        orderedListItem(1, paragraph("b")),
        unorderedListItem(0, paragraph("c")),
        unorderedListItem(1, paragraph("d")),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "b");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("stops conversion at non-list separators", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph("a")),
        paragraph("separator"),
        unorderedListItem(0, paragraph("b")),
    );
    const expectedDoc = doc(
        orderedListItem(0, paragraph("a")),
        paragraph("separator"),
        unorderedListItem(0, paragraph("b")),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "a");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts list items inside block quotes", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph("outside")),
        quoteBlock(
            paragraph("intro"),
            unorderedListItem(0, paragraph("a")),
            unorderedListItem(0, paragraph("b")),
        ),
    );
    const expectedDoc = doc(
        unorderedListItem(0, paragraph("outside")),
        quoteBlock(
            paragraph("intro"),
            orderedListItem(0, paragraph("a")),
            orderedListItem(0, paragraph("b")),
        ),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "b");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts list items inside the selected table cell", () => {
    const inputDoc = doc(
        table(
            {columnWidths: []},
            tableRow(
                tableCell(
                    unorderedListItem(0, paragraph("a")),
                    unorderedListItem(0, paragraph("b")),
                ),
                tableCell(unorderedListItem(0, paragraph("c"))),
            ),
        ),
    );
    const expectedDoc = doc(
        table(
            {columnWidths: []},
            tableRow(
                tableCell(orderedListItem(0, paragraph("a")), orderedListItem(0, paragraph("b"))),
                tableCell(unorderedListItem(0, paragraph("c"))),
            ),
        ),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "a");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

function runConvertToOrderedList(inputDoc: Node, selectedText: string) {
    const state = EditorState.create({
        doc: inputDoc,
        schema,
        selection: TextSelection.create(inputDoc, getPositionInsideText(inputDoc, selectedText)),
    });

    let newState = state;
    const command = createConvertListItemsAtIndentCommand(schema.nodes.orderedListItem);
    command(newState, tr => {
        newState = newState.apply(tr);
    });

    return newState.doc;
}

function getPositionInsideText(inputDoc: Node, selectedText: string) {
    let textPosition: number | null = null;

    inputDoc.descendants((node, pos) => {
        if (node.isText && node.text === selectedText) {
            textPosition = pos + 1;
            return false;
        }
        return true;
    });

    assert(textPosition !== null);
    return textPosition;
}
