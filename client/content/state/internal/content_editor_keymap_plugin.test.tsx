/* eslint-disable jest-dom/prefer-to-have-text-content, testing-library/no-node-access */

import {fireEvent, render, screen} from "@testing-library/react";
import {closeHistory} from "prosemirror-history";
import {Node as ProsemirrorNode} from "prosemirror-model";
import {EditorState, NodeSelection, TextSelection, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {useState} from "react";
import {act} from "react-dom/test-utils";
import {ContentEditor, getEditorViewForTest} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/state/content_editor_state.js";
import {markMemoIfNotRendering} from "~/client/helpers/lifecycle/mark_memo_if_not_rendering.js";
import {TestSpaceContextProvider} from "~/client/spaces/space_context_provider.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {
    DocumentContentProsemirrorSchema,
    DocumentWithoutTitleContentProsemirrorSchema,
    emptyDocumentWithoutTitleContent,
} from "~/shared/documents/document_content_schema.js";
import {InternalError} from "~/shared/error/error.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

// ProseMirror calls this function when `state.tr.scrollIntoView()`
// transactions. Instead of logging a warning, do nothing.
window.scrollBy = () => {};

const schema = DocumentWithoutTitleContentProsemirrorSchema;

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

const createdTime = new Date();

const space = new SpaceModel({
    id: generateId(),
    name: "Test Space",
});

const currentAccount = new AccountModel({
    id: generateId(),
    version: 0,
    name: "Test Account",
    nameVersion: 0,
    space: {
        version: 0,
        joinedTime: createdTime,
        wasRemoved: false,
    },
});

function TestContentEditor({
    initialContent = emptyDocumentWithoutTitleContent,
}: {
    initialContent?: ProsemirrorNode;
}) {
    const [state, setState] = useState(() =>
        ContentEditorState.create({
            doc: initialContent,
            references: emptyContentReferences,
        }),
    );

    return (
        <TestSpaceContextProvider space={space} currentAccount={currentAccount}>
            <ContentEditor
                aria-label="Test"
                state={state}
                onChange={setState}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestSpaceContextProvider>
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

// Creates a string representing the keyboard event for test output
function charKeyboardEventToString(event: Parameters<typeof charKeyboardEvent>[0]) {
    return [event.metaKey ? "Cmd" : null, event.shiftKey ? "Shift" : null, event.key.toUpperCase()]
        .filter(Boolean)
        .join("+");
}

// Creates a mock character `KeyboardEvent`.
// https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent
function charKeyboardEvent({
    key,
    metaKey = false,
    shiftKey = false,
    withCharCode = false,
}: {
    key: string;
    metaKey?: boolean;
    shiftKey?: boolean;
    withCharCode?: boolean;
}) {
    assert(key.length === 1 && key === key.toLowerCase());

    let code: string;
    let keyCode: number;
    if (/^[a-z]$/.test(key)) {
        code = `Key${key.toUpperCase()}`;
        keyCode = key.charCodeAt(0) - 32;
    } else if (key === "(") {
        code = "Digit9";
        keyCode = 57;
        shiftKey = true;
    } else if (key === ")") {
        code = "Digit0";
        keyCode = 48;
        shiftKey = true;
    } else if (key === "[") {
        code = "BracketLeft";
        keyCode = 219;
        shiftKey = false;
    } else if (key === "]") {
        code = "BracketRight";
        keyCode = 221;
        shiftKey = false;
    } else if (key === "{") {
        code = "BracketLeft";
        keyCode = 219;
        shiftKey = true;
    } else if (key === "}") {
        code = "BracketRight";
        keyCode = 221;
        shiftKey = true;
    } else if (key === "'") {
        code = "Quote";
        keyCode = 222;
        shiftKey = false;
    } else if (key === '"') {
        code = "Quote";
        keyCode = 222;
        shiftKey = true;
    } else if (key === "*") {
        code = "Digit8";
        keyCode = 56;
        shiftKey = true;
    } else if (key === "_") {
        code = "Minus";
        keyCode = 189;
        shiftKey = true;
    } else if (key === "~") {
        code = "Backquote";
        keyCode = 192;
        shiftKey = true;
    } else if (key === "`") {
        code = "Backquote";
        keyCode = 192;
        shiftKey = false;
    } else {
        throw new InternalError(quote`Unsupported key ${key}`);
    }

    const actualKey = shiftKey ? key.toUpperCase() : key;

    return {
        code,
        key: actualKey,
        keyCode,
        metaKey,
        shiftKey,
        charCode: withCharCode ? actualKey.charCodeAt(0) : 0,
    };
}

function enterKeyboardEvent({
    metaKey = false,
    shiftKey = false,
    altKey = false,
}: {
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
} = {}) {
    return {
        code: "Enter",
        key: "Enter",
        keyCode: 13,
        metaKey,
        shiftKey,
        altKey,
    };
}

function backspaceKeyboardEvent({
    metaKey = false,
    shiftKey = false,
}: {
    metaKey?: boolean;
    shiftKey?: boolean;
} = {}) {
    return {
        code: "Backspace",
        key: "Backspace",
        keyCode: 8,
        metaKey,
        shiftKey,
    };
}

function deleteKeyboardEvent({
    metaKey = false,
    shiftKey = false,
}: {
    metaKey?: boolean;
    shiftKey?: boolean;
} = {}) {
    return {
        code: "Delete",
        key: "Delete",
        keyCode: 46,
        metaKey,
        shiftKey,
    };
}

function tabKeyboardEvent({
    metaKey = false,
    shiftKey = false,
}: {
    metaKey?: boolean;
    shiftKey?: boolean;
} = {}) {
    return {
        code: "Tab",
        key: "Tab",
        keyCode: 9,
        metaKey,
        shiftKey,
    };
}

function arrowLeftKeyboardEvent({
    metaKey = false,
    shiftKey = false,
}: {
    metaKey?: boolean;
    shiftKey?: boolean;
} = {}) {
    return {
        code: "ArrowLeft",
        key: "ArrowLeft",
        keyCode: 37,
        metaKey,
        shiftKey,
    };
}

function arrowUpKeyboardEvent({
    metaKey = false,
    shiftKey = false,
}: {
    metaKey?: boolean;
    shiftKey?: boolean;
} = {}) {
    return {
        code: "ArrowUp",
        key: "ArrowUp",
        keyCode: 38,
        metaKey,
        shiftKey,
    };
}

function arrowRightKeyboardEvent({
    metaKey = false,
    shiftKey = false,
}: {
    metaKey?: boolean;
    shiftKey?: boolean;
} = {}) {
    return {
        code: "ArrowRight",
        key: "ArrowRight",
        keyCode: 39,
        metaKey,
        shiftKey,
    };
}

function arrowDownKeyboardEvent({
    metaKey = false,
    shiftKey = false,
}: {
    metaKey?: boolean;
    shiftKey?: boolean;
} = {}) {
    return {
        code: "ArrowDown",
        key: "ArrowDown",
        keyCode: 40,
        metaKey,
        shiftKey,
    };
}

function endKeyboardEvent({
    metaKey = false,
    shiftKey = false,
}: {
    metaKey?: boolean;
    shiftKey?: boolean;
} = {}) {
    return {
        code: "End",
        key: "End",
        keyCode: 35,
        metaKey,
        shiftKey,
    };
}

function homeKeyboardEvent({
    metaKey = false,
    shiftKey = false,
}: {
    metaKey?: boolean;
    shiftKey?: boolean;
} = {}) {
    return {
        code: "Home",
        key: "Home",
        keyCode: 36,
        metaKey,
        shiftKey,
    };
}

function pastePlainTextClipboardEvent(pasteText: string) {
    return {
        clipboardData: {
            getData: (type: string) => {
                return type === "text/plain" ? pasteText : null;
            },
        },
    };
}

// Simulate a user typing at the end of a content editable. Unlike `dispatch()`
// this tries really hard to look like a user actually making changes.
async function simulateTyping(
    text: string,
    {
        withinElement = getTextbox(),
        fromStart = false,
        eachChar = true,
    }: {
        withinElement?: Node;
        fromStart?: boolean;
        eachChar?: boolean;
    } = {},
) {
    // Type each character individually like in a real browser.
    if (eachChar && !fromStart && text.length > 1) {
        for (const char of text.split("")) {
            await simulateTyping(char, {withinElement, fromStart});
        }
        return;
    }

    const lastEditableChild = fromStart
        ? findFirstEditableChild(withinElement)
        : findLastEditableChild(withinElement);
    assert(lastEditableChild?.parentNode);

    if (lastEditableChild.nodeType === Node.TEXT_NODE) {
        if (fromStart) {
            lastEditableChild.textContent = text + (lastEditableChild.textContent ?? "");
        } else {
            lastEditableChild.textContent += text;
        }
    } else {
        lastEditableChild.parentNode.replaceChild(document.createTextNode(text), lastEditableChild);
    }

    // Wait for the mutation observer microtask
    // https://dom.spec.whatwg.org/#queue-a-mutation-observer-compound-microtask
    //
    // The `await Promise.resolve()` fixes a bug in the interaction of React and
    // Zone.js
    await Promise.resolve(act(() => Promise.resolve()));
}

function findFirstEditableChild(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE || node.nodeName === "BR") {
        return node;
    }
    if (!node.firstChild) {
        return null;
    }
    return findLastEditableChild(node.firstChild);
}

function findLastEditableChild(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE || node.nodeName === "BR") {
        return node;
    }
    if (!node.lastChild) {
        return null;
    }
    return findLastEditableChild(node.lastChild);
}

test("will undo on Cmd+Z", () => {
    render(<TestContentEditor />);

    const textbox = getTextbox();

    dispatch(state => state.tr.insertText("Hello world!"));

    expect(textbox.textContent).toEqual("Hello world!");

    fireEvent.keyDown(textbox, charKeyboardEvent({key: "z", metaKey: true}));

    expect(textbox.textContent).toEqual("");
});

test("will undo individual changes on Cmd+Z", () => {
    render(<TestContentEditor />);

    const textbox = getTextbox();

    dispatch(state => state.tr.insertText("Hello"));
    dispatch(state => state.tr.insertText(" world!"));

    expect(textbox.textContent).toEqual("Hello world!");

    fireEvent.keyDown(textbox, charKeyboardEvent({key: "z", metaKey: true}));

    expect(textbox.textContent).toEqual("Hello");

    fireEvent.keyDown(textbox, charKeyboardEvent({key: "z", metaKey: true}));

    expect(textbox.textContent).toEqual("");
});

test("will redo on Cmd+Shift+Z", () => {
    render(<TestContentEditor />);

    const textbox = getTextbox();

    dispatch(state => state.tr.insertText("Hello world!"));

    expect(textbox.textContent).toEqual("Hello world!");

    fireEvent.keyDown(textbox, charKeyboardEvent({key: "z", metaKey: true}));

    expect(textbox.textContent).toEqual("");

    fireEvent.keyDown(textbox, charKeyboardEvent({key: "z", metaKey: true, shiftKey: true}));

    expect(textbox.textContent).toEqual("Hello world!");
});

test("will redo individual changes on Cmd+Shift+Z", () => {
    render(<TestContentEditor />);

    const textbox = getTextbox();

    dispatch(state => state.tr.insertText("Hello"));
    dispatch(state => state.tr.insertText(" world!"));

    expect(textbox.textContent).toEqual("Hello world!");

    fireEvent.keyDown(textbox, charKeyboardEvent({key: "z", metaKey: true}));

    expect(textbox.textContent).toEqual("Hello");

    fireEvent.keyDown(textbox, charKeyboardEvent({key: "z", metaKey: true}));

    expect(textbox.textContent).toEqual("");

    fireEvent.keyDown(textbox, charKeyboardEvent({key: "z", metaKey: true, shiftKey: true}));

    expect(textbox.textContent).toEqual("Hello");

    fireEvent.keyDown(textbox, charKeyboardEvent({key: "z", metaKey: true, shiftKey: true}));

    expect(textbox.textContent).toEqual("Hello world!");
});

test("will redo on Cmd+Y", () => {
    render(<TestContentEditor />);

    const textbox = getTextbox();

    dispatch(state => state.tr.insertText("Hello world!"));

    expect(textbox.textContent).toEqual("Hello world!");

    fireEvent.keyDown(textbox, charKeyboardEvent({key: "z", metaKey: true}));

    expect(textbox.textContent).toEqual("");

    fireEvent.keyDown(textbox, charKeyboardEvent({key: "y", metaKey: true}));

    expect(textbox.textContent).toEqual("Hello world!");
});

