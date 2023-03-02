import {fireEvent, render, screen} from "@testing-library/react";
import {Mark, Node} from "prosemirror-model";
import {useState} from "react";
import {ContentEditor, getEditorViewForTest} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {
    DocumentWithoutTitleContentProsemirrorSchema,
    emptyDocumentWithoutTitleContent,
} from "~/shared/content/document_content_schema";
import {UnimplementedError} from "~/shared/error/error";
import {emptyContentReferences} from "~/shared/models/content_references";

const schema = DocumentWithoutTitleContentProsemirrorSchema;

const blockTestCases: Array<{
    name: string;
    disableContentTests?: boolean;
    disableInlineTests?: boolean;
    build: (content: Array<Node>) => Node;
}> = [
    {
        name: "paragraph",
        build: content => schema.node("paragraph", {}, content),
    },
    {
        name: "heading 1",
        build: content => schema.node("heading", {level: 1}, content),
    },
    {
        name: "heading 2",
        build: content => schema.node("heading", {level: 2}, content),
    },
    {
        name: "heading 3",
        build: content => schema.node("heading", {level: 3}, content),
    },
    {
        name: "quote",
        build: content => schema.node("quoteBlock", {}, schema.node("paragraph", {}, content)),
    },
    {
        name: "code",
        disableInlineTests: true,
        build: content => schema.node("codeBlock", {}, content),
    },
    {
        name: "divider",
        disableContentTests: true,
        build: content => schema.node("divider", {}, content),
    },
    {
        name: "bullet list",
        build: content =>
            schema.node("unorderedListItem", {}, [schema.node("paragraph", {}, content)]),
    },
    {
        name: "ordered list",
        build: content =>
            schema.node("orderedListItem", {}, [schema.node("paragraph", {}, content)]),
    },
    {
        name: "check list (unchecked)",
        build: content =>
            schema.node("checkListItem", {checked: false}, schema.node("paragraph", {}, content)),
    },
    {
        name: "check list (checked)",
        build: content =>
            schema.node("checkListItem", {checked: true}, schema.node("paragraph", {}, content)),
    },
];

const inlineTestCases: Array<{
    name: string;
    disableClipboardTests?: boolean;
    build: () => Mark;
}> = [
    {
        name: "bold",
        build: () => schema.mark("bold"),
    },
    {
        name: "italic",
        build: () => schema.mark("italic"),
    },
    {
        name: "strike",
        build: () => schema.mark("strike"),
    },
    {
        name: "code",
        build: () => schema.mark("code"),
    },
    {
        name: "highlight",
        build: () => schema.mark("highlight", {color: "green"}),
    },
    {
        name: "link",
        build: () => schema.mark("link", {url: "https://example.com/"}),
    },
    {
        name: "link (XSS vulnerability)",
        disableClipboardTests: true,
        build: () => schema.mark("link", {url: "javascript:alert('XSS')"}), // eslint-disable-line no-script-url
    },
];

function cantNavigate() {
    throw new UnimplementedError("Can not navigate in test");
}

