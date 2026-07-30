/* eslint-disable jest-dom/prefer-to-have-text-content, testing-library/no-node-access */

import {render, screen} from "@testing-library/react";
import {closeHistory} from "prosemirror-history";
import {EditorState, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {useCallback, useState} from "react";
import {act} from "react-dom/test-utils";
import {ContentEditor, getEditorViewForTest} from "~/client/web/content/content_editor.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {markMemoIfNotRendering} from "~/client/web/helpers/lifecycle/mark_memo_if_not_rendering.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {
    DocumentWithoutTitleContentProsemirrorSchema,
    emptyDocumentWithoutTitleContent,
} from "~/shared/documents/document_content_schema.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";

// eslint-disable-next-line testing-library/render-result-naming-convention
const fileAttachmentTarget = markMemoIfNotRendering({
    type: "Document",
    documentId: generateId(),
} as const satisfies FileAttachmentTarget);

// eslint-disable-next-line testing-library/render-result-naming-convention
const commentFileAttachmentTarget = markMemoIfNotRendering({
    type: "DocumentComments",
    documentId: fileAttachmentTarget.documentId,
} as const satisfies FileAttachmentTarget);

function TestContentEditor() {
    const [state, setState] = useState(() =>
        ContentEditorState.create({
            spaceId: null,
            content: {
                doc: emptyDocumentWithoutTitleContent,
                references: emptyContentReferences,
            },
        }),
    );
    return (
        <ContentEditor
            aria-label="Test"
            state={state}
            onChange={setState}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />
    );
}

// Get the textbox `HTMLElement`.
function getTextbox(): HTMLElement {
    return screen.getByRole("textbox");
}

// Get the ProseMirror `EditorView`.
function getEditor(): EditorView {
    assert(getEditorViewForTest);
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
                spaceId: null,
                content: {
                    doc: emptyDocumentWithoutTitleContent,
                    references: emptyContentReferences,
                },
            })}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(getTextbox().textContent).toEqual("");
});

test("renders an initial editor state", () => {
    const schema = DocumentWithoutTitleContentProsemirrorSchema;

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
            state={ContentEditorState.create({
                spaceId: null,
                content: {doc: content, references: emptyContentReferences},
            })}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(getTextbox().textContent).toEqual("Hello world!");
});

test("rerenders with a changed document", () => {
    const schema = DocumentWithoutTitleContentProsemirrorSchema;

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
            state={ContentEditorState.create({
                spaceId: null,
                content: {doc: doc1, references: emptyContentReferences},
            })}
            onChange={onTransaction}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(getTextbox().textContent).toEqual("Hello");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                spaceId: null,
                content: {doc: doc2, references: emptyContentReferences},
            })}
            onChange={onTransaction}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
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

    assert(getEditorViewForTest);
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

test("won\u2019t ever commit optimistic update if it doesn\u2019t match props", () => {
    function NoopContentEditor() {
        const [state] = useState(() =>
            ContentEditorState.create({
                spaceId: null,
                content: {
                    doc: emptyDocumentWithoutTitleContent,
                    references: emptyContentReferences,
                },
            }),
        );
        return (
            <ContentEditor
                aria-label="Test"
                state={state}
                onChange={useCallback(() => {}, [])}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        );
    }

    render(<NoopContentEditor />);

    assert(getEditorViewForTest);
    const editor = getEditorViewForTest(getTextbox().parentNode);
    const transaction = editor.state.tr;
    transaction.insertText("Hello world!");

    expect(getTextbox().textContent).toEqual("");

    act(() => {
        editor.dispatch(transaction);

        expect(getTextbox().textContent).toEqual("");
    });

    expect(getTextbox().textContent).toEqual("");
});