test("will redo individual changes on Cmd+Y", () => {
    render(<TestContentEditor />);

    const textbox = getTextbox();

    dispatch(state => state.tr.insertText("Hello"));
    dispatch(state => state.tr.insertText(" world!"));

    expect(textbox.textContent).toEqual("Hello world!");

    fireEvent.keyDown(textbox, charKeyboardEvent({key: "z", metaKey: true}));

    expect(textbox.textContent).toEqual("Hello");

    fireEvent.keyDown(textbox, charKeyboardEvent({key: "z", metaKey: true}));

    expect(textbox.textContent).toEqual("");

    fireEvent.keyDown(textbox, charKeyboardEvent({key: "y", metaKey: true}));

    expect(textbox.textContent).toEqual("Hello");

    fireEvent.keyDown(textbox, charKeyboardEvent({key: "y", metaKey: true}));

    expect(textbox.textContent).toEqual("Hello world!");
});

const formattingShortcutsTestCases = [
    {name: "bold", tag: "strong", event: {key: "b", metaKey: true}},
    {name: "italic", tag: "em", event: {key: "i", metaKey: true}},
    {name: "strike", tag: "del", event: {key: "x", metaKey: true, shiftKey: true}},
    {name: "code", tag: "code", event: {key: "e", metaKey: true, shiftKey: true}},
];
for (const {name, tag, event} of formattingShortcutsTestCases) {
    test(`will toggle ${name} for selection on ${charKeyboardEventToString(event)}`, () => {
        render(<TestContentEditor />);

        const textbox = getTextbox();

        dispatch(state => state.tr.insertText("foo bar qux"));

        dispatch(state =>
            state.tr.setSelection(new TextSelection(state.doc.resolve(7), state.doc.resolve(12))),
        );

        expect(textbox.querySelector(tag)).not.toBeInTheDocument();

        fireEvent.keyDown(textbox, charKeyboardEvent(event));

        expect(textbox.querySelector(tag)).toBeInTheDocument();

        fireEvent.keyDown(textbox, charKeyboardEvent(event));

        expect(textbox.querySelector(tag)).not.toBeInTheDocument();
    });

    test(`will toggle ${name} for selection that contains ${name} on ${charKeyboardEventToString(
        event,
    )}`, async () => {
        render(<TestContentEditor />);

        await simulateTyping("foo bar qux");

        dispatch(state =>
            state.tr.setSelection(new TextSelection(state.doc.resolve(5), state.doc.resolve(8))),
        );

        fireEvent.keyDown(getTextbox(), charKeyboardEvent(event));

        expect(getDoc().toString()).toEqual(`doc(paragraph("foo ", ${name}("bar"), " qux"))`);

        dispatch(state =>
            state.tr.setSelection(new TextSelection(state.doc.resolve(3), state.doc.resolve(11))),
        );

        fireEvent.keyDown(getTextbox(), charKeyboardEvent(event));

        expect(getDoc().toString()).toEqual(`doc(paragraph("fo", ${name}("o bar qu"), "x"))`);

        fireEvent.keyDown(getTextbox(), charKeyboardEvent(event));

        expect(getDoc().toString()).toEqual('doc(paragraph("foo bar qux"))');
    });

    test(`will toggle ${name} for cursor on ${charKeyboardEventToString(event)}`, async () => {
        render(<TestContentEditor />);

        await simulateTyping("foo ");

        fireEvent.keyDown(getTextbox(), charKeyboardEvent(event));

        expect(getDoc().toString()).toEqual('doc(paragraph("foo "))');

        await simulateTyping("ba");

        expect(getDoc().toString()).toEqual(`doc(paragraph("foo ", ${name}("ba")))`);

        fireEvent.keyDown(getTextbox(), charKeyboardEvent(event));

        await simulateTyping("rr");

        expect(getDoc().toString()).toEqual(`doc(paragraph("foo ", ${name}("ba"), "rr"))`);
    });
}

const selectedFormattingShortcutsTestCases = [
    {name: "bold", tag: "strong", event: {key: "*"}},
    {name: "italic", tag: "em", event: {key: "_"}},
    {name: "strike", tag: "del", event: {key: "~"}},
    {name: "code", tag: "code", event: {key: "`"}},
];
for (const {name, tag, event} of selectedFormattingShortcutsTestCases) {
    test(`will toggle ${name} for selection on ${charKeyboardEventToString(event)}`, () => {
        render(<TestContentEditor />);

        const textbox = getTextbox();

        dispatch(state => state.tr.insertText("foo bar qux"));

        dispatch(state =>
            state.tr.setSelection(new TextSelection(state.doc.resolve(7), state.doc.resolve(12))),
        );

        expect(textbox.querySelector(tag)).not.toBeInTheDocument();

        fireEvent.keyDown(textbox, charKeyboardEvent(event));

        expect(textbox.querySelector(tag)).toBeInTheDocument();

        fireEvent.keyDown(textbox, charKeyboardEvent(event));

        expect(textbox.querySelector(tag)).not.toBeInTheDocument();
    });
}

test("will create a heading with `#`", async () => {
    render(<TestContentEditor />);
    expect(getDoc().toString()).toEqual("doc(paragraph)");

    await simulateTyping("# ");

    expect(getDoc().toString()).toEqual("doc(heading)");
    expect(getDoc().child(0).attrs.level).toEqual(1);
});

test("will not create a heading without a space", async () => {
    render(<TestContentEditor />);
    expect(getDoc().toString()).toEqual("doc(paragraph)");

    await simulateTyping("#");

    expect(getDoc().toString()).toEqual('doc(paragraph("#"))');

    await simulateTyping(" ");

    expect(getDoc().toString()).toEqual("doc(heading)");
    expect(getDoc().child(0).attrs.level).toEqual(1);
});

test("will create a heading with `##`", async () => {
    render(<TestContentEditor />);
    expect(getDoc().toString()).toEqual("doc(paragraph)");

    await simulateTyping("## ");

    expect(getDoc().toString()).toEqual("doc(heading)");
    expect(getDoc().child(0).attrs.level).toEqual(2);
});

test("will create a heading with `###`", async () => {
    render(<TestContentEditor />);
    expect(getDoc().toString()).toEqual("doc(paragraph)");

    await simulateTyping("### ");

    expect(getDoc().toString()).toEqual("doc(heading)");
    expect(getDoc().child(0).attrs.level).toEqual(3);
});

test("will create a quote block with `>`", async () => {
    render(<TestContentEditor />);
    expect(getDoc().toString()).toEqual("doc(paragraph)");

    await simulateTyping("> ");

    expect(getDoc().toString()).toEqual("doc(quoteBlock(paragraph))");
});

test("will create a bullet list item with `-`", async () => {
    render(<TestContentEditor />);
    expect(getDoc().toString()).toEqual("doc(paragraph)");

    await simulateTyping("- ");

    expect(getDoc().toString()).toEqual("doc(unorderedListItem(paragraph))");
});

test("will create a bullet list item with `*`", async () => {
    render(<TestContentEditor />);
    expect(getDoc().toString()).toEqual("doc(paragraph)");

    await simulateTyping("* ");

    expect(getDoc().toString()).toEqual("doc(unorderedListItem(paragraph))");
});

test("will create a ordered list item with `1.`", async () => {
    render(<TestContentEditor />);
    expect(getDoc().toString()).toEqual("doc(paragraph)");

    await simulateTyping("1. ");

    expect(getDoc().toString()).toEqual("doc(orderedListItem(paragraph))");
});

test("will create a check list item with `[]`", async () => {
    render(<TestContentEditor />);
    expect(getDoc().toString()).toEqual("doc(paragraph)");

    await simulateTyping("[] ");

    expect(getDoc().toString()).toEqual("doc(checkListItem(paragraph))");
    expect(getDoc().child(0).attrs.checked).toEqual(false);
});

test("will create a code block with ```", async () => {
    render(<TestContentEditor />);
    expect(getDoc().toString()).toEqual("doc(paragraph)");

    await simulateTyping("```");

    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine))");
});

test("will create a divider with `---`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("---");

    expect(getDoc().toString()).toEqual("doc(divider, paragraph)");
});

test("will not create a divider in an unsupported location", async () => {
    render(<TestContentEditor />);

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    await simulateTyping("- ");

    await simulateTyping("---");

    expect(getDoc().toString()).toEqual('doc(unorderedListItem(paragraph("—-")))');
});

test("pressing enter will create a new paragraph", () => {
    render(<TestContentEditor />);

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(paragraph, paragraph)");
});

test("pressing enter multiple times will create multiple paragraphs", () => {
    render(<TestContentEditor />);

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(paragraph, paragraph, paragraph)");

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(paragraph, paragraph, paragraph, paragraph)");
});

test("pressing enter after text will create a new paragraph", () => {
    render(<TestContentEditor />);

    dispatch(state => state.tr.insertText("hello"));

    expect(getDoc().toString()).toEqual('doc(paragraph("hello"))');

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("hello"), paragraph)');

    dispatch(state => state.tr.insertText("world"));

    expect(getDoc().toString()).toEqual('doc(paragraph("hello"), paragraph("world"))');
});

test("pressing enter in an empty quote will convert to a paragraph", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> ");

    expect(getDoc().toString()).toEqual("doc(quoteBlock(paragraph))");

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(paragraph)");
});

test("pressing enter in a quote will create a new wrapped paragraph", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> ");
    await simulateTyping("hello");

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("hello")))');

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("hello"), paragraph))');

    await simulateTyping("world");

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("hello"), paragraph("world"), paragraph))',
    );
});

test("pressing enter in a quote's empty paragraph at the end of a quote will exit the quote", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> ");
    await simulateTyping("hello");

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("hello")))');

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("hello"), paragraph))');

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("hello")), paragraph)');
});

test("pressing enter in a quote's empty paragraph at the beginning of a quote will exit the quote", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> ");
    expect(getSelection()).toEqual({type: "text", anchor: 2, head: 2});
    await simulateTyping("hello");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("world");
    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(2), state.doc.resolve(7))),
    );
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph, paragraph("world")))');
    expect(getSelection()).toEqual({type: "text", anchor: 2, head: 2});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(paragraph, quoteBlock(paragraph("world")))');
});

test("pressing enter in a quote's empty paragraph in the middle of a quote will exit the quote", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> ");
    await simulateTyping("hello");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getSelection()).toEqual({type: "text", anchor: 9, head: 9});
    await simulateTyping("good");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("world");
    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(9), state.doc.resolve(13))),
    );
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("hello"), paragraph, paragraph("world")))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 9, head: 9});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("hello")), paragraph, quoteBlock(paragraph("world")))',
    );
});

test("pressing enter in an empty bullet list item will exit the item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    expect(getDoc().toString()).toEqual("doc(unorderedListItem(paragraph))");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(paragraph)");
});

test("pressing enter in an empty ordered list item will exit the item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("1. ");
    expect(getDoc().toString()).toEqual("doc(orderedListItem(paragraph))");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(paragraph)");
});

test("pressing enter in an empty check list item will exit the item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("[] ");
    expect(getDoc().toString()).toEqual("doc(checkListItem(paragraph))");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(paragraph)");
});

test("pressing enter in an empty list item nested in a quote will exit out", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> ");
    await simulateTyping("- ");

    expect(getDoc().toString()).toEqual("doc(quoteBlock(unorderedListItem(paragraph)))");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(quoteBlock(paragraph))");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(paragraph)");
});

test("pressing enter after an empty heading will remove the style", async () => {
    render(<TestContentEditor />);

    await simulateTyping("# ");
    expect(getDoc().toString()).toEqual("doc(heading)");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(paragraph)");
});

test("pressing backspace after an empty heading will remove the style", async () => {
    render(<TestContentEditor />);

    await simulateTyping("# ");
    expect(getDoc().toString()).toEqual("doc(heading)");
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(paragraph)");
});

test("pressing backspace at the beginning of a heading will remove the style", async () => {
    render(<TestContentEditor />);

    await simulateTyping("# test");
    expect(getDoc().toString()).toEqual('doc(heading("test"))');
    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(1))));
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(paragraph("test"))');
});

test("pressing backspace at the beginning of a heading that is not the first element will remove the style", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("# bar");
    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), heading("bar"))');
    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(6))));
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), paragraph("bar"))');
});

test("pressing enter after a heading will create a paragraph", async () => {
    render(<TestContentEditor />);

    await simulateTyping("# ");
    await simulateTyping("test");
    expect(getDoc().toString()).toEqual('doc(heading("test"))');
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(heading("test"), paragraph)');
});

test("pressing enter in the end of a bullet list item will create a new one", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test");

    expect(getDoc().toString()).toEqual('doc(unorderedListItem(paragraph("test")))');

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test")), unorderedListItem(paragraph))',
    );
});

test("pressing enter in the end of an ordered list item will create a new one", async () => {
    render(<TestContentEditor />);

    await simulateTyping("1. ");
    await simulateTyping("test");

    expect(getDoc().toString()).toEqual('doc(orderedListItem(paragraph("test")))');

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(orderedListItem(paragraph("test")), orderedListItem(paragraph))',
    );
});

test("pressing enter in the end of a check list item will create a new one", async () => {
    render(<TestContentEditor />);

    await simulateTyping("[] ");
    await simulateTyping("test");

    expect(getDoc().toString()).toEqual('doc(checkListItem(paragraph("test")))');

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(checkListItem(paragraph("test")), checkListItem(paragraph))',
    );
});

