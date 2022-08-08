import {render, screen} from "@testing-library/react";
import {Mark, Node} from "prosemirror-model";
import React from "react";
import {ContentEditor, ContentEditorState} from "~/client/content/content-editor";
import {ContentSchema} from "~/shared/content/content-schema";

const blockTestCases: Array<{
    name: string;
    disableContentTests?: boolean;
    disableInlineTests?: boolean;
    build: (content: Array<Node>) => Node;
}> = [
    {
        name: "paragraph",
        build: content => ContentSchema.node("paragraph", {}, content),
    },
    {
        name: "heading 1",
        build: content => ContentSchema.node("heading", {level: 1}, content),
    },
    {
        name: "heading 2",
        build: content => ContentSchema.node("heading", {level: 2}, content),
    },
    {
        name: "heading 3",
        build: content => ContentSchema.node("heading", {level: 3}, content),
    },
    {
        name: "quote",
        build: content =>
            ContentSchema.node("quoteBlock", {}, ContentSchema.node("paragraph", {}, content)),
    },
    {
        name: "code",
        disableInlineTests: true,
        build: content => ContentSchema.node("codeBlock", {}, content),
    },
    {
        name: "divider",
        disableContentTests: true,
        build: content => ContentSchema.node("divider", {}, content),
    },
    {
        name: "bullet list",
        build: content =>
            ContentSchema.node("bulletListItem", {}, [
                ContentSchema.node("paragraph", {}, content),
            ]),
    },
    {
        name: "ordered list",
        build: content =>
            ContentSchema.node("orderedListItem", {}, [
                ContentSchema.node("paragraph", {}, content),
            ]),
    },
    {
        name: "check list (unchecked)",
        build: content =>
            ContentSchema.node(
                "checkListItem",
                {checked: false},
                ContentSchema.node("paragraph", {}, content),
            ),
    },
    {
        name: "check list (checked)",
        build: content =>
            ContentSchema.node(
                "checkListItem",
                {checked: true},
                ContentSchema.node("paragraph", {}, content),
            ),
    },
];

const inlineTestCases: Array<{
    name: string;
    build: () => Mark;
}> = [
    {
        name: "bold",
        build: () => ContentSchema.mark("bold"),
    },
    {
        name: "italic",
        build: () => ContentSchema.mark("italic"),
    },
    {
        name: "strike",
        build: () => ContentSchema.mark("strike"),
    },
    {
        name: "code",
        build: () => ContentSchema.mark("code"),
    },
    {
        name: "highlight",
        build: () => ContentSchema.mark("highlight", {color: "green"}),
    },
    {
        name: "link",
        build: () => ContentSchema.mark("link", {url: "https://example.com"}),
    },
    {
        name: "link (XSS vulnerability)",
        build: () => ContentSchema.mark("link", {url: "javascript:alert('XSS')"}), // eslint-disable-line no-script-url
    },
];

for (const blockTestCase of blockTestCases) {
    test(`${blockTestCase.name} empty`, () => {
        const content = ContentSchema.node("doc", {}, [blockTestCase.build([])]);
        render(
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create(content)}
                onChange={() => {}}
            />,
        );

        expect(screen.getByRole("textbox")).toHaveTextContent("");

        if (blockTestCase.disableContentTests) {
            expect(screen.getByRole("textbox")).toMatchSnapshot();
        }
    });

    if (blockTestCase.disableContentTests) {
        continue;
    }

    test(`${blockTestCase.name} plain`, () => {
        const content = ContentSchema.node("doc", {}, [
            blockTestCase.build([ContentSchema.text("Hello world!")]),
        ]);
        render(
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create(content)}
                onChange={() => {}}
            />,
        );

        expect(screen.getByRole("textbox")).toHaveTextContent("Hello world!");
        expect(screen.getByRole("textbox")).toMatchSnapshot();
    });

    if (blockTestCase.disableInlineTests) {
        continue;
    }

    for (const inlineTestCase of inlineTestCases) {
        test(`${blockTestCase.name} ${inlineTestCase.name}`, () => {
            const content = ContentSchema.node("doc", {}, [
                blockTestCase.build([
                    ContentSchema.text("Hello "),
                    ContentSchema.text("world", [inlineTestCase.build()]),
                    ContentSchema.text("!"),
                ]),
            ]);
            render(
                <ContentEditor
                    aria-label="Test"
                    state={ContentEditorState.create(content)}
                    onChange={() => {}}
                />,
            );

            expect(screen.getByRole("textbox")).toHaveTextContent("Hello world!");
        });
    }
}

