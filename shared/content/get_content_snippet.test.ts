import {Node} from "prosemirror-model";
import {
    getContentSnippet,
    setDefaultMaxLineGraphemeCountForTest,
} from "~/shared/content/get_content_snippet.js";
import {DocumentWithoutTitleContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {FileId} from "~/shared/id/types/id_types.js";

// NOTE(calebmer): These tests were written with the constant 237. Instead of
// updating the tests to work with the new constant I'm hardcoding the old one
// for now.
setDefaultMaxLineGraphemeCountForTest(237);

const node = schema.node.bind(schema);
const mark = schema.mark.bind(schema);
const text = schema.text.bind(schema);

function expectSnippet(
    {pos, lines}: {pos: number; lines: number},
    sourceNode: Node,
    expectedNode: Node,
) {
    expect(
        getContentSnippet(
            sourceNode.resolve(
                pos >= 0
                    ? Number.isInteger(pos)
                        ? pos
                        : Math.floor((sourceNode.nodeSize - 2) * pos)
                    : sourceNode.nodeSize - 1 - pos * -1,
            ),
            lines,
        ).toJSON(),
    ).toEqual(expectedNode.toJSON());
}

test("snips nothing at the start from an empty doc", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [node("paragraph", {}, [])]),
        node("doc", {}, [node("paragraph", {}, [])]),
    );
});

test("snips nothing at the end from an empty doc", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [node("paragraph", {}, [])]),
        node("doc", {}, [node("paragraph", {}, [])]),
    );
});

test("snips a single line at the start from a short paragraph", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
        ]),
    );
});

test("snips a single line at the start from a single paragraph", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend",
                ),
            ]),
        ]),
    );
});

test("snips a single line at the start of a single paragraph with marks", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend",
                ),
            ]),
        ]),
    );
});

test("snips a single line at the start from multiple paragraphs", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend",
                ),
            ]),
        ]),
    );
});

test("snips a single line at the start from multiple short paragraphs", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
            node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
        ]),
    );
});

test("snips a single line at the end from a short paragraph", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
        ]),
    );
});

test("snips a single line at the end from a single paragraph", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
    );
});

test("snips a single line at the end of a single paragraph with marks", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
    );
});

test("snips a single line at the end from multiple paragraphs", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
    );
});

test("snips a single line at the end from multiple short paragraphs", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
            node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
            node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
        ]),
    );
});

test("snips multiple lines at the start from a short paragraph", () => {
    expectSnippet(
        {pos: 0, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
        ]),
    );
});

test("snips multiple lines at the start from a single paragraph", () => {
    expectSnippet(
        {pos: 0, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas",
                ),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
    );
});

test("snips multiple lines from the start of a single paragraph", () => {
    expectSnippet(
        {pos: 0, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor",
                ),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
    );
});

test("snips multiple lines at the start from multiple paragraphs", () => {
    expectSnippet(
        {pos: 0, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas",
                ),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
    );
});

test("snips multiple lines at the start from multiple short paragraphs", () => {
    expectSnippet(
        {pos: 0, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
            node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
        ]),
    );
});

test("snips multiple lines at the end from a short paragraph", () => {
    expectSnippet(
        {pos: -1, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
        ]),
    );
});

test("snips multiple lines at the end from a single paragraph", () => {
    expectSnippet(
        {pos: -1, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
    );

    expectSnippet(
        {pos: -1, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
    );
});

test("snips multiple lines from the end of a single paragraph", () => {
    expectSnippet(
        {pos: -1, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
    );

    expectSnippet(
        {pos: -1, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
    );
});

test("snips multiple lines at the end from multiple paragraphs", () => {
    expectSnippet(
        {pos: -1, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
    );

    expectSnippet(
        {pos: -1, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
    );
});

test("snips multiple lines at the end from multiple short paragraphs", () => {
    expectSnippet(
        {pos: -1, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
            node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
            node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
        ]),
    );
});

test("snips a single line in the middle of a short paragraph", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
        ]),
    );
});

test("snips a single line in the middle of a single paragraph", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam",
                ),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 0.1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames",
                ),
            ]),
        ]),
    );
});

test("snips a single line in the middle of a single paragraph with marks", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 0.1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames",
                ),
            ]),
        ]),
    );
});