test("pressing enter in the middle of a paragraph will split it", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foobar");

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), paragraph("bar"))');
});

test("pressing enter in the middle of a heading will split it", async () => {
    render(<TestContentEditor />);

    await simulateTyping("# ");
    await simulateTyping("foobar");

    expect(getDoc().toString()).toEqual('doc(heading("foobar"))');

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(heading("foo"), heading("bar"))');
});

test("pressing enter in the middle of a quote will split it", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> ");
    await simulateTyping("foobar");

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("foobar")))');

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("foo"), paragraph("bar")))');
});

test("pressing enter in the middle of a bullet list item will split into two list items", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("foobar");

    expect(getDoc().toString()).toEqual('doc(unorderedListItem(paragraph("foobar")))');

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), unorderedListItem(paragraph("bar")))',
    );
});

test("pressing enter in the middle of an ordered list item will split into two list items", async () => {
    render(<TestContentEditor />);

    await simulateTyping("1. ");
    await simulateTyping("foobar");

    expect(getDoc().toString()).toEqual('doc(orderedListItem(paragraph("foobar")))');

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(orderedListItem(paragraph("foo")), orderedListItem(paragraph("bar")))',
    );
});

test("pressing enter in the middle of a check list item will split into two list items", async () => {
    render(<TestContentEditor />);

    await simulateTyping("[] ");
    await simulateTyping("foobar");

    expect(getDoc().toString()).toEqual('doc(checkListItem(paragraph("foobar")))');

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(checkListItem(paragraph("foo")), checkListItem(paragraph("bar")))',
    );
});

test("pressing enter in an empty code block will create a new line in the block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine))");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine, codeBlockLine))");

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(state.selection.from - 2))),
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual(
        "doc(codeBlock(codeBlockLine, codeBlockLine, codeBlockLine))",
    );
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual(
        "doc(codeBlock(codeBlockLine, codeBlockLine, codeBlockLine, codeBlockLine))",
    );
});

test("pressing enter in an empty code block will always create a new line", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine))");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine, codeBlockLine))");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual(
        "doc(codeBlock(codeBlockLine, codeBlockLine, codeBlockLine))",
    );
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual(
        "doc(codeBlock(codeBlockLine, codeBlockLine, codeBlockLine, codeBlockLine))",
    );
});

test("pressing down in a code block will create a new paragraph", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine))");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine, codeBlockLine))");
    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine, codeBlockLine), paragraph)");
});

test("pressing alt-enter in an empty code block will create a new line in the block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine))");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine, codeBlockLine))");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));
    expect(getDoc().toString()).toEqual(
        "doc(codeBlock(codeBlockLine, codeBlockLine, codeBlockLine))",
    );
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));
    expect(getDoc().toString()).toEqual(
        "doc(codeBlock(codeBlockLine, codeBlockLine, codeBlockLine, codeBlockLine))",
    );
});

test("pressing enter in a non-empty code block will create a new line in the block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");
    await simulateTyping("hello");
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("hello")))');
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("hello"), codeBlockLine))');
    await simulateTyping("world");
    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("hello"), codeBlockLine("world")))',
    );
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("hello"), codeBlockLine("world"), codeBlockLine))',
    );
});

test("pressing enter in the middle of a code block will add a line", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");
    await simulateTyping("foobar");

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("foobar")))');

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("fo"), codeBlockLine("obar")))',
    );
});

test("cannot create a heading in a quote block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> ");
    await simulateTyping("# ");

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("# ")))');
});

test("cannot create a quote block in a quote block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> ");
    await simulateTyping("> ");

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("> ")))');
});

test("cannot create a code block in a quote block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> ");
    await simulateTyping("```");

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("```")))');
});

test("can create a bullet list in a quote block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> ");
    await simulateTyping("- ");

    expect(getDoc().toString()).toEqual("doc(quoteBlock(unorderedListItem(paragraph)))");
});

test("can create an ordered list in a quote block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> ");
    await simulateTyping("1. ");

    expect(getDoc().toString()).toEqual("doc(quoteBlock(orderedListItem(paragraph)))");
});

test("can not create a check list in a quote block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> ");
    await simulateTyping("[] ");

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("[] ")))');
});

test("cannot create a divider in a quote block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> ");
    await simulateTyping("---");

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("—-")))');
});

test("enter deletes a selection", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foobar");

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(2), state.doc.resolve(5))),
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("f"), paragraph("ar"))');
});

test("deletes a selection", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foobar");

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(2), state.doc.resolve(5))),
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("far"))');
});

test("deletes a selection across nodes", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("bar");

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), paragraph("bar"))');

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(2), state.doc.resolve(7))),
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("far"))');
});

test("deletes a selection across styled nodes", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("> ");
    await simulateTyping("bar");

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), quoteBlock(paragraph("bar")))');

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(2), state.doc.resolve(8))),
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("far"))');
});

test("divider shortcut in an empty paragraph replaces the paragraph", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("bar");

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), paragraph, paragraph("bar"))');

    await simulateTyping("---", {
        withinElement: getTextbox().childNodes[1],
    });

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), divider, paragraph("bar"))');
});

test("list item shortcut from the beginning works", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test");

    expect(getDoc().toString()).toEqual('doc(paragraph("test"))');

    await simulateTyping("- ", {fromStart: true});

    expect(getDoc().toString()).toEqual('doc(unorderedListItem(paragraph("test")))');
});

test("delete at the beginning of a paragraph joins with the last block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("bar");

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), paragraph("bar"))');

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(6))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
});

test("delete at the beginning of a list item removes the list item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("bar");

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), unorderedListItem(paragraph("bar")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(2))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(paragraph("foo"), unorderedListItem(paragraph("bar")))',
    );
});

test("delete at the beginning of a list item after another list item merges the list items", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("bar");

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), unorderedListItem(paragraph("bar")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(9))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo"), paragraph("bar")))',
    );
});

test("delete at the beginning of a list item after a paragraph converts to a paragraph", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("- bar");

    expect(getDoc().toString()).toEqual(
        'doc(paragraph("foo"), unorderedListItem(paragraph("bar")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(7))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), paragraph("bar"))');
});

test("delete at the beginning of a paragraph after a list item combines the two", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("bar");

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), paragraph("bar"))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(8))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(unorderedListItem(paragraph("foobar")))');
});

test("pressing backspace in a multi-paragraph list item lifts the paragraph out of the list item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("bar");

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), unorderedListItem(paragraph("bar")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(9))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo"), paragraph("bar")))',
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), paragraph("bar"))',
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(unorderedListItem(paragraph("foobar")))');
});

test("delete at the beginning of a floating list item paragraph inside a larger list unwraps the paragraph", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("bar");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("qux");

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), unorderedListItem(paragraph("bar")), unorderedListItem(paragraph("qux")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(9))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo"), paragraph("bar")), unorderedListItem(paragraph("qux")))',
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), paragraph("bar"), unorderedListItem(paragraph("qux")))',
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foobar")), unorderedListItem(paragraph("qux")))',
    );
});

test("tab creates a level of indentation", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test 1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test 2", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(indent: 1, paragraph("test 2")))',
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test 3", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(indent: 1, paragraph("test 2")), unorderedListItem(indent: 1, paragraph("test 3")))',
    );
});

test("tab at the start of a code block line with content adds indentation", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");
    await simulateTyping("test 1");

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(2))));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  test 1")))');

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("    test 1")))');
});

test("tab in the middle of a code block line with content adds indentation to the start", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");
    await simulateTyping("foobar");

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  foobar")))');

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(10))));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("    foobar")))');
});

test("tab twice at the start of line without content adds indentation", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  ")))');

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("    ")))');
});

test("tab indents the selected lines, but not on empty lines", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");
    await simulateTyping("test 1");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));
    await simulateTyping("test 2");

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("test 1"), codeBlockLine, codeBlockLine("test 2")))',
    );

    const startPos = 2;
    const endPos = startPos + "test 1\n\ntest2".length;
    dispatch(state => state.tr.setSelection(TextSelection.create(state.doc, startPos, endPos)));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  test 1"), codeBlockLine, codeBlockLine("  test 2")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("    test 1"), codeBlockLine, codeBlockLine("    test 2")))',
    );
});

test("shift-tab removes a level of indentation from first sub-item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test 1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test 2", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test 3", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(indent: 1, paragraph("test 2")), unorderedListItem(indent: 1, paragraph("test 3")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(12))));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(paragraph("test 2")), unorderedListItem(indent: 1, paragraph("test 3")))',
    );
});

test("shift-tab removes a level of indentation from other sub-item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test 1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test 2", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test 3", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(indent: 1, paragraph("test 2")), unorderedListItem(indent: 1, paragraph("test 3")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(22))));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(indent: 1, paragraph("test 2")), unorderedListItem(paragraph("test 3")))',
    );
});

test("shift-tab does not remove the first item from a list", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test 1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test 2", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(paragraph("test 2")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(2))));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(paragraph("test 2")))',
    );
});

test("shift-tab removes another item from a list", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test 1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test 2", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(paragraph("test 2")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(12))));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(paragraph("test 2")))',
    );
});

test("shift-tab de-dents lines in code block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test 1");

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  test 1")))');

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("test 1")))');

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("    test 1")))');

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("test 1")))');
});

test("shift-tab de-dents odd number spaces in code block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");
    await simulateTyping(" test 1");

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine(" test 1")))');

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("test 1")))');

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(2))));
    dispatch(state => state.tr.insertText("   "));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("   test 1")))');

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine(" test 1")))');

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("test 1")))');
});

test("shift-tab de-dents multiple lines inside a code block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test 1");

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test 2");

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  test 1"), codeBlockLine, codeBlockLine("      test 2")))',
    );

    const startPos = 2;
    const endPos = startPos + "  test 1\n\n    test2".length;
    dispatch(state => state.tr.setSelection(TextSelection.create(state.doc, startPos, endPos)));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));
    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("test 1"), codeBlockLine, codeBlockLine("    test 2")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));
    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("test 1"), codeBlockLine, codeBlockLine("  test 2")))',
    );
});

test("delete at the beginning of the first nested list item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test 1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test 2", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test 3", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(indent: 1, paragraph("test 2")), unorderedListItem(indent: 1, paragraph("test 3")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(12))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1"), paragraph("test 2")), unorderedListItem(indent: 1, paragraph("test 3")))',
    );
});

test("delete at the beginning of the second nested list item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test 1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test 2", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test 3", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(indent: 1, paragraph("test 2")), unorderedListItem(indent: 1, paragraph("test 3")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(22))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(indent: 1, paragraph("test 2"), paragraph("test 3")))',
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(indent: 1, paragraph("test 2")), paragraph("test 3"))',
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(indent: 1, paragraph("test 2test 3")))',
    );
});

test("delete at the beginning of the second nested list item in a quote block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> ");
    await simulateTyping("- ");
    await simulateTyping("test 1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test 2", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test 3", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(unorderedListItem(paragraph("test 1")), unorderedListItem(paragraph("test 2")), unorderedListItem(paragraph("test 3"))))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(23))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(unorderedListItem(paragraph("test 1")), unorderedListItem(paragraph("test 2"), paragraph("test 3"))))',
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(unorderedListItem(paragraph("test 1")), unorderedListItem(paragraph("test 2")), paragraph("test 3")))',
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(unorderedListItem(paragraph("test 1")), unorderedListItem(paragraph("test 2"))), paragraph("test 3"))',
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(unorderedListItem(paragraph("test 1")), unorderedListItem(paragraph("test 2test 3"))))',
    );
});

test("enter in an empty nested list item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test 1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test 2", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(indent: 1, paragraph("test 2")), unorderedListItem(indent: 1, paragraph))',
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(indent: 1, paragraph("test 2")), paragraph)',
    );
});

test("enter in an empty nested list item of different type", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test 1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("1. ");
    await simulateTyping("test 2", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), orderedListItem(paragraph("test 2")), orderedListItem(paragraph))',
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), orderedListItem(paragraph("test 2")), paragraph)',
    );
});

test("enter in an empty nested list item with a following list item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test 1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test 2", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test 3", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test 4", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(indent: 1, paragraph("test 2")), unorderedListItem(indent: 1, paragraph("test 3")), unorderedListItem(indent: 1, paragraph("test 4")))',
    );

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(22), state.doc.resolve(28))),
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(indent: 1, paragraph("test 2")), unorderedListItem(indent: 1, paragraph), unorderedListItem(indent: 1, paragraph("test 4")))',
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test 1")), unorderedListItem(indent: 1, paragraph("test 2")), paragraph, unorderedListItem(indent: 1, paragraph("test 4")))',
    );
});

test("enter with selection in a list item should create a new list item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- foobar");

    expect(getDoc().toString()).toEqual('doc(unorderedListItem(paragraph("foobar")))');

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(4), state.doc.resolve(6))),
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("fo")), unorderedListItem(paragraph("ar")))',
    );
});

