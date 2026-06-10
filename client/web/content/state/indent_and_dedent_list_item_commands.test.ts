import {Node} from "prosemirror-model";
import {EditorState, TextSelection} from "prosemirror-state";
import {
    dedentListItemCommand,
    indentListItemCommand,
} from "~/client/web/content/state/indent_and_dedent_list_item_commands.js";
import {MessageContentProsemirrorSchema as schema} from "~/shared/content/message_content_schema.js";

const doc = (...content: Array<Node>) => schema.nodes.doc.create(null, content);
const p = (...content: Array<Node>) => schema.nodes.paragraph.create(null, content);
const text = (string: string) => schema.text(string);
const quoteBlock = (...content: Array<Node>) => schema.nodes.quoteBlock.create(null, content);
const li = (indent: number, ...content: Array<Node>) =>
    schema.nodes.unorderedListItem.create({indent}, content);

test("indents list item in block quote", () => {
    const inputDoc = doc(quoteBlock(p(text("a")), li(0, p(text("b"))), li(0, p(text("c")))));

    const state = EditorState.create({
        doc: inputDoc,
        schema,
        selection: TextSelection.create(inputDoc, 10),
    });

    let newState = state;
    const commandResult = indentListItemCommand(newState, tr => {
        newState = newState.apply(tr);
    });

    expect(commandResult).toBe(true);

    const expectedDoc = doc(quoteBlock(p(text("a")), li(0, p(text("b"))), li(1, p(text("c")))));
    expect(newState.doc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("dedents list item in block quote", () => {
    const inputDoc = doc(quoteBlock(p(text("a")), li(0, p(text("b"))), li(1, p(text("c")))));

    const state = EditorState.create({
        doc: inputDoc,
        schema,
        selection: TextSelection.create(inputDoc, 10),
    });

    let newState = state;
    const commandResult = dedentListItemCommand(newState, tr => {
        newState = newState.apply(tr);
    });

    expect(commandResult).toBe(true);

    const expectedDoc = doc(quoteBlock(p(text("a")), li(0, p(text("b"))), li(0, p(text("c")))));
    expect(newState.doc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("indents list item not in block quote", () => {
    const inputDoc = doc(li(0, p(text("a"))), li(0, p(text("b"))));

    const state = EditorState.create({
        doc: inputDoc,
        schema,
        selection: TextSelection.create(inputDoc, 7),
    });

    let newState = state;
    const commandResult = indentListItemCommand(newState, tr => {
        newState = newState.apply(tr);
    });

    expect(commandResult).toBe(true);

    const expectedDoc = doc(li(0, p(text("a"))), li(1, p(text("b"))));
    expect(newState.doc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("dedents list item not in block quote", () => {
    const inputDoc = doc(li(0, p(text("a"))), li(1, p(text("b"))));

    const state = EditorState.create({
        doc: inputDoc,
        schema,
        selection: TextSelection.create(inputDoc, 7),
    });

    let newState = state;
    const commandResult = dedentListItemCommand(newState, tr => {
        newState = newState.apply(tr);
    });

    expect(commandResult).toBe(true);

    const expectedDoc = doc(li(0, p(text("a"))), li(0, p(text("b"))));
    expect(newState.doc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("fails to indent list item without preceding list item", () => {
    const inputDoc = doc(p(text("a")), li(0, p(text("b"))));

    const state = EditorState.create({
        doc: inputDoc,
        schema,
        selection: TextSelection.create(inputDoc, 6),
    });

    let newState = state;
    const commandResult = indentListItemCommand(newState, tr => {
        newState = newState.apply(tr);
    });

    expect(commandResult).toBe(false);
    expect(newState.doc.toJSON()).toEqual(inputDoc.toJSON());
});

test("fails to dedent list item at indent 0", () => {
    const inputDoc = doc(li(0, p(text("a"))), li(0, p(text("b"))));

    const state = EditorState.create({
        doc: inputDoc,
        schema,
        selection: TextSelection.create(inputDoc, 7),
    });

    let newState = state;
    const commandResult = dedentListItemCommand(newState, tr => {
        newState = newState.apply(tr);
    });

    expect(commandResult).toBe(false);
    expect(newState.doc.toJSON()).toEqual(inputDoc.toJSON());
});

test("fails to indent when selection includes block quote between list items", () => {
    const inputDoc = doc(
        li(0, p(text("item 1"))),
        quoteBlock(p(text("block quote"))),
        li(0, p(text("item 2"))),
        li(0, p(text("item 3"))),
    );

    const state = EditorState.create({
        doc: inputDoc,
        schema,
        selection: TextSelection.create(inputDoc, 12, 40),
    });

    let newState = state;
    const commandResult = indentListItemCommand(newState, tr => {
        newState = newState.apply(tr);
    });

    expect(commandResult).toBe(false);
    expect(newState.doc.toJSON()).toEqual(inputDoc.toJSON());
});

test("fails to dedent when selection includes block quote between list items", () => {
    const inputDoc = doc(
        li(0, p(text("item 0"))),
        li(1, p(text("item 1"))),
        quoteBlock(p(text("block quote"))),
        li(1, p(text("item 2"))),
        li(1, p(text("item 3"))),
    );

    const state = EditorState.create({
        doc: inputDoc,
        schema,
        selection: TextSelection.create(inputDoc, 12, 50),
    });

    let newState = state;
    const commandResult = dedentListItemCommand(newState, tr => {
        newState = newState.apply(tr);
    });

    expect(commandResult).toBe(false);
    expect(newState.doc.toJSON()).toEqual(inputDoc.toJSON());
});

test("fails to indent when selection spans from list item into block quote", () => {
    const inputDoc = doc(
        li(0, p(text("item 1"))),
        li(0, p(text("item 2"))),
        li(0, p(text("item 3"))),
        quoteBlock(p(text("block quote"))),
    );

    const state = EditorState.create({
        doc: inputDoc,
        schema,
        selection: TextSelection.create(inputDoc, 13, 33),
    });

    let newState = state;
    const commandResult = indentListItemCommand(newState, tr => {
        newState = newState.apply(tr);
    });

    expect(commandResult).toBe(false);
    expect(newState.doc.toJSON()).toEqual(inputDoc.toJSON());
});

test("fails to dedent when selection spans from list item into block quote", () => {
    const inputDoc = doc(
        li(0, p(text("item 1"))),
        li(1, p(text("item 2"))),
        li(1, p(text("item 3"))),
        quoteBlock(p(text("block quote"))),
    );

    const state = EditorState.create({
        doc: inputDoc,
        schema,
        selection: TextSelection.create(inputDoc, 13, 33),
    });

    let newState = state;
    const commandResult = dedentListItemCommand(newState, tr => {
        newState = newState.apply(tr);
    });

    expect(commandResult).toBe(false);
    expect(newState.doc.toJSON()).toEqual(inputDoc.toJSON());
});