for (const blockTestCase of blockTestCases) {
    test(`${blockTestCase.name} empty`, () => {
        const content = schema.node("doc", {}, [blockTestCase.build([])]);
        render(
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({
                    doc: content,
                    references: emptyContentReferences,
                })}
                onChange={() => {}}
                onNavigate={cantNavigate}
            />,
        );

        expect(screen.getByRole("textbox")).toHaveTextContent("");

        if (blockTestCase.disableContentTests) {
            expect(screen.getByRole("textbox")).toMatchSnapshot();
        }

        expectClipboardRoundtripToWork();
    });

    if (blockTestCase.disableContentTests) {
        continue;
    }

    test(`${blockTestCase.name} plain`, () => {
        const content = schema.node("doc", {}, [
            blockTestCase.build([schema.text("Hello world!")]),
        ]);
        render(
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({
                    doc: content,
                    references: emptyContentReferences,
                })}
                onChange={() => {}}
                onNavigate={cantNavigate}
            />,
        );

        expect(screen.getByRole("textbox")).toHaveTextContent("Hello world!");
        expect(screen.getByRole("textbox")).toMatchSnapshot();

        expectClipboardRoundtripToWork();
    });

    if (blockTestCase.disableInlineTests) {
        continue;
    }

    for (const inlineTestCase of inlineTestCases) {
        test(`${blockTestCase.name} ${inlineTestCase.name}`, () => {
            const content = schema.node("doc", {}, [
                blockTestCase.build([
                    schema.text("Hello "),
                    schema.text("world", [inlineTestCase.build()]),
                    schema.text("!"),
                ]),
            ]);
            render(
                <ContentEditor
                    aria-label="Test"
                    state={ContentEditorState.create({
                        doc: content,
                        references: emptyContentReferences,
                    })}
                    onChange={() => {}}
                    onNavigate={cantNavigate}
                />,
            );

            expect(screen.getByRole("textbox")).toHaveTextContent("Hello world!");

            if (!inlineTestCase.disableClipboardTests) {
                expectClipboardRoundtripToWork();
            }
        });
    }
}

for (const inlineTestCase of inlineTestCases) {
    test(`${inlineTestCase.name}`, () => {
        const content = schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("Hello "),
                schema.text("world", [inlineTestCase.build()]),
                schema.text("!"),
            ]),
        ]);
        render(
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({
                    doc: content,
                    references: emptyContentReferences,
                })}
                onChange={() => {}}
                onNavigate={cantNavigate}
            />,
        );

        expect(screen.getByRole("textbox")).toHaveTextContent("Hello world!");
        expect(screen.getByRole("textbox")).toMatchSnapshot();

        if (!inlineTestCase.disableClipboardTests) {
            expectClipboardRoundtripToWork();
        }
    });
}

function expectClipboardRoundtripToWork() {
    // eslint-disable-next-line testing-library/no-node-access
    const editor = getEditorViewForTest(screen.getByRole("textbox").parentNode);

    const copiedDoc = editor.state.doc;
    const copiedFragment = editor.props.clipboardSerializer!.serializeFragment(copiedDoc.content);
    const copiedElement = document.createElement("div");
    copiedElement.appendChild(copiedFragment);
    const copiedHtml = copiedElement.innerHTML;

    expect(copiedElement).toMatchSnapshot("clipboard");

    function TestContentEditor() {
        const [state, setState] = useState(() =>
            ContentEditorState.create({
                doc: emptyDocumentWithoutTitleContent,
                references: emptyContentReferences,
            }),
        );
        return (
            <ContentEditor
                aria-label="Test"
                state={state}
                onChange={setState}
                onNavigate={cantNavigate}
            />
        );
    }

    const {container, unmount} = render(<TestContentEditor />);

    // eslint-disable-next-line testing-library/no-node-access
    fireEvent.paste(container.firstElementChild!.firstElementChild!, {
        clipboardData: {
            getData: (type: string) => {
                return type === "text/html" ? copiedHtml : null;
            },
        },
    });

    // eslint-disable-next-line testing-library/no-node-access
    const pastedDoc = getEditorViewForTest(container.firstElementChild!).state.doc;

    expect(pastedDoc.toString()).toEqual(copiedDoc.toString());

    // The string representation of a doc doesn't include all attributes. So do a
    // full JSON equality test as well.
    expect(pastedDoc.toJSON()).toEqual(copiedDoc.toJSON());

    unmount();
}

test("heading cannot have a level lower than 1", () => {
    const {rerender} = render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: 0}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h2");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: -42}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h2");
});

test("heading cannot have a level greater than 3", () => {
    const {rerender} = render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: 4}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h4");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: 42}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h4");
});

test("heading cannot be the wrong type", () => {
    const {rerender} = render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: ""}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h2");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: "secondary"}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h2");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: true}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h2");
});

test("heading is converted into an integer", () => {
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: 2.5}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h3");
});