test("enter with selection that starts outside a list item should not create a list item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("- bar");

    expect(getDoc().toString()).toEqual(
        'doc(paragraph("foo"), unorderedListItem(paragraph("bar")))',
    );

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(3), state.doc.resolve(8))),
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("fo"), paragraph("ar"))');
});

test("enter with selection that starts outside a list item should not create a list item (doesn't depend on anchor)", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("- bar");

    expect(getDoc().toString()).toEqual(
        'doc(paragraph("foo"), unorderedListItem(paragraph("bar")))',
    );

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(8), state.doc.resolve(3))),
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("fo"), paragraph("ar"))');
});

test("enter with selection that starts inside a list item should create a list item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("bar");

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), paragraph("bar"))',
    );

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(4), state.doc.resolve(9))),
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("fo")), unorderedListItem(paragraph("ar")))',
    );
});

test("enter with selection that starts inside a list item should create a list item (doesn't depend on anchor)", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("bar");

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), paragraph("bar"))',
    );

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(9), state.doc.resolve(4))),
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("fo")), unorderedListItem(paragraph("ar")))',
    );
});

test("delete when preceding list item is empty will merge into the item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("bar");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("qux");

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), unorderedListItem(paragraph("bar")), paragraph("qux"))',
    );

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(9), state.doc.resolve(12))),
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), unorderedListItem(paragraph), paragraph("qux"))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(12))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), unorderedListItem(paragraph("qux")))',
    );
});

test("delete when preceding nested list item is empty will merge into the item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("bar");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("qux");

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), unorderedListItem(indent: 1, paragraph("bar")), paragraph("qux"))',
    );

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(9), state.doc.resolve(12))),
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), unorderedListItem(indent: 1, paragraph), paragraph("qux"))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(12))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("foo")), unorderedListItem(indent: 1, paragraph("qux")))',
    );
});

test("delete when preceding block quote is empty will merge into the item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("bar");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("qux");

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo"), paragraph("bar")), paragraph("qux"))',
    );

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(7), state.doc.resolve(10))),
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo"), paragraph), paragraph("qux"))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(10))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("foo"), paragraph("qux")))');
});

test("delete when preceding list item in quote block is empty will merge into the item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> - foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("bar");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("qux");

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(unorderedListItem(paragraph("foo")), unorderedListItem(paragraph("bar"))), paragraph("qux"))',
    );

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(10), state.doc.resolve(13))),
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(unorderedListItem(paragraph("foo")), unorderedListItem(paragraph)), paragraph("qux"))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(14))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(unorderedListItem(paragraph("foo")), unorderedListItem(paragraph("qux"))))',
    );
});

test("tab will indent many items at once", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test2", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test3", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(paragraph("test2")), unorderedListItem(paragraph("test3")))',
    );

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(14), state.doc.resolve(23))),
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), unorderedListItem(indent: 1, paragraph("test3")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), unorderedListItem(indent: 1, paragraph("test3")))',
    );
});

test("shift-tab will dedent many items at once", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test2", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test3", {eachChar: false});

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(14), state.doc.resolve(23))),
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), unorderedListItem(indent: 1, paragraph("test3")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(paragraph("test2")), unorderedListItem(paragraph("test3")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(paragraph("test2")), unorderedListItem(paragraph("test3")))',
    );
});

test("will not indent if non-list item is selected", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test2", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test3", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(paragraph("test2")), paragraph("test3"))',
    );

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(14), state.doc.resolve(22))),
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(paragraph("test2")), paragraph("test3"))',
    );
});

test("will not dedent if non-list item is selected", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test2", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test3", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), paragraph("test3"))',
    );

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(14), state.doc.resolve(22))),
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), paragraph("test3"))',
    );
});

test("will not indent the first list item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test2", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(paragraph("test2")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(2))));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(paragraph("test2")))',
    );
});

test("will not indent a list item twice", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test2", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(paragraph("test2")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(11))));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")))',
    );
});

test("will indent up until one after the highest level", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test2", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test3", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test4", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));
    await simulateTyping("test5", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), unorderedListItem(indent: 2, paragraph("test3")), unorderedListItem(indent: 3, paragraph("test4")), unorderedListItem(paragraph("test5")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(38))));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), unorderedListItem(indent: 2, paragraph("test3")), unorderedListItem(indent: 3, paragraph("test4")), unorderedListItem(indent: 1, paragraph("test5")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), unorderedListItem(indent: 2, paragraph("test3")), unorderedListItem(indent: 3, paragraph("test4")), unorderedListItem(indent: 2, paragraph("test5")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), unorderedListItem(indent: 2, paragraph("test3")), unorderedListItem(indent: 3, paragraph("test4")), unorderedListItem(indent: 3, paragraph("test5")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), unorderedListItem(indent: 2, paragraph("test3")), unorderedListItem(indent: 3, paragraph("test4")), unorderedListItem(indent: 4, paragraph("test5")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), unorderedListItem(indent: 2, paragraph("test3")), unorderedListItem(indent: 3, paragraph("test4")), unorderedListItem(indent: 4, paragraph("test5")))',
    );
});

test("will not dedent if it would detach subsequent item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test2", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test3", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test4", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), unorderedListItem(indent: 2, paragraph("test3")), unorderedListItem(indent: 3, paragraph("test4")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(20))));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), unorderedListItem(indent: 2, paragraph("test3")), unorderedListItem(indent: 3, paragraph("test4")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(29))));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), unorderedListItem(indent: 2, paragraph("test3")), unorderedListItem(indent: 2, paragraph("test4")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(20))));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), unorderedListItem(indent: 1, paragraph("test3")), unorderedListItem(indent: 2, paragraph("test4")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(20))));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")), unorderedListItem(indent: 1, paragraph("test3")), unorderedListItem(indent: 2, paragraph("test4")))',
    );
});

test("will not dedent the last list item in a document", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");
    await simulateTyping("test1", {eachChar: false});
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test2", {eachChar: false});

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(11))));

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent({shiftKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(paragraph("test2")))',
    );
});

test("will change list item type with `-`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("1. ");

    expect(getDoc().toString()).toEqual("doc(orderedListItem(paragraph))");

    await simulateTyping("- ");

    expect(getDoc().toString()).toEqual("doc(unorderedListItem(paragraph))");
});

test("will change list item type with `*`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("1. ");

    expect(getDoc().toString()).toEqual("doc(orderedListItem(paragraph))");

    await simulateTyping("* ");

    expect(getDoc().toString()).toEqual("doc(unorderedListItem(paragraph))");
});

test("will change list item type with `1.`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");

    expect(getDoc().toString()).toEqual("doc(unorderedListItem(paragraph))");

    await simulateTyping("1. ");

    expect(getDoc().toString()).toEqual("doc(orderedListItem(paragraph))");
});

test("will change list item type with `[]`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");

    expect(getDoc().toString()).toEqual("doc(unorderedListItem(paragraph))");

    await simulateTyping("[] ");

    expect(getDoc().toString()).toEqual("doc(checkListItem(paragraph))");
});

test("will change list item type with `[ ]`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- ");

    expect(getDoc().toString()).toEqual("doc(unorderedListItem(paragraph))");

    await simulateTyping("[ ] ");

    expect(getDoc().toString()).toEqual("doc(checkListItem(paragraph))");
});

test("will change list item type in nested item with `-`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("1. test");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(orderedListItem(paragraph("test")), orderedListItem(indent: 1, paragraph))',
    );

    await simulateTyping("- ");

    expect(getDoc().toString()).toEqual(
        'doc(orderedListItem(paragraph("test")), unorderedListItem(indent: 1, paragraph))',
    );
});

test("will change list item type in nested item with `*`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("1. test");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(orderedListItem(paragraph("test")), orderedListItem(indent: 1, paragraph))',
    );

    await simulateTyping("* ");

    expect(getDoc().toString()).toEqual(
        'doc(orderedListItem(paragraph("test")), unorderedListItem(indent: 1, paragraph))',
    );
});

test("will change list item type in nested item with `1.`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- test");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test")), unorderedListItem(indent: 1, paragraph))',
    );

    await simulateTyping("1. ");

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test")), orderedListItem(indent: 1, paragraph))',
    );
});

test("will change list item type in nested item with `[]`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- test");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test")), unorderedListItem(indent: 1, paragraph))',
    );

    await simulateTyping("[] ");

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test")), checkListItem(indent: 1, paragraph))',
    );
});

test("will change list item type in nested item with `[ ]`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- test");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test")), unorderedListItem(indent: 1, paragraph))',
    );

    await simulateTyping("[ ] ");

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test")), checkListItem(indent: 1, paragraph))',
    );
});

test("will use smart double quotes", async () => {
    render(<TestContentEditor />);

    await simulateTyping('"test"');

    expect(getDoc().toString()).toEqual('doc(paragraph("“test”"))');
});

test("will use smart single quotes", async () => {
    render(<TestContentEditor />);

    await simulateTyping("'test'");

    expect(getDoc().toString()).toEqual('doc(paragraph("‘test’"))');
});

test("will not use smart double quotes in code block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");

    await simulateTyping(`"test"`);

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("\\"test\\"")))');
});

test("will not use smart single quotes in code block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");

    await simulateTyping("'test'");

    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine(\"'test'\")))");
});

test("`--` becomes an em dash", async () => {
    render(<TestContentEditor />);

    await simulateTyping("--");

    expect(getDoc().toString()).toEqual('doc(paragraph("—"))');
});

test("`...` becomes an ellipsis", async () => {
    render(<TestContentEditor />);

    await simulateTyping("...");

    expect(getDoc().toString()).toEqual('doc(paragraph("…"))');
});

test("`->` becomes a rightwards arrow", async () => {
    render(<TestContentEditor />);

    await simulateTyping("->");

    expect(getDoc().toString()).toEqual('doc(paragraph("→"))');
});

test("`<-` becomes a leftwards arrow", async () => {
    render(<TestContentEditor />);

    await simulateTyping("<-");

    expect(getDoc().toString()).toEqual('doc(paragraph("←"))');
});

test("`^2` becomes a superscript two", async () => {
    render(<TestContentEditor />);

    await simulateTyping("^2");

    expect(getDoc().toString()).toEqual('doc(paragraph("²"))');
});

test("`^3` becomes a superscript three", async () => {
    render(<TestContentEditor />);

    await simulateTyping("^3");

    expect(getDoc().toString()).toEqual('doc(paragraph("³"))');
});

test("`^tm` becomes a trademark", async () => {
    render(<TestContentEditor />);

    await simulateTyping("^tm");

    expect(getDoc().toString()).toEqual('doc(paragraph("™"))');
});

test("`^TM` becomes a trademark", async () => {
    render(<TestContentEditor />);

    await simulateTyping("^TM");

    expect(getDoc().toString()).toEqual('doc(paragraph("™"))');
});

test("`:)` becomes 🙂 at the beginning of a line", async () => {
    render(<TestContentEditor />);

    await simulateTyping(":)");

    expect(getDoc().toString()).toEqual('doc(paragraph("🙂"))');
});

test("`:)` becomes 🙂 after a space", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test :)");

    expect(getDoc().toString()).toEqual('doc(paragraph("test 🙂"))');
});

test("`:)` becomes 🙂 but not after text", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test:)");

    expect(getDoc().toString()).toEqual('doc(paragraph("test:)"))');
});

test("`:(` becomes 😕 at the beginning of a line", async () => {
    render(<TestContentEditor />);

    await simulateTyping(":(");

    expect(getDoc().toString()).toEqual('doc(paragraph("😕"))');
});

test("`:(` becomes 😕 after a space", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test :(");

    expect(getDoc().toString()).toEqual('doc(paragraph("test 😕"))');
});

test("`:(` becomes 😕 but not after text", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test:(");

    expect(getDoc().toString()).toEqual('doc(paragraph("test:("))');
});

test("`;)` becomes 😉 at the beginning of a line", async () => {
    render(<TestContentEditor />);

    await simulateTyping(";)");

    expect(getDoc().toString()).toEqual('doc(paragraph("😉"))');
});

test("`;)` becomes 😉 after a space", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test ;)");

    expect(getDoc().toString()).toEqual('doc(paragraph("test 😉"))');
});

test("`;)` becomes 😉 but not after text", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test;)");

    expect(getDoc().toString()).toEqual('doc(paragraph("test;)"))');
});

test("`:D` becomes 😀 at the beginning of a line", async () => {
    render(<TestContentEditor />);

    await simulateTyping(":D");

    expect(getDoc().toString()).toEqual('doc(paragraph("😀"))');
});

test("`:D` becomes 😀 after a space", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test :D");

    expect(getDoc().toString()).toEqual('doc(paragraph("test 😀"))');
});

test("`:D` becomes 😀 but not after text", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test:D");

    expect(getDoc().toString()).toEqual('doc(paragraph("test:D"))');
});

