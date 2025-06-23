/* eslint-disable string-quotes */

import {act, render, screen} from "@testing-library/react";
import {closeHistory} from "prosemirror-history";
import {Node as ProsemirrorNode} from "prosemirror-model";
import {EditorState, TextSelection, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {MutableRefObject, Ref, forwardRef, useState} from "react";
import {
    ContentEditor,
    ContentEditorRef,
    getEditorViewForTest,
} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/state/content_editor_state.js";
import {markMemoIfNotRendering} from "~/client/helpers/lifecycle/mark_memo_if_not_rendering.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {
    PostContentProsemirrorSchema,
    PostContentWithReferences,
    emptyPostContent,
} from "~/shared/forum/post_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {generateId} from "~/shared/id/id.js";

// ProseMirror calls this function when `state.tr.scrollIntoView()`
// transactions. Instead of logging a warning, do nothing.
window.scrollBy = () => {};

const schema = PostContentProsemirrorSchema;

// eslint-disable-next-line testing-library/render-result-naming-convention
const fileAttachmentTarget = markMemoIfNotRendering(
    cast<FileAttachmentTarget>({type: "Post", postId: generateId()}),
);

type TestContentEditorRef = ContentEditorRef<PostContentWithReferences>;

const TestContentEditor = forwardRef(function TestContentEditor(
    {
        initialContent = emptyPostContent,
    }: {
        initialContent?: ProsemirrorNode;
    },
    ref: Ref<TestContentEditorRef>,
) {
    const [state, setState] = useState(() =>
        ContentEditorState.create({
            doc: initialContent,
            references: emptyContentReferences,
        }),
    );

    return (
        <ContentEditor
            ref={ref}
            aria-label="Test"
            fileAttachmentTarget={fileAttachmentTarget}
            state={state}
            onChange={setState}
        />
    );
});

// Get the textbox `HTMLElement`.
function getTextbox(): HTMLElement {
    return screen.getByRole("textbox");
}

// Get the ProseMirror `EditorView`.
function getEditor(): EditorView {
    assert(getEditorViewForTest);
    return getEditorViewForTest(getTextbox().parentNode);
}

// Get the ProseMirror document `Node`.
function getDoc() {
    return getEditor().state.doc;
}

// Get the ProseMirror selection.
function getSelection() {
    return getEditor().state.selection.toJSON();
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

test("can insert divider at beginning of paragraph", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    act(() => assertExists(editorRef.current).insertDivider());

    expect(getDoc().toString()).toEqual('doc(divider, paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "node", anchor: 0});
});

test("can insert divider at end of paragraph", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(7))));

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 7, head: 7});

    act(() => assertExists(editorRef.current).insertDivider());

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"), divider)');
    expect(getSelection()).toEqual({type: "node", anchor: 8});
});

test("can insert divider in the middle of paragraph", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});

    act(() => assertExists(editorRef.current).insertDivider());

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), divider, paragraph("bar"))');
    expect(getSelection()).toEqual({type: "node", anchor: 5});
});

test("can insert divider in the middle of paragraph with selected text", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(3), state.doc.resolve(5))),
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 3, head: 5});

    act(() => assertExists(editorRef.current).insertDivider());

    expect(getDoc().toString()).toEqual('doc(paragraph("fo"), divider, paragraph("ar"))');
    expect(getSelection()).toEqual({type: "node", anchor: 4});
});

test("can insert divider in an empty paragraph", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, []),
                schema.node("paragraph", {}, [schema.text("bar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), paragraph, paragraph("bar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(6))));

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), paragraph, paragraph("bar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 6, head: 6});

    act(() => assertExists(editorRef.current).insertDivider());

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), divider, paragraph("bar"))');
    expect(getSelection()).toEqual({type: "node", anchor: 5});
});

test("can insert divider at beginning of quote block paragraph", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node(
                    "quoteBlock",
                    {},
                    schema.node("paragraph", {}, [schema.text("foobar")]),
                ),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("foobar")))');
    expect(getSelection()).toEqual({type: "text", anchor: 2, head: 2});

    act(() => assertExists(editorRef.current).insertDivider());

    expect(getDoc().toString()).toEqual('doc(divider, quoteBlock(paragraph("foobar")))');
    expect(getSelection()).toEqual({type: "node", anchor: 0});
});

