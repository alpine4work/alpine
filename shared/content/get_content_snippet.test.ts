import {Node} from "prosemirror-model";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    getContentSnippet,
    setDefaultMaxLineGraphemeCountForTest,
} from "~/shared/content/get_content_snippet.js";
import {
    DocumentWithoutTitleContentProsemirrorSchema as schema,
    DocumentContentProsemirrorSchema as schema2,
} from "~/shared/documents/document_content_schema.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, FileId} from "~/shared/id/types/id_types.js";

// NOTE(calebmer): These tests were written with the constant 237. Instead of
// updating the tests to work with the new constant I'm hardcoding the old one for
// now.
setDefaultMaxLineGraphemeCountForTest(237);

const node = schema.node.bind(schema);
const mark = schema.mark.bind(schema);
const text = schema.text.bind(schema);

function expectSnippet(
    {pos, lines}: {pos: number; lines: number | {linesAbove: number; linesBelow: number}},
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

test("snips a single line in the middle of a single paragraph with marks and doesn\u2019t treat mentions as line breaks", () => {
    const accountId1 = generateId<AccountId>();
    const accountId2 = generateId<AccountId>();

    expectSnippet(
        {pos: 0.5, lines: 1},
        node("doc", {}, [
            node("paragraph", {}, [
                text(
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis erat mi, malesuada vel aliquet porta, finibus et nisi.",
                ),
                node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: accountId1,
                        isShort: false,
                    }),
                }),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: accountId2,
                        isShort: false,
                    }),
                }),
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
                node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: accountId1,
                        isShort: false,
                    }),
                }),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: accountId2,
                        isShort: false,
                    }),
                }),
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
                node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: accountId1,
                        isShort: false,
                    }),
                }),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: accountId2,
                        isShort: false,
                    }),
                }),
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
                node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: accountId1,
                        isShort: false,
                    }),
                }),
                text("Curabitur", [mark("bold")]),
                text(
                    "pretium suscipit porta. Curabitur pellentesque turpis ante, ac condimentum erat convallis vel. Nullam vehicula urna libero, non volutpat diam dignissim at. Aliquam tempus pretium finibus. Maecenas condimentum dictum urna sit amet pretium. Vestibulum id libero elit. Nulla tristique sollicitudin quam, vitae accumsan quam tempor sed. Suspendisse eleifend lectus molestie eros placerat scelerisque.",
                ),
                text("Mauris", [mark("bold")]),
                node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: accountId2,
                        isShort: false,
                    }),
                }),
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

