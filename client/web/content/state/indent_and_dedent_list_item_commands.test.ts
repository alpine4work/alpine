import {EditorState, TextSelection} from "prosemirror-state";
import {
    dedentListItemCommand,
    indentListItemCommand,
} from "~/client/web/content/state/indent_and_dedent_list_item_commands.js";
import {createContentBuilder} from "~/shared/content/create_content_builder.js";
import {MessageContentProsemirrorSchema as schema} from "~/shared/content/message_content_schema.js";

const {doc, paragraph, quoteBlock, unorderedListItem} = createContentBuilder(schema);

test("indents list item in block quote", () => {
    const inputDoc = doc(
        quoteBlock(
            paragraph("a"),
            unorderedListItem(0, paragraph("b")),
            unorderedListItem(0, paragraph("c")),
        ),
    );

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

    const expectedDoc = doc(
        quoteBlock(
            paragraph("a"),
            unorderedListItem(0, paragraph("b")),
            unorderedListItem(1, paragraph("c")),
        ),
    );
    expect(newState.doc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("dedents list item in block quote", () => {
    const inputDoc = doc(
        quoteBlock(
            paragraph("a"),
            unorderedListItem(0, paragraph("b")),
            unorderedListItem(1, paragraph("c")),
        ),
    );

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

    const expectedDoc = doc(
        quoteBlock(
            paragraph("a"),
            unorderedListItem(0, paragraph("b")),
            unorderedListItem(0, paragraph("c")),
        ),
    );
    expect(newState.doc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("indents list item not in block quote", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph("a")),
        unorderedListItem(0, paragraph("b")),
    );

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

    const expectedDoc = doc(
        unorderedListItem(0, paragraph("a")),
        unorderedListItem(1, paragraph("b")),
    );
    expect(newState.doc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("dedents list item not in block quote", () => {
    const inputDoc = doc(
        unorderedListItem(0, paragraph("a")),
        unorderedListItem(1, paragraph("b")),
    );

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

    const expectedDoc = doc(
        unorderedListItem(0, paragraph("a")),
        unorderedListItem(0, paragraph("b")),
    );
    expect(newState.doc.toJSON()).toEqual(expectedDoc.toJSON());
});

test("fails to indent list item without preceding list item", () => {
    const inputDoc = doc(paragraph("a"), unorderedListItem(0, paragraph("b")));

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
    const inputDoc = doc(
        unorderedListItem(0, paragraph("a")),
        unorderedListItem(0, paragraph("b")),
    );

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
        unorderedListItem(0, paragraph("item 1")),
        quoteBlock(paragraph("block quote")),
        unorderedListItem(0, paragraph("item 2")),
        unorderedListItem(0, paragraph("item 3")),
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
        unorderedListItem(0, paragraph("item 0")),
        unorderedListItem(1, paragraph("item 1")),
        quoteBlock(paragraph("block quote")),
        unorderedListItem(1, paragraph("item 2")),
        unorderedListItem(1, paragraph("item 3")),
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
        unorderedListItem(0, paragraph("item 1")),
        unorderedListItem(0, paragraph("item 2")),
        unorderedListItem(0, paragraph("item 3")),
        quoteBlock(paragraph("block quote")),
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
        unorderedListItem(0, paragraph("item 1")),
        unorderedListItem(1, paragraph("item 2")),
        unorderedListItem(1, paragraph("item 3")),
        quoteBlock(paragraph("block quote")),
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