test("snips a single line in the middle of a single paragraph with marks and doesn’t treat mentions as line breaks", () => {
    const accountId1 = generateId();
    const accountId2 = generateId();

    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                node("mention", {mention: {accountId: accountId1}}),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                node("mention", {mention: {accountId: accountId2}}),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                node("mention", {mention: {accountId: accountId1}}),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                node("mention", {mention: {accountId: accountId2}}),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 0.1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                node("mention", {mention: {accountId: accountId1}}),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                node("mention", {mention: {accountId: accountId2}}),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                node("mention", {mention: {accountId: accountId1}}),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                node("mention", {mention: {accountId: accountId2}}),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames",
                ),
            ]),
        ]),
    );
});

test("snips a single line in the middle of multiple paragraphs", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor.",
                ),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.6, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos",
                ),
            ]),
        ]),
    );
});

test("snips a single line in the middle of multiple paragraphs ignoring `fileFloat`s", () => {
    const file1Id = generateChronologicalId<FileId>();
    const file2Id = generateChronologicalId<FileId>();
    const file3Id = generateChronologicalId<FileId>();
    const file4Id = generateChronologicalId<FileId>();
    const file5Id = generateChronologicalId<FileId>();
    const file6Id = generateChronologicalId<FileId>();

    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file1Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file2Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file3Id})]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file4Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file5Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file6Id})]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file1Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file2Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file3Id})]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor.",
                ),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.6, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file1Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file2Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file3Id})]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file4Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file5Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file6Id})]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos",
                ),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.7, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file1Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file2Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file3Id})]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file4Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file5Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file6Id})]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file4Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file5Id})]),
            node("fileFloat", {direction: "right"}, [node("file", {fileId: file6Id})]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo",
                ),
            ]),
        ]),
    );
});

test("snips a single line in the middle of multiple short paragraphs", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
            node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
        ]),
    );
});

test("snips multiple lines in the middle of a short paragraph", () => {
    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
        ]),
    );
});

test("snips multiple lines in the middle of a single paragraph", () => {
    expectSnippet(
        {pos: 0.5, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
    );
});

test("snips multiple lines in the middle of a single paragraph with marks", () => {
    expectSnippet(
        {pos: 0.5, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                text(
                    "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
        ]),
    );
});

test("snips multiple lines in the middle of multiple paragraphs", () => {
    expectSnippet(
        {pos: 0.5, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos",
                ),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                ),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                ),
            ]),
            node("paragraph", {}, [
                text(
                    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo",
                ),
            ]),
        ]),
    );
});

test("snips multiple lines in the middle of multiple short paragraphs", () => {
    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
            node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
            node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
        ]),
    );
});

test("snips a single line at the start from a short paragraph (with blockquote)", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
        ]),
    );
});

test("snips a single line at the start from a single paragraph (with blockquote)", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips a single line at the start of a single paragraph with marks (with blockquote)", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips a single line at the start from multiple paragraphs (with blockquote)", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips a single line at the start from multiple short paragraphs (with blockquote)", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
        ]),
    );
});

test("snips a single line at the end from a short paragraph (with blockquote)", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips a single line at the end from a single paragraph (with blockquote)", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips a single line at the end of a single paragraph with marks (with blockquote)", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips a single line at the end from multiple paragraphs (with blockquote)", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips a single line at the end from multiple short paragraphs (with blockquote)", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines at the start from a short paragraph (with blockquote)", () => {
    expectSnippet(
        {pos: 0, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines at the start from a single paragraph (with blockquote)", () => {
    expectSnippet(
        {pos: 0, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend",
                    ),
                ]),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips multiple lines from the start of a single paragraph (with blockquote)", () => {
    expectSnippet(
        {pos: 0, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend",
                    ),
                ]),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips multiple lines at the start from multiple paragraphs (with blockquote)", () => {
    expectSnippet(
        {pos: 0, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend",
                    ),
                ]),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips multiple lines at the start from multiple short paragraphs (with blockquote)", () => {
    expectSnippet(
        {pos: 0, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
            ]),
        ]),
    );
});

