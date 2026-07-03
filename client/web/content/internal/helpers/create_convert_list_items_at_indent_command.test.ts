import {Node} from "prosemirror-model";
import {EditorState, TextSelection} from "prosemirror-state";
import {createConvertListItemsAtIndentCommand} from "~/client/web/content/internal/helpers/create_convert_list_items_at_indent_command.js";
import {MessageContentProsemirrorSchema as schema} from "~/shared/content/message_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";

const doc = (...content: Array<Node>) => schema.nodes.doc.create(null, content);
const p = (...content: Array<Node>) => schema.nodes.paragraph.create(null, content);
const text = (string: string) => schema.text(string);
const quoteBlock = (...content: Array<Node>) => schema.nodes.quoteBlock.create(null, content);
const table = (...content: Array<Node>) => schema.nodes.table.create(null, content);
const tableRow = (...content: Array<Node>) => schema.nodes.tableRow.create(null, content);
const tableCell = (...content: Array<Node>) => schema.nodes.tableCell.create(null, content);
const ul = (indent: number, ...content: Array<Node>) =>
    schema.nodes.unorderedListItem.create({indent}, content);

test("converts top-level list items without converting nested children", () => {
    const inputDoc = doc(ul(0, p(text("a"))), ul(1, p(text("b"))), ul(0, p(text("c"))));
    const expectedDoc = doc(
        orderedListItem(0, p(text("a"))),
        ul(1, p(text("b"))),
        orderedListItem(0, p(text("c"))),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "a");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts only top-level items across double and triple nested bullets", () => {
    const inputDoc = doc(
        ul(0, p(text("a"))),
        ul(1, p(text("a.1"))),
        ul(2, p(text("a.1.a"))),
        ul(3, p(text("a.1.a.i"))),
        ul(0, p(text("b"))),
        ul(1, p(text("b.1"))),
        ul(2, p(text("b.1.a"))),
        ul(0, p(text("c"))),
    );
    const expectedDoc = doc(
        orderedListItem(0, p(text("a"))),
        ul(1, p(text("a.1"))),
        ul(2, p(text("a.1.a"))),
        ul(3, p(text("a.1.a.i"))),
        orderedListItem(0, p(text("b"))),
        ul(1, p(text("b.1"))),
        ul(2, p(text("b.1.a"))),
        orderedListItem(0, p(text("c"))),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "b");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts second-tier items in the middle of first and third tiers", () => {
    const inputDoc = doc(
        ul(0, p(text("a"))),
        ul(1, p(text("b"))),
        ul(2, p(text("c"))),
        ul(1, p(text("d"))),
        ul(0, p(text("e"))),
    );
    const expectedDoc = doc(
        ul(0, p(text("a"))),
        orderedListItem(1, p(text("b"))),
        ul(2, p(text("c"))),
        orderedListItem(1, p(text("d"))),
        ul(0, p(text("e"))),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "b");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts third-tier items without converting fourth-tier children", () => {
    const inputDoc = doc(
        ul(0, p(text("a"))),
        ul(1, p(text("b"))),
        ul(2, p(text("c"))),
        ul(3, p(text("d"))),
        ul(2, p(text("e"))),
        ul(1, p(text("f"))),
    );
    const expectedDoc = doc(
        ul(0, p(text("a"))),
        ul(1, p(text("b"))),
        orderedListItem(2, p(text("c"))),
        ul(3, p(text("d"))),
        orderedListItem(2, p(text("e"))),
        ul(1, p(text("f"))),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "c");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts deepest nested items in a triple-nested run", () => {
    const inputDoc = doc(
        ul(0, p(text("a"))),
        ul(1, p(text("b"))),
        ul(2, p(text("c"))),
        ul(3, p(text("d"))),
        ul(3, p(text("e"))),
        ul(2, p(text("f"))),
        ul(1, p(text("g"))),
    );
    const expectedDoc = doc(
        ul(0, p(text("a"))),
        ul(1, p(text("b"))),
        ul(2, p(text("c"))),
        orderedListItem(3, p(text("d"))),
        orderedListItem(3, p(text("e"))),
        ul(2, p(text("f"))),
        ul(1, p(text("g"))),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "d");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("does not convert same-indent nested list items under a later parent", () => {
    const inputDoc = doc(
        ul(0, p(text("a"))),
        ul(1, p(text("b"))),
        ul(0, p(text("c"))),
        ul(1, p(text("d"))),
    );
    const expectedDoc = doc(
        ul(0, p(text("a"))),
        orderedListItem(1, p(text("b"))),
        ul(0, p(text("c"))),
        ul(1, p(text("d"))),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "b");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("stops conversion at non-list separators", () => {
    const inputDoc = doc(ul(0, p(text("a"))), p(text("separator")), ul(0, p(text("b"))));
    const expectedDoc = doc(
        orderedListItem(0, p(text("a"))),
        p(text("separator")),
        ul(0, p(text("b"))),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "a");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts list items inside block quotes", () => {
    const inputDoc = doc(
        ul(0, p(text("outside"))),
        quoteBlock(p(text("intro")), ul(0, p(text("a"))), ul(0, p(text("b")))),
    );
    const expectedDoc = doc(
        ul(0, p(text("outside"))),
        quoteBlock(
            p(text("intro")),
            orderedListItem(0, p(text("a"))),
            orderedListItem(0, p(text("b"))),
        ),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "b");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("converts list items inside the selected table cell", () => {
    const inputDoc = doc(
        table(
            tableRow(
                tableCell(ul(0, p(text("a"))), ul(0, p(text("b")))),
                tableCell(ul(0, p(text("c")))),
            ),
        ),
    );
    const expectedDoc = doc(
        table(
            tableRow(
                tableCell(orderedListItem(0, p(text("a"))), orderedListItem(0, p(text("b")))),
                tableCell(ul(0, p(text("c")))),
            ),
        ),
    );

    const outputDoc = runConvertToOrderedList(inputDoc, "a");

    expect(outputDoc.toJSON()).toEqual(expectedDoc.toJSON());
});

function orderedListItem(indent: number, ...content: Array<Node>) {
    return schema.nodes.orderedListItem.create({indent}, content);
}

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