test("`:P` becomes 😛 at the beginning of a line", async () => {
    render(<TestContentEditor />);

    await simulateTyping(":P");

    expect(getDoc().toString()).toEqual('doc(paragraph("😛"))');
});

test("`:P` becomes 😛 after a space", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test :P");

    expect(getDoc().toString()).toEqual('doc(paragraph("test 😛"))');
});

test("`:P` becomes 😛 but not after text", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test:P");

    expect(getDoc().toString()).toEqual('doc(paragraph("test:P"))');
});

test("`:O` becomes 😮 at the beginning of a line", async () => {
    render(<TestContentEditor />);

    await simulateTyping(":O");

    expect(getDoc().toString()).toEqual('doc(paragraph("😮"))');
});

test("`:O` becomes 😮 after a space", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test :O");

    expect(getDoc().toString()).toEqual('doc(paragraph("test 😮"))');
});

test("`:O` becomes 😮 but not after text", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test:O");

    expect(getDoc().toString()).toEqual('doc(paragraph("test:O"))');
});

test("`<3` becomes \u{2764}\u{FE0F} at the beginning of a line", async () => {
    render(<TestContentEditor />);

    await simulateTyping("<3");

    expect(getDoc().toString()).toEqual('doc(paragraph("\u{2764}\u{FE0F}"))');
});

test("`<3` becomes \u{2764}\u{FE0F} after a space", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test <3");

    expect(getDoc().toString()).toEqual('doc(paragraph("test \u{2764}\u{FE0F}"))');
});

test("`<3` becomes \u{2764}\u{FE0F} but not after text", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test<3");

    expect(getDoc().toString()).toEqual('doc(paragraph("test<3"))');
});

test("`++` becomes 👍 at the beginning of a line", async () => {
    render(<TestContentEditor />);

    await simulateTyping("++");

    expect(getDoc().toString()).toEqual('doc(paragraph("👍"))');
});

test("`++` becomes 👍 after a space", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test ++");

    expect(getDoc().toString()).toEqual('doc(paragraph("test 👍"))');
});

test("`++` becomes 👍 but not after text", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test++");

    expect(getDoc().toString()).toEqual('doc(paragraph("test++"))');
});

test("`:joy:` becomes 😂 at the beginning of a line", async () => {
    render(<TestContentEditor />);

    await simulateTyping(":joy:");

    expect(getDoc().toString()).toEqual('doc(paragraph("😂"))');
});

test("`:joy:` becomes 😂 after a space", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test :joy:");

    expect(getDoc().toString()).toEqual('doc(paragraph("test 😂"))');
});

test("`:joy:` becomes 😂 but not after text", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test:joy:");

    expect(getDoc().toString()).toEqual('doc(paragraph("test:joy:"))');
});

test("input rule will not apply a second time if deleted then retyped", async () => {
    render(<TestContentEditor />);

    await simulateTyping("++");

    expect(getDoc().toString()).toEqual('doc(paragraph("👍"))');

    dispatch(state => state.tr.delete(state.selection.from - 2, state.selection.from));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    await simulateTyping("++");

    expect(getDoc().toString()).toEqual('doc(paragraph("++"))');
});

test("input rule retype detection is cancelled if another character is typed", async () => {
    render(<TestContentEditor />);

    await simulateTyping("++");

    expect(getDoc().toString()).toEqual('doc(paragraph("👍"))');

    await simulateTyping(" x");

    expect(getDoc().toString()).toEqual('doc(paragraph("👍 x"))');

    dispatch(state => state.tr.delete(state.selection.from - 2, state.selection.from));

    expect(getDoc().toString()).toEqual('doc(paragraph("👍"))');

    dispatch(state => state.tr.delete(state.selection.from - 2, state.selection.from));

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    await simulateTyping("++");

    expect(getDoc().toString()).toEqual('doc(paragraph("👍"))');
});

test("will paste normal text", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo");

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"))');

    fireEvent.paste(getTextbox(), pastePlainTextClipboardEvent("bar"));

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
});

test("will paste a link text", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test ");

    expect(getDoc().toString()).toEqual('doc(paragraph("test "))');

    fireEvent.paste(getTextbox(), pastePlainTextClipboardEvent("https://example.com"));

    expect(getDoc().toString()).toEqual('doc(paragraph("test ", link("https://example.com")))');
});

test("when pasting a text when there's a selection we will linkify the selection", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test");

    expect(getDoc().toString()).toEqual('doc(paragraph("test"))');

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(1), state.doc.resolve(5))),
    );

    fireEvent.paste(getTextbox(), pastePlainTextClipboardEvent("https://example.com"));

    expect(getDoc().toString()).toEqual('doc(paragraph(link("test")))');
    expect(screen.getByRole<HTMLAnchorElement>("link").href).toEqual("https://example.com/");
});

test("delete will join with the next block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("bar");

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), paragraph("bar"))');

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
});

test("undo input rule when pressing cmd-z", async () => {
    render(<TestContentEditor />);

    await simulateTyping("->");

    expect(getDoc().toString()).toEqual('doc(paragraph("→"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "z", metaKey: true}));

    expect(getDoc().toString()).toEqual('doc(paragraph("->"))');
});

test("Cmd-] and Cmd-[ indent/dedent", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- test1");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    await simulateTyping("test2");

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(paragraph("test2")))',
    );

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "]", metaKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(indent: 1, paragraph("test2")))',
    );

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "[", metaKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test1")), unorderedListItem(paragraph("test2")))',
    );
});

test("italicizes text with `_` at the beginning of a block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("_test_");

    expect(getDoc().toString()).toEqual('doc(paragraph(italic("test")))');
});

test("italicizes text with `_` later in the a block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("hello _world_");

    expect(getDoc().toString()).toEqual('doc(paragraph("hello ", italic("world")))');
});

test("italicizes text with `_` when there are spaces in between", async () => {
    render(<TestContentEditor />);

    await simulateTyping("_hello world_");

    expect(getDoc().toString()).toEqual('doc(paragraph(italic("hello world")))');
});

test("does not italicize with `_` if a non-space comes before it", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo_bar_");

    expect(getDoc().toString()).toEqual('doc(paragraph("foo_bar_"))');
});

test("does not italicize with `_` if a space comes after the first bracket", async () => {
    render(<TestContentEditor />);

    await simulateTyping("_ test_");

    expect(getDoc().toString()).toEqual('doc(paragraph("_ test_"))');
});

test("does not italicize with `_` if a space comes before the last bracket", async () => {
    render(<TestContentEditor />);

    await simulateTyping("_test _");

    expect(getDoc().toString()).toEqual('doc(paragraph("_test _"))');
});

test("italicizes a single character with `_`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("_x_");

    expect(getDoc().toString()).toEqual('doc(paragraph(italic("x")))');
});

test("italicizes two characters with `_`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("_xy_");

    expect(getDoc().toString()).toEqual('doc(paragraph(italic("xy")))');
});

test("characters typed after italics with `_` are not italicized", async () => {
    render(<TestContentEditor />);

    await simulateTyping("_hello_ world");

    expect(getDoc().toString()).toEqual('doc(paragraph(italic("hello"), " world"))');
});

test("bolds text with `*` at the beginning of a block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("*test*");

    expect(getDoc().toString()).toEqual('doc(paragraph(bold("test")))');
});

test("bolds text with `*` later in the a block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("hello *world*");

    expect(getDoc().toString()).toEqual('doc(paragraph("hello ", bold("world")))');
});

test("bolds text with `*` when there are spaces in between", async () => {
    render(<TestContentEditor />);

    await simulateTyping("*hello world*");

    expect(getDoc().toString()).toEqual('doc(paragraph(bold("hello world")))');
});

test("does not bold with `*` if a non-space comes before it", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo*bar*");

    expect(getDoc().toString()).toEqual('doc(paragraph("foo*bar*"))');
});

test("does not bold with `*` if a space comes after the first bracket", async () => {
    render(<TestContentEditor />);

    await simulateTyping("test * test*");

    expect(getDoc().toString()).toEqual('doc(paragraph("test * test*"))');
});

test("does not bold with `*` if a space comes before the last bracket", async () => {
    render(<TestContentEditor />);

    await simulateTyping("*test *");

    expect(getDoc().toString()).toEqual('doc(paragraph("*test *"))');
});

test("bolds a single character with `*`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("*x*");

    expect(getDoc().toString()).toEqual('doc(paragraph(bold("x")))');
});

test("bolds two characters with `*`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("*xy*");

    expect(getDoc().toString()).toEqual('doc(paragraph(bold("xy")))');
});

test("characters typed after bolded text with `*` are not bolded", async () => {
    render(<TestContentEditor />);

    await simulateTyping("*hello* world");

    expect(getDoc().toString()).toEqual('doc(paragraph(bold("hello"), " world"))');
});

test("strikes text with `~` at the beginning of a block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("~test~");

    expect(getDoc().toString()).toEqual('doc(paragraph(strike("test")))');
});

test("strikes text with `~` later in the a block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("hello ~world~");

    expect(getDoc().toString()).toEqual('doc(paragraph("hello ", strike("world")))');
});

test("strikes text with `~` when there are spaces in between", async () => {
    render(<TestContentEditor />);

    await simulateTyping("~hello world~");

    expect(getDoc().toString()).toEqual('doc(paragraph(strike("hello world")))');
});

test("does not strike with `~` if a non-space comes before it", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo~bar~");

    expect(getDoc().toString()).toEqual('doc(paragraph("foo~bar~"))');
});

test("does not strike with `~` if a space comes after the first bracket", async () => {
    render(<TestContentEditor />);

    await simulateTyping("~ test~");

    expect(getDoc().toString()).toEqual('doc(paragraph("~ test~"))');
});

test("does not strike with `~` if a space comes before the last bracket", async () => {
    render(<TestContentEditor />);

    await simulateTyping("~test ~");

    expect(getDoc().toString()).toEqual('doc(paragraph("~test ~"))');
});

test("strikes a single character with `~`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("~x~");

    expect(getDoc().toString()).toEqual('doc(paragraph(strike("x")))');
});

test("strikes two characters with `~`", async () => {
    render(<TestContentEditor />);

    await simulateTyping("~xy~");

    expect(getDoc().toString()).toEqual('doc(paragraph(strike("xy")))');
});

test("characters typed after strike with `~` are not striked", async () => {
    render(<TestContentEditor />);

    await simulateTyping("~hello~ world");

    expect(getDoc().toString()).toEqual('doc(paragraph(strike("hello"), " world"))');
});

test("codes text with ` at the beginning of a block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("`test`");

    expect(getDoc().toString()).toEqual('doc(paragraph(code("test")))');
});

test("codes text with ` later in the a block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("hello `world`");

    expect(getDoc().toString()).toEqual('doc(paragraph("hello ", code("world")))');
});

test("codes text with ` when there are spaces in between", async () => {
    render(<TestContentEditor />);

    await simulateTyping("`hello world`");

    expect(getDoc().toString()).toEqual('doc(paragraph(code("hello world")))');
});

test("does not code with ` if a non-space comes before it", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo`bar`");

    expect(getDoc().toString()).toEqual('doc(paragraph("foo`bar`"))');
});

test("does not code with ` if a space comes after the first bracket", async () => {
    render(<TestContentEditor />);

    await simulateTyping("` test`");

    expect(getDoc().toString()).toEqual('doc(paragraph("` test`"))');
});

test("does not code with ` if a space comes before the last bracket", async () => {
    render(<TestContentEditor />);

    await simulateTyping("`test `");

    expect(getDoc().toString()).toEqual('doc(paragraph("`test `"))');
});

test("codes a single character with `", async () => {
    render(<TestContentEditor />);

    await simulateTyping("`x`");

    expect(getDoc().toString()).toEqual('doc(paragraph(code("x")))');
});

test("codes two characters with `", async () => {
    render(<TestContentEditor />);

    await simulateTyping("`xy`");

    expect(getDoc().toString()).toEqual('doc(paragraph(code("xy")))');
});

test("characters typed after coded text with ` are not coded", async () => {
    render(<TestContentEditor />);

    await simulateTyping("`hello` world");

    expect(getDoc().toString()).toEqual('doc(paragraph(code("hello"), " world"))');
});

test("bold mark is not ended until it is toggled off", async () => {
    render(<TestContentEditor />);

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "b", metaKey: true}));
    await simulateTyping("hello");
    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "b", metaKey: true}));
    await simulateTyping("world");

    expect(getDoc().toString()).toEqual('doc(paragraph(bold("hello"), "world"))');
});

test("italic mark is not ended until it is toggled off", async () => {
    render(<TestContentEditor />);

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "i", metaKey: true}));
    await simulateTyping("hello");
    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "i", metaKey: true}));
    await simulateTyping("world");

    expect(getDoc().toString()).toEqual('doc(paragraph(italic("hello"), "world"))');
});