test("snips multiple lines at the end from a short paragraph (with blockquote)", () => {
    expectSnippet(
        {pos: -1, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines at the end from a single paragraph (with blockquote)", () => {
    expectSnippet(
        {pos: -1, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );

    expectSnippet(
        {pos: -1, lines: 3},
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines from the end of a single paragraph (with blockquote)", () => {
    expectSnippet(
        {pos: -1, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );

    expectSnippet(
        {pos: -1, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines at the end from multiple paragraphs (with blockquote)", () => {
    expectSnippet(
        {pos: -1, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );

    expectSnippet(
        {pos: -1, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines at the end from multiple short paragraphs (with blockquote)", () => {
    expectSnippet(
        {pos: -1, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips a single line in the middle of a short paragraph (with blockquote)", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips a single line in the middle of a single paragraph (with blockquote)", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam",
                    ),
                ]),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 0.1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips a single line in the middle of a single paragraph with marks (with blockquote)", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 0.1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips a single line in the middle of multiple paragraphs (with blockquote)", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor.",
                    ),
                ]),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.6, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips a single line in the middle of multiple short paragraphs (with blockquote)", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
            ]),
        ]),
    );
});

test("snips multiple lines in the middle of a short paragraph (with blockquote)", () => {
    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines in the middle of a single paragraph (with blockquote)", () => {
    expectSnippet(
        {pos: 0.5, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines in the middle of a single paragraph with marks (with blockquote)", () => {
    expectSnippet(
        {pos: 0.5, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines in the middle of multiple paragraphs (with blockquote)", () => {
    expectSnippet(
        {pos: 0.5, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos",
                    ),
                ]),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips multiple lines in the middle of multiple short paragraphs (with blockquote)", () => {
    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("quoteBlock", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips a single line at the start from a short paragraph (with list item)", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
        ]),
    );
});

test("snips a single line at the start from a single paragraph (with list item)", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips a single line at the start of a single paragraph with marks (with list item)", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips a single line at the start from multiple paragraphs (with list item)", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips a single line at the start from multiple short paragraphs (with list item)", () => {
    expectSnippet(
        {pos: 0, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
        ]),
    );
});

test("snips a single line at the end from a short paragraph (with list item)", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips a single line at the end from a single paragraph (with list item)", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips a single line at the end of a single paragraph with marks (with list item)", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips a single line at the end from multiple paragraphs (with list item)", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips a single line at the end from multiple short paragraphs (with list item)", () => {
    expectSnippet(
        {pos: -1, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines at the start from a short paragraph (with list item)", () => {
    expectSnippet(
        {pos: 0, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines at the start from a single paragraph (with list item)", () => {
    expectSnippet(
        {pos: 0, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend",
                    ),
                ]),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips multiple lines from the start of a single paragraph (with list item)", () => {
    expectSnippet(
        {pos: 0, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend",
                    ),
                ]),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips multiple lines at the start from multiple paragraphs (with list item)", () => {
    expectSnippet(
        {pos: 0, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend",
                    ),
                ]),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips multiple lines at the start from multiple short paragraphs (with list item)", () => {
    expectSnippet(
        {pos: 0, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
            ]),
        ]),
    );
});

test("snips multiple lines at the end from a short paragraph (with list item)", () => {
    expectSnippet(
        {pos: -1, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines at the end from a single paragraph (with list item)", () => {
    expectSnippet(
        {pos: -1, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );

    expectSnippet(
        {pos: -1, lines: 3},
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines from the end of a single paragraph (with list item)", () => {
    expectSnippet(
        {pos: -1, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );

    expectSnippet(
        {pos: -1, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines at the end from multiple paragraphs (with list item)", () => {
    expectSnippet(
        {pos: -1, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );

    expectSnippet(
        {pos: -1, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines at the end from multiple short paragraphs (with list item)", () => {
    expectSnippet(
        {pos: -1, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips a single line in the middle of a short paragraph (with list item)", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips a single line in the middle of a single paragraph (with list item)", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam",
                    ),
                ]),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 0.1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips a single line in the middle of a single paragraph with marks (with list item)", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 0.1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips a single line in the middle of multiple paragraphs (with list item)", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor.",
                    ),
                ]),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.6, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips a single line in the middle of multiple short paragraphs (with list item)", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
            ]),
        ]),
    );
});

test("snips multiple lines in the middle of a short paragraph (with list item)", () => {
    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines in the middle of a single paragraph (with list item)", () => {
    expectSnippet(
        {pos: 0.5, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines in the middle of a single paragraph with marks (with list item)", () => {
    expectSnippet(
        {pos: 0.5, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                    ),
                    text("Curabitur", [mark("bold")]),
                    text(
                        "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                    ),
                    text("Mauris", [mark("bold")]),
                    text(
                        "vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips multiple lines in the middle of multiple paragraphs (with list item)", () => {
    expectSnippet(
        {pos: 0.5, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos",
                    ),
                ]),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo rutrum. Aenean semper nisl at tortor tristique dictum. Donec sed pulvinar ipsum. Nam ultricies justo at cursus tempus. Etiam placerat lacus arcu, vel scelerisque eros rhoncus ac.",
                    ),
                ]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi. Curabitur pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque. Mauris vel semper sem. Quisque congue urna ligula. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed sodales convallis libero, vitae egestas dolor fringilla ut. Ut suscipit et velit pretium aliquam.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Integer feugiat ex eget augue porta, in interdum nisi condimentum. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Praesent non vulputate massa, sed egestas augue. Phasellus eu elementum elit, eget dapibus felis. Proin scelerisque erat et lobortis interdum. Nulla facilisi. Aenean porttitor sodales aliquet. Maecenas sagittis quam a urna rhoncus eleifend eget nec dolor. Ut convallis leo vel lacus bibendum, nec venenatis est pretium. Nullam fringilla, sem at dictum rhoncus, nisi sem ullamcorper ipsum, id congue arcu dolor eu urna. Sed luctus ac nulla sit amet sodales. Cras dignissim rutrum metus sed mattis. In ultrices semper tempor. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos.",
                    ),
                ]),
                node("paragraph", {}, [
                    text(
                        "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Nunc sed nulla vitae libero auctor facilisis. Nulla lectus lacus, egestas a ante at, ultricies vehicula tellus. Donec consequat urna ac ligula commodo",
                    ),
                ]),
            ]),
        ]),
    );
});

