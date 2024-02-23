import {setInteractionModality} from "@react-aria/interactions";
import {render, screen} from "@testing-library/react";
import {closeHistory} from "prosemirror-history";
import {Node} from "prosemirror-model";
import {EditorState, TextSelection, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import React, {useState} from "react";
import {act} from "react-dom/test-utils";
import {ContentEditor, getEditorViewForTest} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";
import {TooltipCoordinationContextProvider} from "~/client/design/tooltip.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {
    DocumentWithoutTitleContentProsemirrorSchema,
    emptyDocumentWithoutTitleContent,
} from "~/shared/documents/document_content_schema.js";

import.meta.jest.useFakeTimers();

const schema = DocumentWithoutTitleContentProsemirrorSchema;

function TestContentEditor({initialContent}: {initialContent?: Node}) {
    const [state, setState] = useState(() =>
        ContentEditorState.create({
            doc: initialContent ?? emptyDocumentWithoutTitleContent,
            references: emptyContentReferences,
        }),
    );
    return (
        <OverlayScopeContextProvider>
            <TooltipCoordinationContextProvider>
                <ContentEditor aria-label="Test" state={state} onChange={setState} />
            </TooltipCoordinationContextProvider>
        </OverlayScopeContextProvider>
    );
}

// Get the textbox `HTMLElement`.
function getTextbox(): HTMLElement {
    return screen.getByRole("textbox");
}

// Get the ProseMirror `EditorView`.
function getEditor(): EditorView {
    return getEditorViewForTest(getTextbox().parentNode);
}

// Get the ProseMirror document `Node`.
function getDoc() {
    return getEditor().state.doc;
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

test("shows the toolbar when a range of content is selected", () => {
    setInteractionModality("pointer");

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("bar")]),
                schema.node("paragraph", {}, [schema.text("qux")]),
            ])}
        />,
    );

    act(() => {
        getTextbox().focus();
    });

    expect(screen.queryByLabelText("Bold")).not.toBeInTheDocument();

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });

    expect(screen.queryByLabelText("Bold")).not.toBeInTheDocument();

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(4), state.doc.resolve(13))),
    );
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });

    expect(screen.getByLabelText("Bold")).toBeInTheDocument();
});

test("shows the toolbar when there's a pointer interaction modality", () => {
    setInteractionModality("keyboard");

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("bar")]),
                schema.node("paragraph", {}, [schema.text("qux")]),
            ])}
        />,
    );

    act(() => {
        getTextbox().focus();
    });

    expect(screen.queryByLabelText("Bold")).not.toBeInTheDocument();

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(4), state.doc.resolve(13))),
    );
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });
    expect(screen.queryByLabelText("Bold")).not.toBeInTheDocument();

    act(() => {
        setInteractionModality("pointer");
    });
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });

    expect(screen.getByLabelText("Bold")).toBeInTheDocument();
});

test("shows the toolbar when the editor is focused", () => {
    setInteractionModality("pointer");

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("bar")]),
                schema.node("paragraph", {}, [schema.text("qux")]),
            ])}
        />,
    );

    expect(screen.queryByLabelText("Bold")).not.toBeInTheDocument();

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(4))));
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });

    expect(screen.queryByLabelText("Bold")).not.toBeInTheDocument();

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(4), state.doc.resolve(13))),
    );
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });

    expect(screen.queryByLabelText("Bold")).not.toBeInTheDocument();

    act(() => {
        getTextbox().focus();
    });
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });

    expect(screen.getByLabelText("Bold")).toBeInTheDocument();
});

test("toggles headings on", () => {
    setInteractionModality("pointer");

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("bar")]),
                schema.node("paragraph", {}, [schema.text("qux")]),
            ])}
        />,
    );

    act(() => {
        getTextbox().focus();
    });

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(4), state.doc.resolve(13))),
    );
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });

    act(() => {
        screen.getByLabelText("Heading 1").click();
    });

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("heading", {level: 1}, [schema.text("foo")]),
                schema.node("heading", {level: 1}, [schema.text("bar")]),
                schema.node("heading", {level: 1}, [schema.text("qux")]),
            ])
            .toJSON(),
    );
});

test("toggles headings off", () => {
    setInteractionModality("pointer");

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("bar")]),
                schema.node("paragraph", {}, [schema.text("qux")]),
            ])}
        />,
    );

    act(() => {
        getTextbox().focus();
    });

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(4), state.doc.resolve(13))),
    );
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });

    act(() => {
        screen.getByLabelText("Heading 1").click();
    });

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("heading", {level: 1}, [schema.text("foo")]),
                schema.node("heading", {level: 1}, [schema.text("bar")]),
                schema.node("heading", {level: 1}, [schema.text("qux")]),
            ])
            .toJSON(),
    );

    act(() => {
        screen.getByLabelText("Heading 1").click();
    });

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("bar")]),
                schema.node("paragraph", {}, [schema.text("qux")]),
            ])
            .toJSON(),
    );
});