test("doesn\u2019t snip cells in a table row when snipping content after", () => {
    expectSnippet(
        {pos: 0, lines: {linesAbove: 0, linesBelow: 2}},
        schema2.nodeFromJSON({
            type: "doc",
            attrs: {
                accessPolicy: {accountGrantById: {}, defaultGrant: null, urlGrant: null},
                hasPresentShortcut: false,
            },
            content: [
                {type: "title", content: [{type: "text", text: "Test Document"}]},
                {
                    type: "paragraph",
                    content: [{type: "text", text: "x".repeat(79)}],
                },
                {
                    type: "table",
                    attrs: {
                        columnWidths: [1, 1, 1],
                        tableWidth: 1,
                        hasHeaderRow: false,
                        hasHeaderColumn: false,
                    },
                    content: [
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Vestibulum sit amet augue nisl. Nullam sodales feugiat neque ut laoreet. Cras viverra feugiat interdum.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Etiam ipsum eros, pretium id rhoncus nec, imperdiet ut augue. Aliquam sagittis augue ac luctus imperdiet. Curabitur ac nulla sem.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Nullam est neque, egestas vitae ornare sed, porta sodales tortor.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Mauris sollicitudin euismod erat at accumsan. Suspendisse aliquam vel mauris sit amet tempor. Vivamus condimentum tortor vitae tellus viverra dictum. Nullam facilisis finibus ipsum nec dignissim. Maecenas eu elit felis. Quisque lorem purus, blandit a quam vel, consectetur ultrices lorem.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Integer dictum tempus purus, sit amet tempus sapien mattis vitae.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Pellentesque magna ante, dapibus eget consectetur vitae, consequat et dui. Duis nec pulvinar erat, in efficitur mi. Maecenas leo lacus, placerat ac justo tempor, tincidunt condimentum orci.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Curabitur vestibulum convallis mattis.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Suspendisse ac molestie augue. Vivamus bibendum, ex sed placerat laoreet, eros urna egestas sapien, vel luctus tortor ligula ac eros.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Aenean congue et massa sit amet tincidunt. Ut lacinia pulvinar bibendum. Aenean ante risus, sollicitudin nec felis sodales, eleifend porta massa. Cras quis euismod mi. Pellentesque in luctus augue.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "paragraph",
                    content: [{type: "text", text: "x".repeat(79)}],
                },
            ],
        }),
        schema2.nodeFromJSON({
            type: "doc",
            attrs: {
                accessPolicy: {accountGrantById: {}, defaultGrant: null, urlGrant: null},
                hasPresentShortcut: false,
            },
            content: [
                {type: "title", content: [{type: "text", text: "Test Document"}]},
                {
                    type: "paragraph",
                    content: [{type: "text", text: "x".repeat(79)}],
                },
                {
                    type: "table",
                    attrs: {
                        columnWidths: [1, 1, 1],
                        tableWidth: 1,
                        hasHeaderRow: false,
                        hasHeaderColumn: false,
                    },
                    content: [
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Vestibulum sit amet augue nisl. Nullam sodales feugiat neque ut laoreet. Cras viverra feugiat interdum.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Etiam ipsum eros, pretium id rhoncus nec, imperdiet ut augue. Aliquam sagittis augue ac luctus imperdiet. Curabitur ac nulla sem.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Nullam est neque, egestas vitae ornare sed, porta sodales tortor.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
    );
});

test("doesn\u2019t snip cells in a table row when snipping content after (large cells)", () => {
    expectSnippet(
        {pos: 0, lines: {linesAbove: 0, linesBelow: 2}},
        schema2.nodeFromJSON({
            type: "doc",
            attrs: {
                accessPolicy: {accountGrantById: {}, defaultGrant: null, urlGrant: null},
                hasPresentShortcut: false,
            },
            content: [
                {type: "title", content: [{type: "text", text: "Test Document"}]},
                {
                    type: "paragraph",
                    content: [{type: "text", text: "x".repeat(79)}],
                },
                {
                    type: "table",
                    attrs: {
                        columnWidths: [1, 1, 1],
                        tableWidth: 1,
                        hasHeaderRow: false,
                        hasHeaderColumn: false,
                    },
                    content: [
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    content: createArrayWithLength(5, () => ({
                                        type: "paragraph",
                                        content: [
                                            {
                                                type: "text",
                                                text: "Vestibulum sit amet augue nisl. Nullam sodales feugiat neque ut laoreet. Cras viverra feugiat interdum.",
                                            },
                                        ],
                                    })),
                                },
                                {
                                    type: "tableCell",
                                    content: createArrayWithLength(5, () => ({
                                        type: "paragraph",
                                        content: [
                                            {
                                                type: "text",
                                                text: "Etiam ipsum eros, pretium id rhoncus nec, imperdiet ut augue. Aliquam sagittis augue ac luctus imperdiet. Curabitur ac nulla sem.",
                                            },
                                        ],
                                    })),
                                },
                                {
                                    type: "tableCell",
                                    content: createArrayWithLength(5, () => ({
                                        type: "paragraph",
                                        content: [
                                            {
                                                type: "text",
                                                text: "Nullam est neque, egestas vitae ornare sed, porta sodales tortor.",
                                            },
                                        ],
                                    })),
                                },
                            ],
                        },
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Mauris sollicitudin euismod erat at accumsan. Suspendisse aliquam vel mauris sit amet tempor. Vivamus condimentum tortor vitae tellus viverra dictum. Nullam facilisis finibus ipsum nec dignissim. Maecenas eu elit felis. Quisque lorem purus, blandit a quam vel, consectetur ultrices lorem.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Integer dictum tempus purus, sit amet tempus sapien mattis vitae.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Pellentesque magna ante, dapibus eget consectetur vitae, consequat et dui. Duis nec pulvinar erat, in efficitur mi. Maecenas leo lacus, placerat ac justo tempor, tincidunt condimentum orci.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Curabitur vestibulum convallis mattis.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Suspendisse ac molestie augue. Vivamus bibendum, ex sed placerat laoreet, eros urna egestas sapien, vel luctus tortor ligula ac eros.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Aenean congue et massa sit amet tincidunt. Ut lacinia pulvinar bibendum. Aenean ante risus, sollicitudin nec felis sodales, eleifend porta massa. Cras quis euismod mi. Pellentesque in luctus augue.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "paragraph",
                    content: [{type: "text", text: "x".repeat(79)}],
                },
            ],
        }),
        schema2.nodeFromJSON({
            type: "doc",
            attrs: {
                accessPolicy: {accountGrantById: {}, defaultGrant: null, urlGrant: null},
                hasPresentShortcut: false,
            },
            content: [
                {type: "title", content: [{type: "text", text: "Test Document"}]},
                {
                    type: "paragraph",
                    content: [{type: "text", text: "x".repeat(79)}],
                },
                {
                    type: "table",
                    attrs: {
                        columnWidths: [1, 1, 1],
                        tableWidth: 1,
                        hasHeaderRow: false,
                        hasHeaderColumn: false,
                    },
                    content: [
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    // TODO(calebmer): This can be optimized. We should snip within the cell instead of
                                    // including the full cell.
                                    content: createArrayWithLength(5, () => ({
                                        type: "paragraph",
                                        content: [
                                            {
                                                type: "text",
                                                text: "Vestibulum sit amet augue nisl. Nullam sodales feugiat neque ut laoreet. Cras viverra feugiat interdum.",
                                            },
                                        ],
                                    })),
                                },
                                {
                                    type: "tableCell",
                                    // TODO(calebmer): This can be optimized. We should snip within the cell instead of
                                    // including the full cell.
                                    content: createArrayWithLength(5, () => ({
                                        type: "paragraph",
                                        content: [
                                            {
                                                type: "text",
                                                text: "Etiam ipsum eros, pretium id rhoncus nec, imperdiet ut augue. Aliquam sagittis augue ac luctus imperdiet. Curabitur ac nulla sem.",
                                            },
                                        ],
                                    })),
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Nullam est neque, egestas vitae ornare sed, porta sodales tortor.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
    );
});

test("doesn\u2019t snip cells in a table row when snipping content before", () => {
    expectSnippet(
        {pos: -1, lines: {linesAbove: 1, linesBelow: 0}},
        schema2.nodeFromJSON({
            type: "doc",
            attrs: {
                accessPolicy: {accountGrantById: {}, defaultGrant: null, urlGrant: null},
                hasPresentShortcut: false,
            },
            content: [
                {type: "title", content: [{type: "text", text: "Test Document"}]},
                {
                    type: "paragraph",
                    content: [{type: "text", text: "x".repeat(79)}],
                },
                {
                    type: "table",
                    attrs: {
                        columnWidths: [1, 1, 1],
                        tableWidth: 1,
                        hasHeaderRow: false,
                        hasHeaderColumn: false,
                    },
                    content: [
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Vestibulum sit amet augue nisl. Nullam sodales feugiat neque ut laoreet. Cras viverra feugiat interdum.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Etiam ipsum eros, pretium id rhoncus nec, imperdiet ut augue. Aliquam sagittis augue ac luctus imperdiet. Curabitur ac nulla sem.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Nullam est neque, egestas vitae ornare sed, porta sodales tortor.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Mauris sollicitudin euismod erat at accumsan. Suspendisse aliquam vel mauris sit amet tempor. Vivamus condimentum tortor vitae tellus viverra dictum. Nullam facilisis finibus ipsum nec dignissim. Maecenas eu elit felis. Quisque lorem purus, blandit a quam vel, consectetur ultrices lorem.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Integer dictum tempus purus, sit amet tempus sapien mattis vitae.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Pellentesque magna ante, dapibus eget consectetur vitae, consequat et dui. Duis nec pulvinar erat, in efficitur mi. Maecenas leo lacus, placerat ac justo tempor, tincidunt condimentum orci.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Curabitur vestibulum convallis mattis.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Suspendisse ac molestie augue. Vivamus bibendum, ex sed placerat laoreet, eros urna egestas sapien, vel luctus tortor ligula ac eros.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Aenean congue et massa sit amet tincidunt. Ut lacinia pulvinar bibendum. Aenean ante risus, sollicitudin nec felis sodales, eleifend porta massa. Cras quis euismod mi. Pellentesque in luctus augue.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "paragraph",
                    content: [{type: "text", text: "x".repeat(79)}],
                },
            ],
        }),
        schema2.nodeFromJSON({
            type: "doc",
            attrs: {
                accessPolicy: {accountGrantById: {}, defaultGrant: null, urlGrant: null},
                hasPresentShortcut: false,
            },
            content: [
                {
                    type: "table",
                    attrs: {
                        columnWidths: [1, 1, 1],
                        tableWidth: 1,
                        hasHeaderRow: false,
                        hasHeaderColumn: false,
                    },
                    content: [
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Curabitur vestibulum convallis mattis.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Suspendisse ac molestie augue. Vivamus bibendum, ex sed placerat laoreet, eros urna egestas sapien, vel luctus tortor ligula ac eros.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Aenean congue et massa sit amet tincidunt. Ut lacinia pulvinar bibendum. Aenean ante risus, sollicitudin nec felis sodales, eleifend porta massa. Cras quis euismod mi. Pellentesque in luctus augue.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "paragraph",
                    content: [{type: "text", text: "x".repeat(79)}],
                },
            ],
        }),
    );
});

test("doesn\u2019t snip cells in a table row when snipping content before (large cells)", () => {
    expectSnippet(
        {pos: -1, lines: {linesAbove: 1, linesBelow: 0}},
        schema2.nodeFromJSON({
            type: "doc",
            attrs: {
                accessPolicy: {accountGrantById: {}, defaultGrant: null, urlGrant: null},
                hasPresentShortcut: false,
            },
            content: [
                {type: "title", content: [{type: "text", text: "Test Document"}]},
                {
                    type: "paragraph",
                    content: [{type: "text", text: "x".repeat(79)}],
                },
                {
                    type: "table",
                    attrs: {
                        columnWidths: [1, 1, 1],
                        tableWidth: 1,
                        hasHeaderRow: false,
                        hasHeaderColumn: false,
                    },
                    content: [
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Vestibulum sit amet augue nisl. Nullam sodales feugiat neque ut laoreet. Cras viverra feugiat interdum.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Etiam ipsum eros, pretium id rhoncus nec, imperdiet ut augue. Aliquam sagittis augue ac luctus imperdiet. Curabitur ac nulla sem.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Nullam est neque, egestas vitae ornare sed, porta sodales tortor.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Mauris sollicitudin euismod erat at accumsan. Suspendisse aliquam vel mauris sit amet tempor. Vivamus condimentum tortor vitae tellus viverra dictum. Nullam facilisis finibus ipsum nec dignissim. Maecenas eu elit felis. Quisque lorem purus, blandit a quam vel, consectetur ultrices lorem.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Integer dictum tempus purus, sit amet tempus sapien mattis vitae.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: "Pellentesque magna ante, dapibus eget consectetur vitae, consequat et dui. Duis nec pulvinar erat, in efficitur mi. Maecenas leo lacus, placerat ac justo tempor, tincidunt condimentum orci.",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    content: createArrayWithLength(5, () => ({
                                        type: "paragraph",
                                        content: [
                                            {
                                                type: "text",
                                                text: "Curabitur vestibulum convallis mattis.",
                                            },
                                        ],
                                    })),
                                },
                                {
                                    type: "tableCell",
                                    content: createArrayWithLength(5, () => ({
                                        type: "paragraph",
                                        content: [
                                            {
                                                type: "text",
                                                text: "Suspendisse ac molestie augue. Vivamus bibendum, ex sed placerat laoreet, eros urna egestas sapien, vel luctus tortor ligula ac eros.",
                                            },
                                        ],
                                    })),
                                },
                                {
                                    type: "tableCell",
                                    content: createArrayWithLength(5, () => ({
                                        type: "paragraph",
                                        content: [
                                            {
                                                type: "text",
                                                text: "Aenean congue et massa sit amet tincidunt. Ut lacinia pulvinar bibendum. Aenean ante risus, sollicitudin nec felis sodales, eleifend porta massa. Cras quis euismod mi. Pellentesque in luctus augue.",
                                            },
                                        ],
                                    })),
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "paragraph",
                    content: [{type: "text", text: "x".repeat(79)}],
                },
            ],
        }),
        schema2.nodeFromJSON({
            type: "doc",
            attrs: {
                accessPolicy: {accountGrantById: {}, defaultGrant: null, urlGrant: null},
                hasPresentShortcut: false,
            },
            content: [
                {
                    type: "table",
                    attrs: {
                        columnWidths: [1, 1, 1],
                        tableWidth: 1,
                        hasHeaderRow: false,
                        hasHeaderColumn: false,
                    },
                    content: [
                        {
                            type: "tableRow",
                            content: [
                                {
                                    type: "tableCell",
                                    content: createArrayWithLength(5, () => ({
                                        type: "paragraph",
                                        content: [
                                            {
                                                type: "text",
                                                text: "Curabitur vestibulum convallis mattis.",
                                            },
                                        ],
                                    })),
                                },
                                {
                                    type: "tableCell",
                                    content: createArrayWithLength(5, () => ({
                                        type: "paragraph",
                                        content: [
                                            {
                                                type: "text",
                                                text: "Suspendisse ac molestie augue. Vivamus bibendum, ex sed placerat laoreet, eros urna egestas sapien, vel luctus tortor ligula ac eros.",
                                            },
                                        ],
                                    })),
                                },
                                {
                                    type: "tableCell",
                                    content: createArrayWithLength(5, () => ({
                                        type: "paragraph",
                                        content: [
                                            {
                                                type: "text",
                                                text: "Aenean congue et massa sit amet tincidunt. Ut lacinia pulvinar bibendum. Aenean ante risus, sollicitudin nec felis sodales, eleifend porta massa. Cras quis euismod mi. Pellentesque in luctus augue.",
                                            },
                                        ],
                                    })),
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "paragraph",
                    content: [{type: "text", text: "x".repeat(79)}],
                },
            ],
        }),
    );
});
