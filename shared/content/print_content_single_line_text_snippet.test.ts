import {printContentSingleLineTextSnippet} from "~/shared/content/print_content_single_line_text_snippet.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {generateId} from "~/shared/id/id.js";

const schema = DocumentWithoutTitleContentProsemirrorSchema;

test("headings collapse onto the same line", () => {
    const doc = schema.node("doc", {}, [
        schema.node("heading", {level: 1}, [schema.text("This is a heading")]),
        schema.node("paragraph", {}, [schema.text("Followed by a paragraph")]),
        schema.node("heading", {level: 2}, [schema.text("This is another heading?")]),
        schema.node("paragraph", {}, [
            schema.text(
                "Except that last heading had punctuation. This paragraph ends with a colon:",
            ),
        ]),
        schema.node("heading", {level: 2}, [schema.text("And is followed by another heading.")]),
        schema.node("paragraph", {}, [
            // eslint-disable-next-line string-quotes
            schema.text('Nice. "This paragraph ends with a quote containing punctuation."'),
        ]),
        schema.node("paragraph", {}, [schema.text("No extra punctuation added")]),
    ]);

    expect(
        printContentSingleLineTextSnippet(doc, {
            getAccountIfExists: () => null,
            getSearchEntityIfExists: () => null,
            getFileIfExists: () => null,
        }),
    ).toEqual(
        // eslint-disable-next-line string-quotes
        'This is a heading: Followed by a paragraph. This is another heading? Except that last heading had punctuation. This paragraph ends with a colon: And is followed by another heading. Nice. "This paragraph ends with a quote containing punctuation." No extra punctuation added',
    );
});

test("list items collapse onto the same line", () => {
    const doc = schema.node("doc", {}, [
        schema.node("orderedListItem", {indent: 0}, [
            schema.node("paragraph", {}, [schema.text("a")]),
        ]),
        schema.node("orderedListItem", {indent: 0}, [
            schema.node("paragraph", {}, [schema.text("b")]),
        ]),
        schema.node("orderedListItem", {indent: 1}, [
            schema.node("paragraph", {}, [schema.text("b-a")]),
        ]),
        schema.node("orderedListItem", {indent: 1}, [
            schema.node("paragraph", {}, [schema.text("b-b")]),
        ]),
        schema.node("orderedListItem", {indent: 1}, [
            schema.node("paragraph", {}, [schema.text("b-c")]),
        ]),
        schema.node("unorderedListItem", {indent: 3}, [
            schema.node("paragraph", {}, [schema.text("b-c-a")]),
        ]),
        schema.node("orderedListItem", {indent: 4}, [
            schema.node("paragraph", {}, [schema.text("b-c-a-a")]),
        ]),
        schema.node("orderedListItem", {indent: 4}, [
            schema.node("paragraph", {}, [schema.text("b-c-a-b")]),
        ]),
        schema.node("unorderedListItem", {indent: 3}, [
            schema.node("paragraph", {}, [schema.text("b-c-b")]),
        ]),
        schema.node("unorderedListItem", {indent: 3}, [
            schema.node("paragraph", {}, [schema.text("b-c-c")]),
        ]),
        schema.node("unorderedListItem", {indent: 3}, [
            schema.node("paragraph", {}, [schema.text("b-c-d")]),
        ]),
        schema.node("orderedListItem", {indent: 0}, [
            schema.node("paragraph", {}, [schema.text("c")]),
        ]),
    ]);

    expect(
        printContentSingleLineTextSnippet(doc, {
            getAccountIfExists: () => null,
            getSearchEntityIfExists: () => null,
            getFileIfExists: () => null,
        }),
    ).toEqual(
        "1. a. 2. b. 1. b-a. 2. b-b. 3. b-c. b-c-a. 1. b-c-a-a. 2. b-c-a-b. b-c-b. b-c-c. b-c-d. 3. c",
    );
});

test("code block collapses onto the same line", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [schema.text("This is a code block")]),
        schema.node("codeBlock", {}, [
            schema.node("codeBlockLine", {}, [schema.text("let a = 1;")]),
            schema.node("codeBlockLine", {}, [schema.text("let b = 1;")]),
            schema.node("codeBlockLine", {}, [schema.text("let c = a + b;")]),
            schema.node("codeBlockLine", {}, [schema.text("console.log(c);")]),
        ]),
        schema.node("paragraph", {}, [schema.text("This paragraph follows the code block.")]),
    ]);

    expect(
        printContentSingleLineTextSnippet(doc, {
            getAccountIfExists: () => null,
            getSearchEntityIfExists: () => null,
            getFileIfExists: () => null,
        }),
    ).toEqual(
        "This is a code block. let a = 1; let b = 1; let c = a + b; console.log(c); This paragraph follows the code block.",
    );
});

