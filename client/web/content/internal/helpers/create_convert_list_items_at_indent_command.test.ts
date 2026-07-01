import {Node} from "prosemirror-model";
import {EditorState, TextSelection} from "prosemirror-state";
import {createConvertListItemsAtIndentCommand} from "~/client/web/content/internal/helpers/create_convert_list_items_at_indent_command.js";
import {createContentBuilder} from "~/shared/content/create_content_builder.js";
import {MessageContentProsemirrorSchema as schema} from "~/shared/content/message_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";

const {
    doc,
    paragraph,
    text,
    quoteBlock,
    table,
    tableRow,
    tableCell,
    unorderedListItem,
    orderedListItem,
} = createContentBuilder(schema);

test("converts top-level list items without converting nested children", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph(text("a"))),
        unorderedListItem(1, paragraph(text("b"))),
        unorderedListItem(0, paragraph(text("c"))),
    );
    const expectedDoc = doc(
        orderedListItem(0, paragraph(text("a"))),
        unorderedListItem(1, paragraph(text("b"))),
        orderedListItem(0, paragraph(text("c"))),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "a");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts only top-level items across double and triple nested bullets", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph(text("a"))),
        unorderedListItem(1, paragraph(text("a.1"))),
        unorderedListItem(2, paragraph(text("a.1.a"))),
        unorderedListItem(3, paragraph(text("a.1.a.i"))),
        unorderedListItem(0, paragraph(text("b"))),
        unorderedListItem(1, paragraph(text("b.1"))),
        unorderedListItem(2, paragraph(text("b.1.a"))),
        unorderedListItem(0, paragraph(text("c"))),
    );
    const expectedDoc = doc(
        orderedListItem(0, paragraph(text("a"))),
        unorderedListItem(1, paragraph(text("a.1"))),
        unorderedListItem(2, paragraph(text("a.1.a"))),
        unorderedListItem(3, paragraph(text("a.1.a.i"))),
        orderedListItem(0, paragraph(text("b"))),
        unorderedListItem(1, paragraph(text("b.1"))),
        unorderedListItem(2, paragraph(text("b.1.a"))),
        orderedListItem(0, paragraph(text("c"))),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "b");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts second-tier items in the middle of first and third tiers", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph(text("a"))),
        unorderedListItem(1, paragraph(text("b"))),
        unorderedListItem(2, paragraph(text("c"))),
        unorderedListItem(1, paragraph(text("d"))),
        unorderedListItem(0, paragraph(text("e"))),
    );
    const expectedDoc = doc(
        unorderedListItem(0, paragraph(text("a"))),
        orderedListItem(1, paragraph(text("b"))),
        unorderedListItem(2, paragraph(text("c"))),
        orderedListItem(1, paragraph(text("d"))),
        unorderedListItem(0, paragraph(text("e"))),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "b");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts third-tier items without converting fourth-tier children", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph(text("a"))),
        unorderedListItem(1, paragraph(text("b"))),
        unorderedListItem(2, paragraph(text("c"))),
        unorderedListItem(3, paragraph(text("d"))),
        unorderedListItem(2, paragraph(text("e"))),
        unorderedListItem(1, paragraph(text("f"))),
    );
    const expectedDoc = doc(
        unorderedListItem(0, paragraph(text("a"))),
        unorderedListItem(1, paragraph(text("b"))),
        orderedListItem(2, paragraph(text("c"))),
        unorderedListItem(3, paragraph(text("d"))),
        orderedListItem(2, paragraph(text("e"))),
        unorderedListItem(1, paragraph(text("f"))),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "c");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts deepest nested items in a triple-nested run", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph(text("a"))),
        unorderedListItem(1, paragraph(text("b"))),
        unorderedListItem(2, paragraph(text("c"))),
        unorderedListItem(3, paragraph(text("d"))),
        unorderedListItem(3, paragraph(text("e"))),
        unorderedListItem(2, paragraph(text("f"))),
        unorderedListItem(1, paragraph(text("g"))),
    );
    const expectedDoc = doc(
        unorderedListItem(0, paragraph(text("a"))),
        unorderedListItem(1, paragraph(text("b"))),
        unorderedListItem(2, paragraph(text("c"))),
        orderedListItem(3, paragraph(text("d"))),
        orderedListItem(3, paragraph(text("e"))),
        unorderedListItem(2, paragraph(text("f"))),
        unorderedListItem(1, paragraph(text("g"))),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "d");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("does not convert same-indent nested list items under a later parent", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph(text("a"))),
        unorderedListItem(1, paragraph(text("b"))),
        unorderedListItem(0, paragraph(text("c"))),
        unorderedListItem(1, paragraph(text("d"))),
    );
    const expectedDoc = doc(
        unorderedListItem(0, paragraph(text("a"))),
        orderedListItem(1, paragraph(text("b"))),
        unorderedListItem(0, paragraph(text("c"))),
        unorderedListItem(1, paragraph(text("d"))),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "b");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("stops conversion at non-list separators", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph(text("a"))),
        paragraph(text("separator")),
        unorderedListItem(0, paragraph(text("b"))),
    );
    const expectedDoc = doc(
        orderedListItem(0, paragraph(text("a"))),
        paragraph(text("separator")),
        unorderedListItem(0, paragraph(text("b"))),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "a");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts list items inside block quotes", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph(text("outside"))),
        quoteBlock(
            paragraph(text("intro")),
            unorderedListItem(0, paragraph(text("a"))),
            unorderedListItem(0, paragraph(text("b"))),
        ),
    );
    const expectedDoc = doc(
        unorderedListItem(0, paragraph(text("outside"))),
        quoteBlock(
            paragraph(text("intro")),
            orderedListItem(0, paragraph(text("a"))),
            orderedListItem(0, paragraph(text("b"))),
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
                    unorderedListItem(0, paragraph(text("a"))),
                    unorderedListItem(0, paragraph(text("b"))),
                ),
                tableCell(unorderedListItem(0, paragraph(text("c")))),
            ),
        ),
    );
    const expectedDoc = doc(
        table(
            {columnWidths: []},
            tableRow(
                tableCell(
                    orderedListItem(0, paragraph(text("a"))),
                    orderedListItem(0, paragraph(text("b"))),
                ),
                tableCell(unorderedListItem(0, paragraph(text("c")))),
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