test("can insert divider at end of quote block", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("quoteBlock", {}, [
                    schema.node("paragraph", {}, [schema.text("foobar")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("foobar")))');
    expect(getSelection()).toEqual({type: "text", anchor: 2, head: 2});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(8))));

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("foobar")))');
    expect(getSelection()).toEqual({type: "text", anchor: 8, head: 8});

    act(() => assertExists(editorRef.current).insertDivider());

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("foobar")), divider)');
    expect(getSelection()).toEqual({type: "node", anchor: 10});
});

test("can insert divider in the middle of quote block", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("quoteBlock", {}, [
                    schema.node("paragraph", {}, [schema.text("foobar")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("foobar")))');
    expect(getSelection()).toEqual({type: "text", anchor: 2, head: 2});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("foobar")))');
    expect(getSelection()).toEqual({type: "text", anchor: 5, head: 5});

    act(() => assertExists(editorRef.current).insertDivider());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo")), divider, quoteBlock(paragraph("bar")))',
    );
    expect(getSelection()).toEqual({type: "node", anchor: 7});
});

test("can insert divider in an empty paragraph in quote block", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("quoteBlock", {}, [
                    schema.node("paragraph", {}, [schema.text("foo")]),
                    schema.node("paragraph", {}, []),
                    schema.node("paragraph", {}, [schema.text("bar")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo"), paragraph, paragraph("bar")))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 2, head: 2});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(7))));

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo"), paragraph, paragraph("bar")))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 7, head: 7});

    act(() => assertExists(editorRef.current).insertDivider());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo")), divider, quoteBlock(paragraph, paragraph("bar")))',
    );
    expect(getSelection()).toEqual({type: "node", anchor: 7});
});

test("can insert unordered list at beginning of paragraph", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    act(() => assertExists(editorRef.current).insertUnorderedListItem());

    expect(getDoc().toString()).toEqual('doc(unorderedListItem(paragraph), paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 2, head: 2});
});

test("can insert unordered list at end of paragraph", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(7))));

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 7, head: 7});

    act(() => assertExists(editorRef.current).insertUnorderedListItem());

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"), unorderedListItem(paragraph))');
    expect(getSelection()).toEqual({type: "text", anchor: 10, head: 10});
});

test("can insert unordered list in the middle of paragraph", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});

    act(() => assertExists(editorRef.current).insertUnorderedListItem());

    expect(getDoc().toString()).toEqual(
        'doc(paragraph("foo"), unorderedListItem(paragraph), paragraph("bar"))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 7, head: 7});
});

test("can insert unordered list in an empty paragraph", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, []),
                schema.node("paragraph", {}, [schema.text("bar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), paragraph, paragraph("bar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(6))));

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), paragraph, paragraph("bar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 6, head: 6});

    act(() => assertExists(editorRef.current).insertUnorderedListItem());

    expect(getDoc().toString()).toEqual(
        'doc(paragraph("foo"), unorderedListItem(paragraph), paragraph("bar"))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 7, head: 7});
});

test("can insert table at beginning of paragraph", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    act(() => assertExists(editorRef.current).insertTable());

    expect(getDoc().toString()).toEqual(
        'doc(table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))), paragraph("foobar"))',
    );
    expect(getSelection()).toEqual({anchor: 4, head: 4, type: "text"});
});

test("can insert table at end of paragraph", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(7))));

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 7, head: 7});

    act(() => assertExists(editorRef.current).insertTable());

    expect(getDoc().toString()).toEqual(
        'doc(paragraph("foobar"), table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))))',
    );
    expect(getSelection()).toEqual({anchor: 12, head: 12, type: "text"});
});

test("can insert table in the middle of paragraph", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});

    act(() => assertExists(editorRef.current).insertTable());

    expect(getDoc().toString()).toEqual(
        'doc(paragraph("foo"), table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))), paragraph("bar"))',
    );
    expect(getSelection()).toEqual({anchor: 9, head: 9, type: "text"});
});