test("code block trims indentation when collapsing onto the same line", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [schema.text("This is a code block")]),
        schema.node("codeBlock", {}, [
            schema.node("codeBlockLine", {}, [schema.text("function main() {")]),
            schema.node("codeBlockLine", {}, [schema.text("  let a = 1;")]),
            schema.node("codeBlockLine", {}, [schema.text("  let b = 1;")]),
            schema.node("codeBlockLine", {}, [schema.text("  let c = a + b;")]),
            schema.node("codeBlockLine", {}, [schema.text("  if (isDevelopmentEnvironment) {")]),
            schema.node("codeBlockLine", {}, [schema.text("    console.log(c);")]),
            schema.node("codeBlockLine", {}, [schema.text("  }")]),
            schema.node("codeBlockLine", {}, [schema.text("}")]),
        ]),
        schema.node("paragraph", {}, [schema.text("This paragraph follows the code block.")]),
    ]);

    expect(
        printContentSingleLineTextSnippet(doc, {
            getAccountIfExists: () => null,
            getSearchEntityIfExists: () => null,
        }),
    ).toEqual(
        "This is a code block. function main() { let a = 1; let b = 1; let c = a + b; if (isDevelopmentEnvironment) { console.log(c); } } This paragraph follows the code block.",
    );
});

test("code block trims tab character indentation when collapsing onto the same line", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [schema.text("This is a code block")]),
        schema.node("codeBlock", {}, [
            schema.node("codeBlockLine", {}, [schema.text("function main() {")]),
            schema.node("codeBlockLine", {}, [schema.text("\tlet a = 1;")]),
            schema.node("codeBlockLine", {}, [schema.text("\tlet b = 1;")]),
            schema.node("codeBlockLine", {}, [schema.text("\tlet c = a + b;")]),
            schema.node("codeBlockLine", {}, [schema.text("\tif (isDevelopmentEnvironment) {")]),
            schema.node("codeBlockLine", {}, [schema.text("\t\tconsole.log(c);")]),
            schema.node("codeBlockLine", {}, [schema.text("\t}")]),
            schema.node("codeBlockLine", {}, [schema.text("}")]),
        ]),
        schema.node("paragraph", {}, [schema.text("This paragraph follows the code block.")]),
    ]);

    expect(
        printContentSingleLineTextSnippet(doc, {
            getAccountIfExists: () => null,
            getSearchEntityIfExists: () => null,
        }),
    ).toEqual(
        "This is a code block. function main() { let a = 1; let b = 1; let c = a + b; if (isDevelopmentEnvironment) { console.log(c); } } This paragraph follows the code block.",
    );
});

test("code block collapses multiple lines of text onto the same line", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [schema.text("This paragraph precedes.")]),
        schema.node("codeBlock", {}, [
            schema.node("codeBlockLine", {}, [schema.text("codeBlockLine1")]),
            schema.node("codeBlockLine", {}, [schema.text("codeBlockLine2")]),
            schema.node("codeBlockLine", {}, [schema.text("codeBlockLine3")]),
        ]),
        schema.node("paragraph", {}, [
            schema.node("break"),
            schema.text("This paragraph follows."),
        ]),
    ]);
    expect(
        printContentSingleLineTextSnippet(doc, {
            getAccountIfExists: () => null,
            getSearchEntityIfExists: () => null,
            getFileIfExists: () => null,
        }),
    ).toEqual(
        "This paragraph precedes. codeBlockLine1 codeBlockLine2 codeBlockLine3 This paragraph follows.",
    );
});

test("code block with marks collapses multiple lines of text onto the same line", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [schema.text("This paragraph precedes.")]),
        schema.node("codeBlock", {}, [
            schema.node("codeBlockLine", {}, [schema.text("codeBlockLine1")]),
            schema.node("codeBlockLine", {}, [
                schema.text("code"),
                schema.text("Block", [schema.mark("bold")]),
                schema.text("Line2"),
            ]),
            schema.node("codeBlockLine", {}, [schema.text("codeBlockLine3")]),
        ]),
        schema.node("paragraph", {}, [
            schema.node("break"),
            schema.text("This paragraph follows."),
        ]),
    ]);
    expect(
        printContentSingleLineTextSnippet(doc, {
            getAccountIfExists: () => null,
            getSearchEntityIfExists: () => null,
            getFileIfExists: () => null,
        }),
    ).toEqual(
        "This paragraph precedes. codeBlockLine1 codeBlockLine2 codeBlockLine3 This paragraph follows.",
    );
});