for (const inlineTestCase of inlineTestCases) {
    test(`${inlineTestCase.name}`, () => {
        const content = ContentSchema.node("doc", {}, [
            ContentSchema.node("paragraph", {}, [
                ContentSchema.text("Hello "),
                ContentSchema.text("world", [inlineTestCase.build()]),
                ContentSchema.text("!"),
            ]),
        ]);
        render(
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create(content)}
                onChange={() => {}}
            />,
        );

        expect(screen.getByRole("textbox")).toHaveTextContent("Hello world!");
        expect(screen.getByRole("textbox")).toMatchSnapshot();
    });
}

test("heading cannot have a level lower than 1", () => {
    const {rerender} = render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(
                ContentSchema.node("doc", {}, [
                    ContentSchema.node("heading", {level: 0}, [ContentSchema.text("Test")]),
                ]),
            )}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h2");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(
                ContentSchema.node("doc", {}, [
                    ContentSchema.node("heading", {level: -42}, [ContentSchema.text("Test")]),
                ]),
            )}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h2");
});

test("heading cannot have a level greater than 3", () => {
    const {rerender} = render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(
                ContentSchema.node("doc", {}, [
                    ContentSchema.node("heading", {level: 4}, [ContentSchema.text("Test")]),
                ]),
            )}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h4");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(
                ContentSchema.node("doc", {}, [
                    ContentSchema.node("heading", {level: 42}, [ContentSchema.text("Test")]),
                ]),
            )}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h4");
});

test("heading cannot be the wrong type", () => {
    const {rerender} = render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(
                ContentSchema.node("doc", {}, [
                    ContentSchema.node("heading", {level: ""}, [ContentSchema.text("Test")]),
                ]),
            )}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h2");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(
                ContentSchema.node("doc", {}, [
                    ContentSchema.node("heading", {level: "secondary"}, [
                        ContentSchema.text("Test"),
                    ]),
                ]),
            )}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h2");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(
                ContentSchema.node("doc", {}, [
                    ContentSchema.node("heading", {level: true}, [ContentSchema.text("Test")]),
                ]),
            )}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h2");
});

test("heading is converted into an integer", () => {
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(
                ContentSchema.node("doc", {}, [
                    ContentSchema.node("heading", {level: 2.5}, [ContentSchema.text("Test")]),
                ]),
            )}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h3");
});

test("link with a non-HTTP scheme is blocked", () => {
    const {rerender} = render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(
                ContentSchema.node("doc", {}, [
                    ContentSchema.node("paragraph", {}, [
                        ContentSchema.text("Test", [
                            // eslint-disable-next-line no-script-url
                            ContentSchema.mark("link", {url: "javascript:alert('XSS')"}),
                        ]),
                    ]),
                ]),
            )}
            onChange={() => {}}
        />,
    );

    expect((screen.getByRole("link") as HTMLAnchorElement).href).toEqual("about:blank#blocked");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(
                ContentSchema.node("doc", {}, [
                    ContentSchema.node("paragraph", {}, [
                        ContentSchema.text("Test", [
                            ContentSchema.mark("link", {
                                url: "file:///Users/calebmer/cyberworlds/package.json",
                            }),
                        ]),
                    ]),
                ]),
            )}
            onChange={() => {}}
        />,
    );

    expect((screen.getByRole("link") as HTMLAnchorElement).href).toEqual("about:blank#blocked");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(
                ContentSchema.node("doc", {}, [
                    ContentSchema.node("paragraph", {}, [
                        ContentSchema.text("Test", [
                            ContentSchema.mark("link", {url: "tel:+123456789"}),
                        ]),
                    ]),
                ]),
            )}
            onChange={() => {}}
        />,
    );

    expect((screen.getByRole("link") as HTMLAnchorElement).href).toEqual("about:blank#blocked");
});