test("code mark is not ended until it is toggled off", async () => {
    render(<TestContentEditor />);

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "e", metaKey: true, shiftKey: true}));
    await simulateTyping("hello");
    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "e", metaKey: true, shiftKey: true}));
    await simulateTyping("world");

    expect(getDoc().toString()).toEqual('doc(paragraph(code("hello"), "world"))');
});

test("strike mark is not ended until it is toggled off", async () => {
    render(<TestContentEditor />);

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "x", metaKey: true, shiftKey: true}));
    await simulateTyping("hello");
    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "x", metaKey: true, shiftKey: true}));
    await simulateTyping("world");

    expect(getDoc().toString()).toEqual('doc(paragraph(strike("hello"), "world"))');
});

test("alit enter creates a new line instead of a new paragraph", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));
    await simulateTyping("bar");

    expect(getDoc().toString()).toEqual('doc(paragraph("foo", break, "bar"))');
});

test("alt enter inside a list item creates a new line instead of a new paragraph", async () => {
    render(<TestContentEditor />);

    await simulateTyping("- foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));
    await simulateTyping("bar");

    expect(getDoc().toString()).toEqual('doc(unorderedListItem(paragraph("foo", break, "bar")))');
});

test("pressing enter in a quote block creates more paragraphs in the quote block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("bar");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("qux");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo"), paragraph("bar"), paragraph("qux"), paragraph))',
    );
});

test("pressing backspace at the start of a paragraph in the middle of a quote block splits the quote block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("bar");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("qux");

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(7))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo")), paragraph("bar"), quoteBlock(paragraph("qux")))',
    );
});

test("pressing backspace at the start of a paragraph at the end of a quote block removes the quote block style", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("bar");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("qux");

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(12))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo"), paragraph("bar")), paragraph("qux"))',
    );
});

test("pressing backspace at the start of a paragraph at the start of a quote block removes the quote block style", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("bar");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("qux");

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(2))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(paragraph("foo"), quoteBlock(paragraph("bar"), paragraph("qux")))',
    );
});

test("pressing backspace at the start of an empty paragraph in the middle of a quote block splits the quote block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("bar");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("qux");

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(7), state.doc.resolve(10))),
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo"), paragraph, paragraph("qux")))',
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo")), paragraph, quoteBlock(paragraph("qux")))',
    );
});

test("pressing backspace at the start of an empty paragraph at the end of a quote block removes the quote block style", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("bar");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("");

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(12))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo"), paragraph("bar")), paragraph)',
    );
});

test("pressing backspace at the start of a paragraph after a quote block merges the quote blocks", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("bar");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("qux");

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(7))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo")), paragraph("bar"), quoteBlock(paragraph("qux")))',
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foobar")), quoteBlock(paragraph("qux")))',
    );
});

test("pressing backspace at the beginning of a list item after a quote block deletes the list item", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("- bar");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("qux");

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo")), unorderedListItem(paragraph("bar")), unorderedListItem(paragraph("qux")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(9))));

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo")), paragraph("bar"), unorderedListItem(paragraph("qux")))',
    );
});

test("pressing delete in an empty paragraph deletes the paragraph", async () => {
    render(<TestContentEditor />);

    await simulateTyping("");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("- bar");

    expect(getDoc().toString()).toEqual('doc(paragraph, unorderedListItem(paragraph("bar")))');

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(1))));

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(unorderedListItem(paragraph("bar")))');
});

test("pressing delete in an empty heading deletes the heading", async () => {
    render(<TestContentEditor />);

    await simulateTyping("# foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("- bar");

    expect(getDoc().toString()).toEqual('doc(heading("foo"), unorderedListItem(paragraph("bar")))');

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(1), state.doc.resolve(4))),
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(heading, unorderedListItem(paragraph("bar")))');

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(unorderedListItem(paragraph("bar")))');
});

test("pressing delete in an empty paragraph in an empty quote block deletes the quote block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("- bar");

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo")), unorderedListItem(paragraph("bar")))',
    );

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(2), state.doc.resolve(5))),
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph), unorderedListItem(paragraph("bar")))',
    );

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(unorderedListItem(paragraph("bar")))');
});

test("pressing delete in an empty paragraph in a quote block deletes the quote block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("bar");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("- qux");

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo"), paragraph("bar")), unorderedListItem(paragraph("qux")))',
    );

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(7), state.doc.resolve(10))),
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo"), paragraph), unorderedListItem(paragraph("qux")))',
    );

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo")), unorderedListItem(paragraph("qux")))',
    );
});

test("pressing delete at the end of a paragraph brings the next list item into the same paragraph", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("- bar");

    expect(getDoc().toString()).toEqual(
        'doc(paragraph("foo"), unorderedListItem(paragraph("bar")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"))');
});

test("pressing delete at the end of a paragraph brings the next quote block into the same paragraph", async () => {
    render(<TestContentEditor />);

    await simulateTyping("foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("> bar");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("qux");

    expect(getDoc().toString()).toEqual(
        'doc(paragraph("foo"), quoteBlock(paragraph("bar"), paragraph("qux")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("foobar"), quoteBlock(paragraph("qux")))');
});

test("pressing delete at the end of a paragraph in a quote block brings the next list item into the same paragraph", async () => {
    render(<TestContentEditor />);

    await simulateTyping("> foo");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({}));
    await simulateTyping("- bar");

    expect(getDoc().toString()).toEqual(
        'doc(quoteBlock(paragraph("foo")), unorderedListItem(paragraph("bar")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(quoteBlock(paragraph("foobar")))');
});

test("pressing backspace in code block will delete one level of indentation", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine))");
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine, codeBlockLine))");
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine, codeBlockLine("  ")))');
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine, codeBlockLine("    ")))');
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine, codeBlockLine("      ")))');
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine, codeBlockLine("    ")))');
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine, codeBlockLine("  ")))');
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine, codeBlockLine))");
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine))");
});

test("pressing backspace in code block will align to nearest indentation level", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine))");
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  ")))');
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("    ")))');
    await simulateTyping(" ");
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("     ")))');
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("    ")))');
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  ")))');
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine))");
});

test("pressing backspace within code block indentation", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");
    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine))");
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  ")))');
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("    ")))');
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      ")))');
    await simulateTyping("test");
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      test")))');
    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("     test")))');
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("   test")))');
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());
    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("   test")))');
});

test("pressing command-left within code block goes to start of line excluding indentation", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");

    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine))");
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 2, head: 2});

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  ")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 4, head: 4});

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("    ")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 6, head: 6});

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      ")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 8, head: 8});

    await simulateTyping("test");

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      test")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 12, head: 12});

    fireEvent.keyDown(getTextbox(), arrowLeftKeyboardEvent({metaKey: true}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      test")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 8, head: 8});

    fireEvent.keyDown(getTextbox(), arrowLeftKeyboardEvent({metaKey: true}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      test")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 2, head: 2});

    fireEvent.keyDown(getTextbox(), arrowLeftKeyboardEvent({metaKey: true}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      test")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 8, head: 8});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(10))));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      test")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 10, head: 10});

    fireEvent.keyDown(getTextbox(), arrowLeftKeyboardEvent({metaKey: true}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      test")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 8, head: 8});
});

test("pressing command-shift-left within code block goes to start of line excluding indentation and selects", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");

    expect(getDoc().toString()).toEqual("doc(codeBlock(codeBlockLine))");
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 2, head: 2});

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  ")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 4, head: 4});

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("    ")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 6, head: 6});

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      ")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 8, head: 8});

    await simulateTyping("test");

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      test")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 12, head: 12});

    fireEvent.keyDown(getTextbox(), arrowLeftKeyboardEvent({metaKey: true, shiftKey: true}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      test")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 12, head: 8});

    fireEvent.keyDown(getTextbox(), arrowLeftKeyboardEvent({metaKey: true, shiftKey: true}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      test")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 12, head: 2});

    fireEvent.keyDown(getTextbox(), arrowLeftKeyboardEvent({metaKey: true, shiftKey: true}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      test")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 12, head: 8});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(10))));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      test")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 10, head: 10});

    fireEvent.keyDown(getTextbox(), arrowLeftKeyboardEvent({metaKey: true, shiftKey: true}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("      test")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 10, head: 8});
});

test("auto balances `(` when typed", async () => {
    render(<TestContentEditor />);

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "("}));

    expect(getDoc().toString()).toEqual('doc(paragraph("()"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "("}));

    expect(getDoc().toString()).toEqual('doc(paragraph("()"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "("}));

    expect(getDoc().toString()).toEqual('doc(paragraph("(())"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "("}));

    expect(getDoc().toString()).toEqual('doc(paragraph("((()))"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("(())"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("()"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "("}));

    expect(getDoc().toString()).toEqual('doc(paragraph("()"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "["}));

    expect(getDoc().toString()).toEqual('doc(paragraph("([])"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "{"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("([{}])"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("([])"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("()"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(paragraph)");
});

test("auto balances `[` when typed", async () => {
    render(<TestContentEditor />);

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "["}));

    expect(getDoc().toString()).toEqual('doc(paragraph("[]"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "["}));

    expect(getDoc().toString()).toEqual('doc(paragraph("[]"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "["}));

    expect(getDoc().toString()).toEqual('doc(paragraph("[[]]"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "["}));

    expect(getDoc().toString()).toEqual('doc(paragraph("[[[]]]"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("[[]]"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("[]"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(paragraph)");
});

test("auto balances `{` when typed", async () => {
    render(<TestContentEditor />);

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "{"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("{}"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "{"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("{}"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "{"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("{{}}"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "{"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("{{{}}}"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("{{}}"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("{}"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(paragraph)");
});

test('auto balances `"` when typed', async () => {
    render(<TestContentEditor />);

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: '"'}));

    expect(getDoc().toString()).toEqual('doc(paragraph("“”"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: '"'}));

    expect(getDoc().toString()).toEqual('doc(paragraph("“”"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: '"'}));

    expect(getDoc().toString()).toEqual('doc(paragraph("“”"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: '"'}));

    expect(getDoc().toString()).toEqual('doc(paragraph("“”“”"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("“”"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    // Second quote isn't deleted since JSDOM doesn't support default keyboard
    // event handlers. Seeing no keymap handler run is interesting enough to test.
    expect(getDoc().toString()).toEqual('doc(paragraph("“”"))');
});

test("doesn't add extra punctuation after auto balancing `(`", async () => {
    render(<TestContentEditor />);

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "("}));

    expect(getDoc().toString()).toEqual('doc(paragraph("()"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: ")"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("()"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "("}));

    expect(getDoc().toString()).toEqual('doc(paragraph("()()"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: ")"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("()()"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    // First parentheses isn't deleted since JSDOM doesn't support default keyboard
    // event handlers. We're testing the parentheses itself isn't removed.
    expect(getDoc().toString()).toEqual('doc(paragraph("()()"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "("}));

    expect(getDoc().toString()).toEqual('doc(paragraph("()()()"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "("}));

    expect(getDoc().toString()).toEqual('doc(paragraph("()()(())"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "("}));

    expect(getDoc().toString()).toEqual('doc(paragraph("()()((()))"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: ")"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("()()((()))"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: ")"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("()()((()))"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "("}));

    expect(getDoc().toString()).toEqual('doc(paragraph("()()((())())"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: ")"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("()()((())())"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: ")"}));
});

test("doesn't add extra punctuation after auto balancing `[`", async () => {
    render(<TestContentEditor />);

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "["}));

    expect(getDoc().toString()).toEqual('doc(paragraph("[]"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "]"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("[]"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "["}));

    expect(getDoc().toString()).toEqual('doc(paragraph("[][]"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "]"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("[][]"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    // First parentheses isn't deleted since JSDOM doesn't support default keyboard
    // event handlers. We're testing the parentheses itself isn't removed.
    expect(getDoc().toString()).toEqual('doc(paragraph("[][]"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "["}));

    expect(getDoc().toString()).toEqual('doc(paragraph("[][][]"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "["}));

    expect(getDoc().toString()).toEqual('doc(paragraph("[][][[]]"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "["}));

    expect(getDoc().toString()).toEqual('doc(paragraph("[][][[[]]]"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "]"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("[][][[[]]]"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "]"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("[][][[[]]]"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "["}));

    expect(getDoc().toString()).toEqual('doc(paragraph("[][][[[]][]]"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "]"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("[][][[[]][]]"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "]"}));
});

test("doesn't add extra punctuation after auto balancing `{`", async () => {
    render(<TestContentEditor />);

    expect(getDoc().toString()).toEqual("doc(paragraph)");

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "{"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("{}"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "}"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("{}"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "{"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("{}{}"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "}"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("{}{}"))');

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    // First parentheses isn't deleted since JSDOM doesn't support default keyboard
    // event handlers. We're testing the parentheses itself isn't removed.
    expect(getDoc().toString()).toEqual('doc(paragraph("{}{}"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "{"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("{}{}{}"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "{"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("{}{}{{}}"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "{"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("{}{}{{{}}}"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "}"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("{}{}{{{}}}"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "}"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("{}{}{{{}}}"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "{"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("{}{}{{{}}{}}"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "}"}));

    expect(getDoc().toString()).toEqual('doc(paragraph("{}{}{{{}}{}}"))');

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "}"}));
});

test("pressing enter will reuse current indentation level in code block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test1");

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  test1")))');

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  test1"), codeBlockLine("  ")))',
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  test1"), codeBlockLine, codeBlockLine("  ")))',
    );

    await simulateTyping("test2");
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  test1"), codeBlockLine, codeBlockLine("    test2")))',
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  test1"), codeBlockLine, codeBlockLine("    test2"), codeBlockLine("    ")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  test1"), codeBlockLine, codeBlockLine("    test2"), codeBlockLine("      ")))',
    );

    await simulateTyping("test3");

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  test1"), codeBlockLine, codeBlockLine("    test2"), codeBlockLine("      test3")))',
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  test1"), codeBlockLine, codeBlockLine("    test2"), codeBlockLine("      test3"), codeBlockLine("      ")))',
    );

    await simulateTyping("test4");

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  test1"), codeBlockLine, codeBlockLine("    test2"), codeBlockLine("      test3"), codeBlockLine("      test4")))',
    );
});

test("pressing enter will add indentation level if in `()` in code block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "("}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  ()")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 5, head: 5});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  ("), codeBlockLine("    "), codeBlockLine("  )")))',
    );
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 11, head: 11});
});

test("pressing enter will add indentation level if in `[]` in code block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "["}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  []")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 5, head: 5});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  ["), codeBlockLine("    "), codeBlockLine("  ]")))',
    );
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 11, head: 11});
});