test("quote blocks collapse onto the same line", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [schema.text("paragraph1")]),
        schema.node("quoteBlock", {}, [
            schema.node("paragraph", {}, [schema.text("paragraph2")]),
            schema.node("paragraph", {}, [schema.text("paragraph3")]),
            schema.node("unorderedListItem", {}, [
                schema.node("paragraph", {}, [schema.text("paragraph4")]),
            ]),
            schema.node("orderedListItem", {}, [
                schema.node("paragraph", {}, [schema.text("paragraph5")]),
            ]),
            schema.node("paragraph", {}, [schema.text("paragraph6")]),
        ]),
        schema.node("paragraph", {}, [schema.text("paragraph7")]),
    ]);

    expect(
        printContentSingleLineTextSnippet(doc, {
            getAccountIfExists: () => null,
            getSearchEntityIfExists: () => null,
            getFileIfExists: () => null,
        }),
    ).toEqual(
        "paragraph1. paragraph2. paragraph3. paragraph4. 1. paragraph5. paragraph6. paragraph7",
    );
});

test("breaks collapse onto the same line", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.text("foo"),
            schema.node("break"),
            schema.text("bar"),
            schema.node("break"),
        ]),
        schema.node("paragraph", {}, [
            schema.text("buz"),
            schema.node("break"),
            schema.text("qux"),
            schema.node("break"),
        ]),
    ]);

    expect(
        printContentSingleLineTextSnippet(doc, {
            getAccountIfExists: () => null,
            getSearchEntityIfExists: () => null,
            getFileIfExists: () => null,
        }),
    ).toEqual("foo bar. buz qux");
});

test("adjacent files of the same type increment a count", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [schema.text("foo")]),
        schema.node("fileRow", {}, [schema.node("file", {fileId: `Document:${generateId()}`})]),
        schema.node("fileRow", {}, [
            schema.node("file", {fileId: `Document:${generateId()}`}),
            schema.node("file", {fileId: `Document:${generateId()}`}),
            schema.node("file", {fileId: `Document:${generateId()}`}),
        ]),
        schema.node("fileRow", {}, [
            schema.node("file", {fileId: `Document:${generateId()}`}),
            schema.node("file", {fileId: `Channel:${generateId()}`}),
            schema.node("file", {fileId: `Document:${generateId()}`}),
        ]),
        schema.node("fileRow", {}, [schema.node("file", {fileId: `Document:${generateId()}`})]),
        schema.node("paragraph", {}, [schema.text("bar")]),
        schema.node("fileRow", {}, [schema.node("file", {fileId: `Document:${generateId()}`})]),
    ]);

    expect(
        printContentSingleLineTextSnippet(doc, {
            getAccountIfExists: () => null,
            getSearchEntityIfExists: () => null,
            getFileIfExists: () => null,
        }),
    ).toEqual(
        "foo. Document. Document 2. Document 3. Document 4. Document 5. Channel. Document. Document 2. bar. Document",
    );
});

test("prints a table top to bottom, left to right", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [schema.text("foo")]),
        schema.node("table", {}, [
            schema.node("tableRow", {}, [
                schema.node("tableCell", {}, [schema.node("paragraph", {}, [schema.text("a1")])]),
                schema.node("tableCell", {}, [schema.node("paragraph", {}, [schema.text("b1")])]),
                schema.node("tableCell", {}, [schema.node("paragraph", {}, [schema.text("c1")])]),
            ]),
            schema.node("tableRow", {}, [
                schema.node("tableCell", {}, [schema.node("paragraph", {}, [schema.text("a2")])]),
                schema.node("tableCell", {}, [schema.node("paragraph", {}, [schema.text("b2")])]),
                schema.node("tableCell", {}, [schema.node("paragraph", {}, [schema.text("c2")])]),
            ]),
            schema.node("tableRow", {}, [
                schema.node("tableCell", {}, [schema.node("paragraph", {}, [schema.text("a3")])]),
                schema.node("tableCell", {}, [schema.node("paragraph", {}, [schema.text("b3")])]),
                schema.node("tableCell", {}, [schema.node("paragraph", {}, [schema.text("c3")])]),
            ]),
        ]),
        schema.node("paragraph", {}, [schema.text("bar")]),
    ]);

    expect(
        printContentSingleLineTextSnippet(doc, {
            getAccountIfExists: () => null,
            getSearchEntityIfExists: () => null,
            getFileIfExists: () => null,
        }),
    ).toEqual("foo. a1. b1. c1. a2. b2. c2. a3. b3. c3. bar");
});
