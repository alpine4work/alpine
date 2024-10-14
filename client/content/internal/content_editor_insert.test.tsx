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
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {
    PostContentProsemirrorSchema,
    PostContentWithReferences,
    emptyPostContent,
} from "~/shared/forum/post_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

// ProseMirror calls this function when `state.tr.scrollIntoView()`
// transactions. Instead of logging a warning, do nothing.
window.scrollBy = () => {};

const schema = PostContentProsemirrorSchema;

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
            withMobileLayout={false}
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