test("pressing enter will add indentation level if in `{}` in code block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "{"}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  {}")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 5, head: 5});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    "), codeBlockLine("  }")))',
    );
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 11, head: 11});
});

test("pressing enter won't add indentation level if after `()` in code block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "("}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  ()")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 5, head: 5});

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: ")"}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  ()")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 6, head: 6});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  ()"), codeBlockLine("  ")))',
    );
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 10, head: 10});
});

test("pressing enter won't add indentation level if after `[]` in code block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "["}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  []")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 5, head: 5});

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "]"}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  []")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 6, head: 6});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  []"), codeBlockLine("  ")))',
    );
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 10, head: 10});
});

test("pressing enter won't add indentation level if after `{}` in code block", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "{"}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  {}")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 5, head: 5});

    fireEvent.keyDown(getTextbox(), charKeyboardEvent({key: "}"}));

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  {}")))');
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 6, head: 6});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {}"), codeBlockLine("  ")))',
    );
    expect(getEditor().state.selection.toJSON()).toEqual({type: "text", anchor: 10, head: 10});
});

test("pressing enter will match the indentation level if after unbalanced `(` in code block", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  (")]),
                    schema.node("codeBlockLine", null, [schema.text("       test")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  ("), codeBlockLine("       test")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  ("), codeBlockLine("       "), codeBlockLine("       test")))',
    );
});

test("pressing enter will match the indentation level if after unbalanced `[` in code block", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  [")]),
                    schema.node("codeBlockLine", null, [schema.text("       test")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  ["), codeBlockLine("       test")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  ["), codeBlockLine("       "), codeBlockLine("       test")))',
    );
});

test("pressing enter will match the indentation level if after unbalanced `{` in code block", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  {")]),
                    schema.node("codeBlockLine", null, [schema.text("       test")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("       test")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("       "), codeBlockLine("       test")))',
    );
});

test("pressing enter will match the indentation level if after unbalanced `(` in code block (being preceded by closing bracket counts as unbalanced)", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  ) else (")]),
                    schema.node("codeBlockLine", null, [schema.text("       test")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  ) else ("), codeBlockLine("       test")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(12))));
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  ) else ("), codeBlockLine("       "), codeBlockLine("       test")))',
    );
});

test("pressing enter will match the indentation level if after unbalanced `[` in code block (being preceded by closing bracket counts as unbalanced)", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  ] else [")]),
                    schema.node("codeBlockLine", null, [schema.text("       test")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  ] else ["), codeBlockLine("       test")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(12))));
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  ] else ["), codeBlockLine("       "), codeBlockLine("       test")))',
    );
});

test("pressing enter will match the indentation level if after unbalanced `{` in code block (being preceded by closing bracket counts as unbalanced)", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  } else {")]),
                    schema.node("codeBlockLine", null, [schema.text("       test")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  } else {"), codeBlockLine("       test")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(12))));
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  } else {"), codeBlockLine("       "), codeBlockLine("       test")))',
    );
});

test("pressing enter will add to the indentation level if after unbalanced `(` in code block", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  (")]),
                    schema.node("codeBlockLine", null, [schema.text("  )")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  ("), codeBlockLine("  )")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  ("), codeBlockLine("    "), codeBlockLine("  )")))',
    );
});

test("pressing enter will add to the indentation level if after unbalanced `[` in code block", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  [")]),
                    schema.node("codeBlockLine", null, [schema.text("  ]")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  ["), codeBlockLine("  ]")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  ["), codeBlockLine("    "), codeBlockLine("  ]")))',
    );
});

test("pressing enter will add to the indentation level if after unbalanced `{` in code block", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  {")]),
                    schema.node("codeBlockLine", null, [schema.text("  }")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("  }")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));
    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    "), codeBlockLine("  }")))',
    );
});

test("pressing tab in code block will first go to the indentation level of max sibling line 1", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  {")]),
                    schema.node("codeBlockLine", null, [schema.text("    test1")]),
                    schema.node("codeBlockLine", null, []),
                    schema.node("codeBlockLine", null, [schema.text("  }")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    test1"), codeBlockLine, codeBlockLine("  }")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(18))));
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    test1"), codeBlockLine("    "), codeBlockLine("  }")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    test1"), codeBlockLine("      "), codeBlockLine("  }")))',
    );
});

test("pressing tab in code block will first go to the indentation level of max sibling line even if there's already a space 1", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  {")]),
                    schema.node("codeBlockLine", null, [schema.text("    test1")]),
                    schema.node("codeBlockLine", null, [schema.text(" ")]),
                    schema.node("codeBlockLine", null, [schema.text("  }")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    test1"), codeBlockLine(" "), codeBlockLine("  }")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(19))));
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    test1"), codeBlockLine("    "), codeBlockLine("  }")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    test1"), codeBlockLine("      "), codeBlockLine("  }")))',
    );
});

test("pressing tab in code block will first go to the indentation level of max sibling line unless there's a non-space 1", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  {")]),
                    schema.node("codeBlockLine", null, [schema.text("    test1")]),
                    schema.node("codeBlockLine", null, [schema.text("x")]),
                    schema.node("codeBlockLine", null, [schema.text("  }")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    test1"), codeBlockLine("x"), codeBlockLine("  }")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(19))));
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    test1"), codeBlockLine("  x"), codeBlockLine("  }")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    test1"), codeBlockLine("    x"), codeBlockLine("  }")))',
    );
});

test("pressing tab in code block will first go to the indentation level of max sibling line 2", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  {")]),
                    schema.node("codeBlockLine", null, []),
                    schema.node("codeBlockLine", null, [schema.text("    test1")]),
                    schema.node("codeBlockLine", null, [schema.text("  }")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine, codeBlockLine("    test1"), codeBlockLine("  }")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(7))));
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    "), codeBlockLine("    test1"), codeBlockLine("  }")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("      "), codeBlockLine("    test1"), codeBlockLine("  }")))',
    );
});

test("pressing tab in code block will first go to the indentation level of max sibling line even if there's already a space 2", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  {")]),
                    schema.node("codeBlockLine", null, [schema.text(" ")]),
                    schema.node("codeBlockLine", null, [schema.text("    test1")]),
                    schema.node("codeBlockLine", null, [schema.text("  }")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine(" "), codeBlockLine("    test1"), codeBlockLine("  }")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(8))));
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    "), codeBlockLine("    test1"), codeBlockLine("  }")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("      "), codeBlockLine("    test1"), codeBlockLine("  }")))',
    );
});

test("pressing tab in code block will first go to the indentation level of max sibling line unless there's a non-space 2", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  {")]),
                    schema.node("codeBlockLine", null, [schema.text("x")]),
                    schema.node("codeBlockLine", null, [schema.text("    test1")]),
                    schema.node("codeBlockLine", null, [schema.text("  }")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("x"), codeBlockLine("    test1"), codeBlockLine("  }")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(8))));
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("  x"), codeBlockLine("    test1"), codeBlockLine("  }")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    x"), codeBlockLine("    test1"), codeBlockLine("  }")))',
    );
});

test("pressing tab in code block will first go to the indentation level of max sibling line (even if there's an empty line in between) 1", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  {")]),
                    schema.node("codeBlockLine", null, [schema.text("    test1")]),
                    schema.node("codeBlockLine", null, []),
                    schema.node("codeBlockLine", null, []),
                    schema.node("codeBlockLine", null, [schema.text("  }")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    test1"), codeBlockLine, codeBlockLine, codeBlockLine("  }")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(20))));
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    test1"), codeBlockLine, codeBlockLine("    "), codeBlockLine("  }")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    test1"), codeBlockLine, codeBlockLine("      "), codeBlockLine("  }")))',
    );
});

test("pressing tab in code block will first go to the indentation level of max sibling line (even if there's an empty line in between) 2", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", null, [
                schema.node("codeBlock", null, [
                    schema.node("codeBlockLine", null, [schema.text("  {")]),
                    schema.node("codeBlockLine", null, []),
                    schema.node("codeBlockLine", null, []),
                    schema.node("codeBlockLine", null, [schema.text("    test1")]),
                    schema.node("codeBlockLine", null, [schema.text("  }")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine, codeBlockLine, codeBlockLine("    test1"), codeBlockLine("  }")))',
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(7))));
    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("    "), codeBlockLine, codeBlockLine("    test1"), codeBlockLine("  }")))',
    );

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  {"), codeBlockLine("      "), codeBlockLine, codeBlockLine("    test1"), codeBlockLine("  }")))',
    );
});

test("enter in code block uses adjacent indentation level if there is no indentation", async () => {
    render(<TestContentEditor />);

    await simulateTyping("```");

    fireEvent.keyDown(getTextbox(), tabKeyboardEvent());
    await simulateTyping("test 1");

    expect(getDoc().toString()).toEqual('doc(codeBlock(codeBlockLine("  test 1")))');

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  test 1"), codeBlockLine("  ")))',
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  test 1"), codeBlockLine, codeBlockLine("  ")))',
    );

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  test 1"), codeBlockLine, codeBlockLine))',
    );

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("  test 1"), codeBlockLine, codeBlockLine, codeBlockLine("  ")))',
    );
});

test("pressing arrow down above a file selects the file", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(paragraph, fileRow(file))");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(paragraph, fileRow(file))");
    expect(getSelection()).toEqual({type: "node", anchor: 3});
});

test("pressing enter when a file is selected creates a paragraph below", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file), paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});
});

test("pressing enter when a file is selected in a multi-file row creates a paragraph below (first selected)", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file), paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 6, head: 6});
});

test("pressing enter when a file is selected in a multi-file row creates a paragraph below (second selected)", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), arrowRightKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 2});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file), paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 6, head: 6});
});

test("pressing enter when a file is selected in a multi-file row creates a paragraph below (third selected)", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), arrowRightKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 2});

    fireEvent.keyDown(getTextbox(), arrowRightKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file), paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 6, head: 6});
});

test("pressing enter when a file is selected creates a paragraph between two file rows", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file), fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file), paragraph, fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});
});

test("pressing alt-enter when a file is selected creates a paragraph above", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));

    expect(getDoc().toString()).toEqual("doc(paragraph, fileRow(file))");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});
});

test("pressing alt-enter when a file is selected in a multi-file row creates a paragraph above (first selected)", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));

    expect(getDoc().toString()).toEqual("doc(paragraph, fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});
});

test("pressing alt-enter when a file is selected in a multi-file row creates a paragraph above (second selected)", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), arrowRightKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 2});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));

    expect(getDoc().toString()).toEqual("doc(paragraph, fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});
});

test("pressing alt-enter when a file is selected in a multi-file row creates a paragraph above (third selected)", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), arrowRightKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 2});

    fireEvent.keyDown(getTextbox(), arrowRightKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));

    expect(getDoc().toString()).toEqual("doc(paragraph, fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});
});

test("pressing alt-enter when a file is selected creates a paragraph between two file rows", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file), fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file), fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 4});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent({altKey: true}));

    expect(getDoc().toString()).toEqual("doc(fileRow(file), paragraph, fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});
});