test("bullet list with multiple items", () => {
    const content = ContentSchema.node("doc", {}, [
        ContentSchema.node(
            "bulletListItem",
            {indent: 0},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 1")),
        ),
        ContentSchema.node(
            "bulletListItem",
            {indent: 0},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 2")),
        ),
        ContentSchema.node(
            "bulletListItem",
            {indent: 0},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(content)}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();
});

test("ordered list with multiple items", () => {
    const content = ContentSchema.node("doc", {}, [
        ContentSchema.node(
            "orderedListItem",
            {},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 1")),
        ),
        ContentSchema.node(
            "orderedListItem",
            {},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 2")),
        ),
        ContentSchema.node(
            "orderedListItem",
            {},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(content)}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();
});

test("check list with multiple items", () => {
    const content = ContentSchema.node("doc", {}, [
        ContentSchema.node(
            "checkListItem",
            {checked: true},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 1")),
        ),
        ContentSchema.node(
            "checkListItem",
            {checked: false},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 2")),
        ),
        ContentSchema.node(
            "checkListItem",
            {checked: true},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(content)}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();
});

test("bullet list with sub-list", () => {
    const content = ContentSchema.node("doc", {}, [
        ContentSchema.node(
            "bulletListItem",
            {indent: 0},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Test")),
        ),
        ContentSchema.node(
            "bulletListItem",
            {indent: 1},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 1")),
        ),
        ContentSchema.node(
            "bulletListItem",
            {indent: 1},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 2")),
        ),
        ContentSchema.node(
            "bulletListItem",
            {indent: 1},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(content)}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();
});

test("ordered list with sub-list", () => {
    const content = ContentSchema.node("doc", {}, [
        ContentSchema.node(
            "orderedListItem",
            {indent: 0},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Test")),
        ),
        ContentSchema.node(
            "orderedListItem",
            {indent: 1},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 1")),
        ),
        ContentSchema.node(
            "orderedListItem",
            {indent: 1},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 2")),
        ),
        ContentSchema.node(
            "orderedListItem",
            {indent: 1},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(content)}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();
});

test("check list with sub-list", () => {
    const content = ContentSchema.node("doc", {}, [
        ContentSchema.node(
            "checkListItem",
            {indent: 0, checked: true},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Test")),
        ),
        ContentSchema.node(
            "checkListItem",
            {indent: 1, checked: true},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 1")),
        ),
        ContentSchema.node(
            "checkListItem",
            {indent: 1, checked: false},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 2")),
        ),
        ContentSchema.node(
            "checkListItem",
            {indent: 1, checked: true},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(content)}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();
});

test("bullet list with sub-list of another type", () => {
    const content = ContentSchema.node("doc", {}, [
        ContentSchema.node(
            "bulletListItem",
            {indent: 0},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Test")),
        ),
        ContentSchema.node(
            "orderedListItem",
            {indent: 1},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 1")),
        ),
        ContentSchema.node(
            "orderedListItem",
            {indent: 1},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 2")),
        ),
        ContentSchema.node(
            "orderedListItem",
            {indent: 1},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(content)}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();
});

test("ordered list with sub-list of another type", () => {
    const content = ContentSchema.node("doc", {}, [
        ContentSchema.node(
            "orderedListItem",
            {indent: 0},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Test")),
        ),
        ContentSchema.node(
            "checkListItem",
            {indent: 1, checked: true},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 1")),
        ),
        ContentSchema.node(
            "checkListItem",
            {indent: 1, checked: false},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 2")),
        ),
        ContentSchema.node(
            "checkListItem",
            {indent: 1, checked: true},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(content)}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();
});

test("check list with sub-list of another type", () => {
    const content = ContentSchema.node("doc", {}, [
        ContentSchema.node(
            "checkListItem",
            {indent: 0, checked: true},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Test")),
        ),
        ContentSchema.node(
            "orderedListItem",
            {indent: 1},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 1")),
        ),
        ContentSchema.node(
            "orderedListItem",
            {indent: 1},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 2")),
        ),
        ContentSchema.node(
            "orderedListItem",
            {indent: 1},
            ContentSchema.node("paragraph", {}, ContentSchema.text("Item 3")),
        ),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(content)}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();
});

test("can put hard breaks inside paragraphs", () => {
    const content = ContentSchema.node("doc", {}, [
        ContentSchema.node("paragraph", {}, [
            ContentSchema.text("Hello…"),
            ContentSchema.node("break"),
            ContentSchema.text("…world!"),
        ]),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(content)}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();
});

test("can put hard breaks inside list items", () => {
    const content = ContentSchema.node("doc", {}, [
        ContentSchema.node("bulletListItem", {}, [
            ContentSchema.node("paragraph", {}, [
                ContentSchema.text("Hello…"),
                ContentSchema.node("break"),
                ContentSchema.text("…world!"),
            ]),
        ]),
    ]);
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create(content)}
            onChange={() => {}}
        />,
    );

    expect(screen.getByRole("textbox")).toMatchSnapshot();
});