test("link with a non-HTTP scheme is blocked", () => {
    const {rerender} = render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Test", [
                            schema.mark("link", {
                                // eslint-disable-next-line no-script-url
                                url: "javascript:alert('XSS')",
                            }),
                        ]),
                    ]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole<HTMLAnchorElement>("link").href).toEqual("about:blank#blocked");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Test", [
                            schema.mark("link", {
                                url: "file:///Users/calebmer/cyberworlds/package.json",
                            }),
                        ]),
                    ]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole<HTMLAnchorElement>("link").href).toEqual("about:blank#blocked");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Test", [schema.mark("link", {url: "tel:+123456789"})]),
                    ]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole<HTMLAnchorElement>("link").href).toEqual("about:blank#blocked");
});

test("bullet list with multiple items", () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "unorderedListItem",
            {indent: 0},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "unorderedListItem",
            {indent: 0},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "unorderedListItem",
            {indent: 0},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();

    expectClipboardRoundtripToWork();
});

test("ordered list with multiple items", () => {
    const content = schema.node("doc", {}, [
        schema.node("orderedListItem", {}, schema.node("paragraph", {}, schema.text("Item 1"))),
        schema.node("orderedListItem", {}, schema.node("paragraph", {}, schema.text("Item 2"))),
        schema.node("orderedListItem", {}, schema.node("paragraph", {}, schema.text("Item 3"))),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();

    expectClipboardRoundtripToWork();
});

test("check list with multiple items", () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "checkListItem",
            {checked: true},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "checkListItem",
            {checked: false},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "checkListItem",
            {checked: true},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();

    expectClipboardRoundtripToWork();
});

test("bullet list with sub-list", () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "unorderedListItem",
            {indent: 0},
            schema.node("paragraph", {}, schema.text("Test")),
        ),
        schema.node(
            "unorderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "unorderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "unorderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();

    expectClipboardRoundtripToWork();
});

test("ordered list with sub-list", () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "orderedListItem",
            {indent: 0},
            schema.node("paragraph", {}, schema.text("Test")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();

    expectClipboardRoundtripToWork();
});

test("check list with sub-list", () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "checkListItem",
            {indent: 0, checked: true},
            schema.node("paragraph", {}, schema.text("Test")),
        ),
        schema.node(
            "checkListItem",
            {indent: 1, checked: true},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "checkListItem",
            {indent: 1, checked: false},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "checkListItem",
            {indent: 1, checked: true},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();

    expectClipboardRoundtripToWork();
});

test("bullet list with sub-list of another type", () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "unorderedListItem",
            {indent: 0},
            schema.node("paragraph", {}, schema.text("Test")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();

    expectClipboardRoundtripToWork();
});

test("ordered list with sub-list of another type", () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "orderedListItem",
            {indent: 0},
            schema.node("paragraph", {}, schema.text("Test")),
        ),
        schema.node(
            "checkListItem",
            {indent: 1, checked: true},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "checkListItem",
            {indent: 1, checked: false},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "checkListItem",
            {indent: 1, checked: true},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();

    expectClipboardRoundtripToWork();
});

test("check list with sub-list of another type", () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "checkListItem",
            {indent: 0, checked: true},
            schema.node("paragraph", {}, schema.text("Test")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();

    expectClipboardRoundtripToWork();
});

test("can put hard breaks inside paragraphs", () => {
    const content = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.text("Hello…"),
            schema.node("break"),
            schema.text("…world!"),
        ]),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();

    expectClipboardRoundtripToWork();
});

test("can put hard breaks inside list items", () => {
    const content = schema.node("doc", {}, [
        schema.node("unorderedListItem", {}, [
            schema.node("paragraph", {}, [
                schema.text("Hello…"),
                schema.node("break"),
                schema.text("…world!"),
            ]),
        ]),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();

    expectClipboardRoundtripToWork();
});

test("can put multiple paragraphs inside list items", () => {
    const content = schema.node("doc", {}, [
        schema.node("unorderedListItem", {}, [
            schema.node("paragraph", {}, [schema.text("Hello…")]),
            schema.node("paragraph", {}, [schema.text("…world!")]),
        ]),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            onNavigate={cantNavigate}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();

    expectClipboardRoundtripToWork();
});