test("backspace from first to last in a gallery maintains file selection", () => {
    const file1Id = generateChronologicalId<FileId>();
    const file2Id = generateChronologicalId<FileId>();
    const file3Id = generateChronologicalId<FileId>();
    const file4Id = generateChronologicalId<FileId>();
    const file5Id = generateChronologicalId<FileId>();
    const file6Id = generateChronologicalId<FileId>();

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])}
        />,
    );

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file3Id})]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file6Id})]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema.node("doc", {}, [schema.node("paragraph"), schema.node("paragraph")]).toJSON(),
    );
    expect(getSelection()).toEqual({type: "text", anchor: 3, head: 3});
});

test("backspace from last to first in a gallery maintains file selection", () => {
    const file1Id = generateChronologicalId<FileId>();
    const file2Id = generateChronologicalId<FileId>();
    const file3Id = generateChronologicalId<FileId>();
    const file4Id = generateChronologicalId<FileId>();
    const file5Id = generateChronologicalId<FileId>();
    const file6Id = generateChronologicalId<FileId>();

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])}
        />,
    );

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), endKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 12});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file5Id})]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 11});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 8});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 5});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 4});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file1Id})]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema.node("doc", {}, [schema.node("paragraph"), schema.node("paragraph")]).toJSON(),
    );
    expect(getSelection()).toEqual({type: "text", anchor: 3, head: 3});
});

test("backspace from first to last in a gallery maintains file selection when surrounded by list items", () => {
    const file1Id = generateChronologicalId<FileId>();
    const file2Id = generateChronologicalId<FileId>();
    const file3Id = generateChronologicalId<FileId>();
    const file4Id = generateChronologicalId<FileId>();
    const file5Id = generateChronologicalId<FileId>();
    const file6Id = generateChronologicalId<FileId>();

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])}
        />,
    );

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "text", anchor: 2, head: 2});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 5});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 5});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file3Id})]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 5});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 5});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 5});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file6Id})]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 5});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "text", anchor: 6, head: 6});
});

test("backspace from last to first in a gallery maintains file selection when surrounded by list items", () => {
    const file1Id = generateChronologicalId<FileId>();
    const file2Id = generateChronologicalId<FileId>();
    const file3Id = generateChronologicalId<FileId>();
    const file4Id = generateChronologicalId<FileId>();
    const file5Id = generateChronologicalId<FileId>();
    const file6Id = generateChronologicalId<FileId>();

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])}
        />,
    );

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "text", anchor: 2, head: 2});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 5});

    fireEvent.keyDown(getTextbox(), endKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 14});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file5Id})]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 13});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 10});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 7});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                ]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 6});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file1Id})]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 5});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph")]),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "text", anchor: 6, head: 6});
});

test("delete from first to last in a gallery maintains file selection", () => {
    const file1Id = generateChronologicalId<FileId>();
    const file2Id = generateChronologicalId<FileId>();
    const file3Id = generateChronologicalId<FileId>();
    const file4Id = generateChronologicalId<FileId>();
    const file5Id = generateChronologicalId<FileId>();
    const file6Id = generateChronologicalId<FileId>();

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])}
        />,
    );

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file3Id})]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file6Id})]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema.node("doc", {}, [schema.node("paragraph"), schema.node("paragraph")]).toJSON(),
    );
    expect(getSelection()).toEqual({type: "text", anchor: 3, head: 3});
});

test("delete from last to first in a gallery maintains file selection", () => {
    const file1Id = generateChronologicalId<FileId>();
    const file2Id = generateChronologicalId<FileId>();
    const file3Id = generateChronologicalId<FileId>();
    const file4Id = generateChronologicalId<FileId>();
    const file5Id = generateChronologicalId<FileId>();
    const file6Id = generateChronologicalId<FileId>();

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])}
        />,
    );

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), endKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file5Id}),
                    schema.node("file", {fileId: file6Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 12});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file5Id})]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 11});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file4Id})]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 8});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                    schema.node("file", {fileId: file3Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 5});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1Id}),
                    schema.node("file", {fileId: file2Id}),
                ]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 4});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file1Id})]),
                schema.node("paragraph"),
            ])
            .toJSON(),
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toJSON()).toEqual(
        schema.node("doc", {}, [schema.node("paragraph"), schema.node("paragraph")]).toJSON(),
    );
    expect(getSelection()).toEqual({type: "text", anchor: 3, head: 3});
});

test("backspace at the start of a paragraph selects the previous file", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("paragraph", {}, [schema.text("test")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(fileRow(file, file, file), paragraph("test"))');
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), endKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(fileRow(file, file, file), paragraph("test"))');
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(fileRow(file, file, file), paragraph("test"))');
    expect(getSelection()).toEqual({type: "text", anchor: 6, head: 6});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(fileRow(file, file, file), paragraph("test"))');
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(7))));

    expect(getDoc().toString()).toEqual('doc(fileRow(file, file, file), paragraph("test"))');
    expect(getSelection()).toEqual({type: "text", anchor: 7, head: 7});

    // Backspace in text is normally implemented by the browser but JSDOM doesn't implement
    // default `contenteditable` keyboard behavior.
    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(fileRow(file, file, file), paragraph("test"))');
    expect(getSelection()).toEqual({type: "text", anchor: 7, head: 7});
});

test("delete at the end of a paragraph selects the next file", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("test")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("test"), fileRow(file, file, file))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));

    expect(getDoc().toString()).toEqual('doc(paragraph("test"), fileRow(file, file, file))');
    expect(getSelection()).toEqual({type: "text", anchor: 5, head: 5});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("test"), fileRow(file, file, file))');
    expect(getSelection()).toEqual({type: "node", anchor: 7});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));

    expect(getDoc().toString()).toEqual('doc(paragraph("test"), fileRow(file, file, file))');
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});

    // Delete in text is normally implemented by the browser but JSDOM doesn't implement
    // default `contenteditable` keyboard behavior.
    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("test"), fileRow(file, file, file))');
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});
});

test("backspace at the start of a paragraph in a list item selects the previous file after deleting the list item style", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("unorderedListItem", {}, [
                    schema.node("paragraph", {}, [schema.text("test")]),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(fileRow(file, file, file), unorderedListItem(paragraph("test")))',
    );
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), endKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(fileRow(file, file, file), unorderedListItem(paragraph("test")))',
    );
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(fileRow(file, file, file), unorderedListItem(paragraph("test")))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 7, head: 7});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(fileRow(file, file, file), paragraph("test"))');
    expect(getSelection()).toEqual({type: "text", anchor: 6, head: 6});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(fileRow(file, file, file), paragraph("test"))');
    expect(getSelection()).toEqual({type: "node", anchor: 3});
});

test("delete at the end of a paragraph in a list item selects the next file", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("unorderedListItem", {}, [
                    schema.node("paragraph", {}, [schema.text("test")]),
                ]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test")), fileRow(file, file, file))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 2, head: 2});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(6))));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test")), fileRow(file, file, file))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 6, head: 6});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test")), fileRow(file, file, file))',
    );
    expect(getSelection()).toEqual({type: "node", anchor: 9});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(5))));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test")), fileRow(file, file, file))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 5, head: 5});

    // Delete in text is normally implemented by the browser but JSDOM doesn't implement
    // default `contenteditable` keyboard behavior.
    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("test")), fileRow(file, file, file))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 5, head: 5});
});

test("backspace at the start of an empty paragraph removes the paragraph", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("paragraph"),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file), paragraph)");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), endKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file), paragraph)");
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file), paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 6, head: 6});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 3});
});

test("delete at the end of an empty paragraph removes the paragraph", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(paragraph, fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});
});

test("pressing enter when a file is selected creates a paragraph between two file rows then pressing backspace deletes it", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file), fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file), paragraph, fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file), fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});
});

test("pressing enter when a file is selected creates a paragraph between two file rows then pressing delete deletes it", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file), fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), enterKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file), paragraph, fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file), fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 4});
});

test("pressing arrow down when file is selected and the last thing creates a new paragraph", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file), paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});
});

test("pressing arrow up when file is selected and the first thing creates a new paragraph", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), arrowUpKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(paragraph, fileRow(file))");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});
});

test("pressing end/home moves to the end/beginning of file gallery respectively", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("paragraph"),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), endKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 10});

    fireEvent.keyDown(getTextbox(), homeKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), endKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 10});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "text", anchor: 13, head: 13});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 15});

    fireEvent.keyDown(getTextbox(), endKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 23});

    fireEvent.keyDown(getTextbox(), homeKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 15});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 18});

    fireEvent.keyDown(getTextbox(), endKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 23});

    fireEvent.keyDown(getTextbox(), arrowLeftKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 22});

    fireEvent.keyDown(getTextbox(), homeKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 15});

    fireEvent.keyDown(getTextbox(), endKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 23});

    fireEvent.keyDown(getTextbox(), endKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 23});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "text", anchor: 26, head: 26});

    fireEvent.keyDown(getTextbox(), arrowDownKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 28});

    fireEvent.keyDown(getTextbox(), endKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 30});

    fireEvent.keyDown(getTextbox(), homeKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 28});

    fireEvent.keyDown(getTextbox(), homeKeyboardEvent());

    expect(getDoc().toString()).toEqual(
        "doc(fileRow(file, file), fileRow(file), fileRow(file, file, file), paragraph, fileRow(file), fileRow(file, file), fileRow(file, file), paragraph, fileRow(file, file, file))",
    );
    expect(getSelection()).toEqual({type: "node", anchor: 28});
});

test("typing when a file is selected creates a paragraph below", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyPress(getTextbox(), charKeyboardEvent({key: "x", withCharCode: true}));

    expect(getDoc().toString()).toEqual('doc(fileRow(file), paragraph("x"))');
    expect(getSelection()).toEqual({type: "text", anchor: 5, head: 5});
});

test("typing when a file is selected in a multi-file row creates a paragraph below (first selected)", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyPress(getTextbox(), charKeyboardEvent({key: "x", withCharCode: true}));

    expect(getDoc().toString()).toEqual('doc(fileRow(file, file, file), paragraph("x"))');
    expect(getSelection()).toEqual({type: "text", anchor: 7, head: 7});
});

test("typing when a file is selected in a multi-file row creates a paragraph below (second selected)", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), arrowRightKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 2});

    fireEvent.keyPress(getTextbox(), charKeyboardEvent({key: "x", withCharCode: true}));

    expect(getDoc().toString()).toEqual('doc(fileRow(file, file, file), paragraph("x"))');
    expect(getSelection()).toEqual({type: "text", anchor: 7, head: 7});
});

test("typing when a file is selected in a multi-file row creates a paragraph below (third selected)", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyDown(getTextbox(), arrowRightKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 2});

    fireEvent.keyDown(getTextbox(), arrowRightKeyboardEvent());

    expect(getDoc().toString()).toEqual("doc(fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 3});

    fireEvent.keyPress(getTextbox(), charKeyboardEvent({key: "x", withCharCode: true}));

    expect(getDoc().toString()).toEqual('doc(fileRow(file, file, file), paragraph("x"))');
    expect(getSelection()).toEqual({type: "text", anchor: 7, head: 7});
});

test("typing when a file is selected creates a paragraph between two file rows", () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(fileRow(file), fileRow(file, file, file))");
    expect(getSelection()).toEqual({type: "node", anchor: 1});

    fireEvent.keyPress(getTextbox(), charKeyboardEvent({key: "x", withCharCode: true}));

    expect(getDoc().toString()).toEqual(
        'doc(fileRow(file), paragraph("x"), fileRow(file, file, file))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 5, head: 5});
});

test("can backspace at the start of only paragraph in document after title", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, [
                    DocumentContentProsemirrorSchema.text("foo"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("bar"),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(title("foo"), paragraph("bar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(6))));

    expect(getDoc().toString()).toEqual('doc(title("foo"), paragraph("bar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 6, head: 6});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(title("foobar"), paragraph)');
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});
});

test("can delete at the end of title in document with only one paragraph", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, [
                    DocumentContentProsemirrorSchema.text("foo"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("bar"),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(title("foo"), paragraph("bar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));

    expect(getDoc().toString()).toEqual('doc(title("foo"), paragraph("bar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(title("foobar"), paragraph)');
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});
});

test("pressing backspace on a node selection will move selection before the node", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("divider"),
                schema.node("paragraph", {}, [schema.text("bar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), divider, paragraph("bar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new NodeSelection(state.doc.resolve(5))));

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), divider, paragraph("bar"))');
    expect(getSelection()).toEqual({type: "node", anchor: 5});

    fireEvent.keyDown(getTextbox(), backspaceKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), paragraph("bar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 4, head: 4});
});

test("pressing delete on a node selection will move selection after the node", async () => {
    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("divider"),
                schema.node("paragraph", {}, [schema.text("bar")]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), divider, paragraph("bar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new NodeSelection(state.doc.resolve(5))));

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), divider, paragraph("bar"))');
    expect(getSelection()).toEqual({type: "node", anchor: 5});

    fireEvent.keyDown(getTextbox(), deleteKeyboardEvent());

    expect(getDoc().toString()).toEqual('doc(paragraph("foo"), paragraph("bar"))');
    expect(getSelection()).toEqual({type: "text", anchor: 6, head: 6});
});