test("snips multiple lines in the middle of multiple short paragraphs (with list item)", () => {
    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [text("leading")]),
            node("unorderedListItem", {}, [
                node("paragraph", {}, [
                    text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                ]),
                node("paragraph", {}, [
                    text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                ]),
                node("paragraph", {}, [
                    text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                ]),
                node("paragraph", {}, [
                    text("Orci varius natoque penatibus et magnis dis parturient montes"),
                ]),
                node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
            ]),
            node("paragraph", {}, [text("trailing")]),
        ]),
    );
});

test("snips empty paragraphs as a full line", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, []),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, []),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [text("Pellentesque ac orci augue. Morbi neque mauris")]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, []),
            node("paragraph", {}, [
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
            ]),
            node("paragraph", {}, []),
            node("paragraph", {}, [
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
            ]),
            node("paragraph", {}, []),
        ]),
    );
});

test("snips break nodes as line breaks", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                node("break"),
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                node("break"),
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                node("break"),
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
                node("break"),
                text("Pellentesque ac orci augue. Morbi neque mauris"),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                node("break"),
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                node("break"),
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                node("break"),
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
                node("break"),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                node("break"),
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                node("break"),
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                node("break"),
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
                node("break"),
                text("Pellentesque ac orci augue. Morbi neque mauris"),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                node("break"),
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                node("break"),
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                node("break"),
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
                node("break"),
                text("Pellentesque ac orci augue. Morbi neque mauris"),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                node("break"),
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                node("break"),
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                node("break"),
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
                node("break"),
                text("Pellentesque ac orci augue. Morbi neque mauris"),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                node("break"),
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                node("break"),
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                node("break"),
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
                node("break"),
                text("Pellentesque ac orci augue. Morbi neque mauris"),
            ]),
        ]),
    );
});

test("snips double break nodes as empty lines", () => {
    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                node("break"),
                node("break"),
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                node("break"),
                node("break"),
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                node("break"),
                node("break"),
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
                node("break"),
                node("break"),
                text("Pellentesque ac orci augue. Morbi neque mauris"),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                node("break"),
                node("break"),
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                node("break"),
                node("break"),
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                node("break"),
                node("break"),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 2},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                node("break"),
                node("break"),
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                node("break"),
                node("break"),
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                node("break"),
                node("break"),
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
                node("break"),
                node("break"),
                text("Pellentesque ac orci augue. Morbi neque mauris"),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                node("break"),
                node("break"),
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                node("break"),
                node("break"),
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                node("break"),
                node("break"),
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
                node("break"),
            ]),
        ]),
    );

    expectSnippet(
        {pos: 0.5, lines: 3},
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                node("break"),
                node("break"),
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                node("break"),
                node("break"),
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                node("break"),
                node("break"),
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
                node("break"),
                node("break"),
                text("Pellentesque ac orci augue. Morbi neque mauris"),
            ]),
        ]),
        node("doc", {}, [
            node("paragraph", {}, [
                text("Lorem ipsum dolor sit amet, consectetur adipiscing elit"),
                node("break"),
                node("break"),
                text("Integer feugiat ex eget augue porta, in interdum nisi condimentum"),
                node("break"),
                node("break"),
                text("Vestibulum ante ipsum primis in faucibus orci luctus et ultrices"),
                node("break"),
                node("break"),
                text("Orci varius natoque penatibus et magnis dis parturient montes"),
                node("break"),
                node("break"),
            ]),
        ]),
    );
});
