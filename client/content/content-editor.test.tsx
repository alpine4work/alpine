/* eslint-disable jest-dom/prefer-to-have-text-content, testing-library/no-node-access */

import {render, screen} from "@testing-library/react";
import {closeHistory} from "prosemirror-history";
import {EditorState, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import React, {useCallback, useState} from "react";
import {act} from "react-dom/test-utils";
import {
    ContentEditor,
    ContentEditorState,
    getEditorViewForTest,
} from "~/client/content/content-editor";
import {
    DocumentWithoutTitleContentSchema,
    emptyDocumentWithoutTitleContent,
} from "~/shared/content/document-content-schema";

function TestContentEditor() {
    const [state, setState] = useState(() =>
        ContentEditorState.create({
            schema: DocumentWithoutTitleContentSchema,
            content: emptyDocumentWithoutTitleContent,
        }),
    );
    return <ContentEditor aria-label="Test" state={state} onChange={setState} />;
}

// Get the textbox `HTMLElement`.
function getTextbox(): HTMLElement {
    return screen.getByRole("textbox");
}

// Get the ProseMirror `EditorView`.
function getEditor(): EditorView {
    return getEditorViewForTest(getTextbox().parentNode);
}

// Dispatch a ProseMirror transaction. Use this to simulate a code powered
// transformation of the document.
function dispatch(buildTransaction: (state: EditorState) => Transaction) {
    const editor = getEditor();
    const transaction = buildTransaction(editor.state);

    // Each of these test transactions should be a single history stack item.
    closeHistory(transaction);

    act(() => {
        editor.dispatch(transaction);
    });
}

test("renders an empty document", () => {
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                schema: DocumentWithoutTitleContentSchema,
                content: emptyDocumentWithoutTitleContent,
            })}
            onChange={() => {}}
        />,
    );

    expect(getTextbox().textContent).toEqual("");
});

test("renders an initial editor state", () => {
    const schema = DocumentWithoutTitleContentSchema;

    const content = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.text("Hello "),
            schema.text("world", [schema.mark("bold")]),
            schema.text("!"),
        ]),
    ]);

    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({schema, content})}
            onChange={() => {}}
        />,
    );

    expect(getTextbox().textContent).toEqual("Hello world!");
});

test("rerenders with a changed document", () => {
    const schema = DocumentWithoutTitleContentSchema;

    const doc1 = schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("Hello")])]);
    const doc2 = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.text("Hello "),
            schema.text("world", [schema.mark("bold")]),
            schema.text("!"),
        ]),
    ]);

    const onTransaction = () => {};

    const {rerender} = render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({schema, content: doc1})}
            onChange={onTransaction}
        />,
    );

    expect(getTextbox().textContent).toEqual("Hello");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({schema, content: doc2})}
            onChange={onTransaction}
        />,
    );

    expect(getTextbox().textContent).toEqual("Hello world!");
});

test("can change content", () => {
    render(<TestContentEditor />);

    dispatch(state => state.tr.insertText("Hello"));

    expect(getTextbox().textContent).toEqual("Hello");

    dispatch(state => state.tr.insertText(" world!"));

    expect(getTextbox().textContent).toEqual("Hello world!");
});

test("will optimistically update the DOM synchronously", () => {
    render(<TestContentEditor />);

    const editor = getEditorViewForTest(getTextbox().parentNode);
    const transaction = editor.state.tr;
    transaction.insertText("Hello world!");

    expect(getTextbox().textContent).toEqual("");

    act(() => {
        editor.dispatch(transaction);

        expect(getTextbox().textContent).toEqual("Hello world!");
    });

    expect(getTextbox().textContent).toEqual("Hello world!");
});

test("will revert optimistic update if it doesn't match props", () => {
    function NoopContentEditor() {
        const [state] = useState(() =>
            ContentEditorState.create({
                schema: DocumentWithoutTitleContentSchema,
                content: emptyDocumentWithoutTitleContent,
            }),
        );
        return (
            <ContentEditor aria-label="Test" state={state} onChange={useCallback(() => {}, [])} />
        );
    }

    render(<NoopContentEditor />);

    const editor = getEditorViewForTest(getTextbox().parentNode);
    const transaction = editor.state.tr;
    transaction.insertText("Hello world!");

    expect(getTextbox().textContent).toEqual("");

    act(() => {
        editor.dispatch(transaction);

        expect(getTextbox().textContent).toEqual("Hello world!");
    });

    expect(getTextbox().textContent).toEqual("");
});