test("toggles headings on when there's already a heading of that level", () => {
    setInteractionModality("pointer");

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("heading", {level: 1}, [schema.text("bar")]),
                schema.node("paragraph", {}, [schema.text("qux")]),
            ])}
        />,
    );

    act(() => {
        getTextbox().focus();
    });

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(4), state.doc.resolve(13))),
    );
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });

    act(() => {
        screen.getByLabelText("Heading 1").click();
    });

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("heading", {level: 1}, [schema.text("foo")]),
                schema.node("heading", {level: 1}, [schema.text("bar")]),
                schema.node("heading", {level: 1}, [schema.text("qux")]),
            ])
            .toJSON(),
    );
});

test("converts headings of another level", () => {
    setInteractionModality("pointer");

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("heading", {level: 2}, [schema.text("bar")]),
                schema.node("paragraph", {}, [schema.text("qux")]),
            ])}
        />,
    );

    act(() => {
        getTextbox().focus();
    });

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(4), state.doc.resolve(13))),
    );
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });

    act(() => {
        screen.getByLabelText("Heading 1").click();
    });

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("heading", {level: 1}, [schema.text("foo")]),
                schema.node("heading", {level: 1}, [schema.text("bar")]),
                schema.node("heading", {level: 1}, [schema.text("qux")]),
            ])
            .toJSON(),
    );
});

test("toggles list on", () => {
    setInteractionModality("pointer");

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("bar")]),
                schema.node("paragraph", {}, [schema.text("qux")]),
            ])}
        />,
    );

    act(() => {
        getTextbox().focus();
    });

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(4), state.doc.resolve(13))),
    );
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });

    act(() => {
        screen.getByLabelText("Bullet list").click();
    });

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("bar")]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("qux")]),
                ]),
            ])
            .toJSON(),
    );
});

test("toggles list off", () => {
    setInteractionModality("pointer");

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("bar")]),
                schema.node("paragraph", {}, [schema.text("qux")]),
            ])}
        />,
    );

    act(() => {
        getTextbox().focus();
    });

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(4), state.doc.resolve(13))),
    );
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });

    act(() => {
        screen.getByLabelText("Bullet list").click();
    });

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("bar")]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("qux")]),
                ]),
            ])
            .toJSON(),
    );

    act(() => {
        screen.getByLabelText("Bullet list").click();
    });

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("bar")]),
                schema.node("paragraph", {}, [schema.text("qux")]),
            ])
            .toJSON(),
    );
});

test("toggles list on even when there's already a list item of that type", () => {
    setInteractionModality("pointer");

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("bar")]),
                ]),
                schema.node("paragraph", {}, [schema.text("qux")]),
            ])}
        />,
    );

    act(() => {
        getTextbox().focus();
    });

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(4), state.doc.resolve(15))),
    );
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });

    act(() => {
        screen.getByLabelText("Bullet list").click();
    });

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("bar")]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("qux")]),
                ]),
            ])
            .toJSON(),
    );
});

test("toggles list on even when there's already a list item of a different type", () => {
    setInteractionModality("pointer");

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("orderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("bar")]),
                ]),
                schema.node("paragraph", {}, [schema.text("qux")]),
            ])}
        />,
    );

    act(() => {
        getTextbox().focus();
    });

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(4), state.doc.resolve(15))),
    );
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });

    act(() => {
        screen.getByLabelText("Bullet list").click();
    });

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("bar")]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("qux")]),
                ]),
            ])
            .toJSON(),
    );
});

test("toggles list on even when the entire list is a different type with some indentation", () => {
    setInteractionModality("pointer");

    render(
        <TestContentEditor
            initialContent={schema.node("doc", {}, [
                schema.node("orderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ]),
                schema.node("orderedListItem", {indent: 1}, [
                    schema.node("paragraph", {}, [schema.text("bar")]),
                ]),
                schema.node("orderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("qux")]),
                ]),
            ])}
        />,
    );

    act(() => {
        getTextbox().focus();
    });

    dispatch(state =>
        state.tr.setSelection(new TextSelection(state.doc.resolve(5), state.doc.resolve(17))),
    );
    act(() => {
        import.meta.jest.runOnlyPendingTimers();
    });

    act(() => {
        screen.getByLabelText("Bullet list").click();
    });

    expect(getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ]),
                schema.node("unorderedListItem", {indent: 1}, [
                    schema.node("paragraph", {}, [schema.text("bar")]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("qux")]),
                ]),
            ])
            .toJSON(),
    );
});