test("can insert table in the middle of paragraph with selected text", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(3), state.doc.resolve(5))),
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 3, head: 5});

    act(() => assertExists(editorRef.current).insertTable());

    expect(getDoc().toString()).toEqual(
        'doc(paragraph("fo"), table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))), paragraph("ar"))',
    );
    expect(getSelection()).toEqual({anchor: 8, head: 8, type: "text"});
});

test("can insert table in an empty paragraph", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, []),
                schema.node("paragraph", {}, [schema.text("bar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), paragraph, paragraph("bar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(6))));

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), paragraph, paragraph("bar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 6, head: 6});

    act(() => assertExists(editorRef.current).insertTable());

    expect(getDoc().toString()).toEqual(
        'doc(paragraph("foo"), table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))), paragraph("bar"))',
    );
    expect(getSelection()).toEqual({anchor: 9, head: 9, type: "text"});
});

test("can insert bullet list inside a table cell", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                    ]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        "doc(table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))))",
    );

    // Position cursor in the first table cell
    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});

    act(() => assertExists(editorRef.current).insertUnorderedListItem());

    expect(getDoc().toString()).toEqual(
        "doc(table(tableRow(tableCell(unorderedListItem(paragraph)), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))))",
    );
    expect(getSelection()).toEqual({type: "text", anchor: 10, head: 10});
});

test("can insert numbered list inside a table cell", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                    ]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        "doc(table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))))",
    );

    // Position cursor in the first table cell
    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});

    act(() => assertExists(editorRef.current).insertOrderedListItem());

    expect(getDoc().toString()).toEqual(
        "doc(table(tableRow(tableCell(orderedListItem(paragraph)), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))))",
    );
    expect(getSelection()).toEqual({type: "text", anchor: 10, head: 10});
});

test("can insert heading inside a table cell", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                    ]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        "doc(table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))))",
    );

    // Position cursor in the first table cell
    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});

    act(() => assertExists(editorRef.current).insertHeading(2));

    expect(getDoc().toString()).toEqual(
        "doc(table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))), heading)",
    );
    expect(getSelection()).toEqual({type: "text", anchor: 23, head: 23});
});

test("can insert table inside a table cell", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                    ]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        "doc(table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))))",
    );

    // Position cursor in the first table cell
    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});

    act(() => assertExists(editorRef.current).insertTable());

    expect(getDoc().toString()).toEqual(
        "doc(table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))), table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))))",
    );
    // Check cursor position is in the first cell of the newly inserted table
    expect(getSelection()).toEqual({type: "text", anchor: 26, head: 26});
});

test("can insert divider inside a table cell", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                    ]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        "doc(table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))))",
    );

    // Position cursor in the first table cell
    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});

    act(() => assertExists(editorRef.current).insertDivider());

    expect(getDoc().toString()).toEqual(
        "doc(table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))), divider)",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 22});
});

test("can insert code block inside a table cell", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                    ]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        "doc(table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))))",
    );

    // Position cursor in the first table cell
    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});

    act(() => assertExists(editorRef.current).insertCodeBlock());

    expect(getDoc().toString()).toEqual(
        "doc(table(tableRow(tableCell(codeBlock(codeBlockLine)), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))))",
    );
    // Check cursor position is inside the code block
    expect(getSelection()).toEqual({type: "text", anchor: 10, head: 10});
});

test("can insert quote block inside a table cell", () => {
    const editorRef: MutableRefObject<TestContentEditorRef | null> = {current: null};

    render(
        <TestContentEditor
            ref={editorRef}
            initialContent={schema.node("doc", {}, [
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                        schema.node("tableCell", {}, [schema.node("paragraph")]),
                    ]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        "doc(table(tableRow(tableCell(paragraph), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))))",
    );

    // Position cursor in the first table cell
    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});

    act(() => assertExists(editorRef.current).insertQuoteBlock());

    expect(getDoc().toString()).toEqual(
        "doc(table(tableRow(tableCell(quoteBlock(paragraph)), tableCell(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph))))",
    );
    // Check cursor position is inside the quote block
    expect(getSelection()).toEqual({type: "text", anchor: 10, head: 10});
});
