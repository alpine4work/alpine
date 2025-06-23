/* eslint-disable string-quotes */

import {DOMSerializer, Node, Schema} from "prosemirror-model";
import {marks as basicMarks, nodes as basicNodes} from "prosemirror-schema-basic";
import {assert} from "~/shared/helpers/control/assert.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {
    ProsemirrorHtmlSerializationInlineDecoration,
    ProsemirrorHtmlSerializationWidgetDecoration,
    serializeProsemirrorFragmentToHtml,
    serializeProsemirrorNodeToHtml,
} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";

const schema = new Schema({
    nodes: {...basicNodes, doc: {...basicNodes.doc, toDOM: () => ["div", 0]}},
    marks: basicMarks,
});

const node = schema.node.bind(schema);
const text = schema.text.bind(schema);
const mark = schema.mark.bind(schema);

const serializer = DOMSerializer.fromSchema(schema);

const testCases: Array<{
    name: string;
    node: Node;
    html: string;
}> = [
    {
        name: "single paragraph",
        node: node("paragraph", {}, [text("Hello, world!")]),
        html: "<p>Hello, world!</p>",
    },
    {
        name: "multiple paragraphs",
        node: node("doc", {}, [
            node("paragraph", {}, [text("Hello, world! 1")]),
            node("paragraph", {}, [text("Hello, world! 2")]),
            node("paragraph", {}, [text("Hello, world! 3")]),
        ]),
        html: "<div><p>Hello, world! 1</p><p>Hello, world! 2</p><p>Hello, world! 3</p></div>",
    },
    {
        name: "hard break",
        node: node("doc", {}, [
            node("paragraph", {}, [text("Hello,"), node("hard_break"), text("world!")]),
        ]),
        html: "<div><p>Hello,<br>world!</p></div>",
    },
    {
        name: "blockquote",
        node: node("doc", {}, [
            node("blockquote", {}, [
                node("paragraph", {}, [text("Hello, world! 1")]),
                node("paragraph", {}, [text("Hello, world! 2")]),
            ]),
            node("paragraph", {}, [text("Hello, world! 3")]),
        ]),
        html: "<div><blockquote><p>Hello, world! 1</p><p>Hello, world! 2</p></blockquote><p>Hello, world! 3</p></div>",
    },
    {
        name: "nested blockquotes",
        node: node("doc", {}, [
            node("blockquote", {}, [
                node("paragraph", {}, [text("Hello, world! 1")]),
                node("blockquote", {}, [node("paragraph", {}, [text("Hello, world! 2")])]),
            ]),
            node("paragraph", {}, [text("Hello, world! 3")]),
        ]),
        html: "<div><blockquote><p>Hello, world! 1</p><blockquote><p>Hello, world! 2</p></blockquote></blockquote><p>Hello, world! 3</p></div>",
    },
    {
        name: "single mark",
        node: node("doc", {}, [
            node("paragraph", {}, [text("Hello, "), text("world", [mark("strong")]), text("!")]),
        ]),
        html: "<div><p>Hello, <strong>world</strong>!</p></div>",
    },
    {
        name: "multiple marks on same text",
        node: node("doc", {}, [
            node("paragraph", {}, [
                text("Hello, "),
                text("world", [mark("strong"), mark("em")]),
                text("!"),
            ]),
        ]),
        html: "<div><p>Hello, <em><strong>world</strong></em>!</p></div>",
    },
    {
        name: "multiple marks on same text (opposite order)",
        node: node("doc", {}, [
            node("paragraph", {}, [
                text("Hello, "),
                text("world", [mark("em"), mark("strong")]),
                text("!"),
            ]),
        ]),
        html: "<div><p>Hello, <em><strong>world</strong></em>!</p></div>",
    },
    {
        name: "multiple marks on disjoint text",
        node: node("doc", {}, [
            node("paragraph", {}, [
                text("Hello, ", [mark("em")]),
                text("world", [mark("strong")]),
                text("!"),
            ]),
        ]),
        html: "<div><p><em>Hello, </em><strong>world</strong>!</p></div>",
    },
    {
        name: "multiple marks on overlapping text (ordering 1)",
        node: node("doc", {}, [
            node("paragraph", {}, [
                text("Hello, ", [mark("em")]),
                text("world", [mark("em"), mark("strong")]),
                text("!"),
            ]),
        ]),
        html: "<div><p><em>Hello, <strong>world</strong></em>!</p></div>",
    },
    {
        name: "multiple marks on overlapping text (ordering 2)",
        node: node("doc", {}, [
            node("paragraph", {}, [
                text("Hello, ", [mark("em")]),
                text("world", [mark("strong"), mark("em")]),
                text("!"),
            ]),
        ]),
        html: "<div><p><em>Hello, <strong>world</strong></em>!</p></div>",
    },
    {
        name: "multiple marks on overlapping text (ordering 3)",
        node: node("doc", {}, [
            node("paragraph", {}, [
                text("Hello, ", [mark("strong")]),
                text("world", [mark("strong"), mark("em")]),
                text("!"),
            ]),
        ]),
        html: "<div><p><strong>Hello, </strong><em><strong>world</strong></em>!</p></div>",
    },
    {
        name: "multiple marks on overlapping text (ordering 4)",
        node: node("doc", {}, [
            node("paragraph", {}, [
                text("Hello, ", [mark("strong")]),
                text("world", [mark("em"), mark("strong")]),
                text("!"),
            ]),
        ]),
        html: "<div><p><strong>Hello, </strong><em><strong>world</strong></em>!</p></div>",
    },
    {
        name: "attribute values",
        node: node("doc", {}, [
            node("paragraph", {}, [
                text("Hello, ", []),
                text("world", [mark("link", {href: "https://example.com"})]),
                text("!"),
            ]),
        ]),
        html: '<div><p>Hello, <a href="https://example.com">world</a>!</p></div>',
    },
    {
        name: "attribute values with character escaping",
        node: node("doc", {}, [
            node("paragraph", {}, [
                text("Hello, ", []),
                text("world", [mark("link", {href: "https://example.com?a=1&b=2&c=3"})]),
                text("!"),
            ]),
        ]),
        html: '<div><p>Hello, <a href="https://example.com?a=1&amp;b=2&amp;c=3">world</a>!</p></div>',
    },
    {
        name: "text with character escaping",
        node: node("doc", {}, [node("paragraph", {}, [text('<script>alert("XSS")</script>')])]),
        html: '<div><p>&lt;script&gt;alert("XSS")&lt;/script&gt;</p></div>',
    },
];

for (const {name, node, html: expectedHtml} of testCases) {
    test(`works with ${name}`, () => {
        const element = serializer.serializeNode(node);
        assert(element instanceof HTMLElement);
        expect(element.outerHTML).toEqual(expectedHtml);

        const testElement = document.createElement("div");
        testElement.innerHTML = serializeProsemirrorNodeToHtml(node);
        expect(testElement.innerHTML).toEqual(expectedHtml);
    });

    test(`works with ${name} (fragment)`, () => {
        const fragment = serializer.serializeFragment(node.content);
        const element = document.createElement("div");
        element.appendChild(fragment);
        const expectedHtml = element.innerHTML;

        const testElement = document.createElement("div");
        testElement.innerHTML = serializeProsemirrorFragmentToHtml(node.content);
        expect(testElement.innerHTML).toEqual(expectedHtml);
    });
}

test("can insert a decoration widget anywhere", () => {
    const doc = node("doc", {}, [
        node("paragraph", {}, [text("test1")]),
        node("paragraph", {}, [text("test2")]),
    ]);

    const widgetHtml = new HtmlElementGenerator("br");

    const widget: Omit<ProsemirrorHtmlSerializationWidgetDecoration, "pos"> = {
        type: "Widget",
        html: widgetHtml,
    };

    expect(serializeProsemirrorNodeToHtml(doc)).toEqual("<div><p>test1</p><p>test2</p></div>");

    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 0}]})).toEqual(
        "<br><div><p>test1</p><p>test2</p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 1}]})).toEqual(
        "<div><br><p>test1</p><p>test2</p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 2}]})).toEqual(
        "<div><p><br>test1</p><p>test2</p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 3}]})).toEqual(
        "<div><p>t<br>est1</p><p>test2</p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 4}]})).toEqual(
        "<div><p>te<br>st1</p><p>test2</p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 5}]})).toEqual(
        "<div><p>tes<br>t1</p><p>test2</p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 6}]})).toEqual(
        "<div><p>test<br>1</p><p>test2</p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 7}]})).toEqual(
        "<div><p>test1<br></p><p>test2</p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 8}]})).toEqual(
        "<div><p>test1</p><br><p>test2</p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 9}]})).toEqual(
        "<div><p>test1</p><p><br>test2</p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 10}]})).toEqual(
        "<div><p>test1</p><p>t<br>est2</p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 11}]})).toEqual(
        "<div><p>test1</p><p>te<br>st2</p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 12}]})).toEqual(
        "<div><p>test1</p><p>tes<br>t2</p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 13}]})).toEqual(
        "<div><p>test1</p><p>test<br>2</p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 14}]})).toEqual(
        "<div><p>test1</p><p>test2<br></p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 15}]})).toEqual(
        "<div><p>test1</p><p>test2</p><br></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 16}]})).toEqual(
        "<div><p>test1</p><p>test2</p></div><br>",
    );
});

test("can insert multiple decoration widgets provided in any order", () => {
    const doc = node("doc", {}, [
        node("paragraph", {}, [text("test1")]),
        node("paragraph", {}, [text("test2")]),
    ]);

    const widgetHtml = new HtmlElementGenerator("br");

    const widget: Omit<ProsemirrorHtmlSerializationWidgetDecoration, "pos"> = {
        type: "Widget",
        html: widgetHtml,
    };

    expect(serializeProsemirrorNodeToHtml(doc)).toEqual("<div><p>test1</p><p>test2</p></div>");

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget, pos: 8},
                {...widget, pos: 0},
                {...widget, pos: 15},
                {...widget, pos: 5},
            ],
        }),
    ).toEqual("<br><div><p>tes<br>t1</p><br><p>test2</p><br></div>");
});

test("will insert a decoration widget outside of adjacent marks", () => {
    const doc = node("doc", {}, [
        node("paragraph", {}, [
            text("ab"),
            text("cd", [mark("strong")]),
            text("ef"),
            text("gh", [mark("em")]),
        ]),
    ]);

    const widgetHtml = new HtmlElementGenerator("br");

    const widget: Omit<ProsemirrorHtmlSerializationWidgetDecoration, "pos"> = {
        type: "Widget",
        html: widgetHtml,
    };

    expect(serializeProsemirrorNodeToHtml(doc)).toEqual(
        "<div><p>ab<strong>cd</strong>ef<em>gh</em></p></div>",
    );

    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 0}]})).toEqual(
        "<br><div><p>ab<strong>cd</strong>ef<em>gh</em></p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 1}]})).toEqual(
        "<div><br><p>ab<strong>cd</strong>ef<em>gh</em></p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 2}]})).toEqual(
        "<div><p><br>ab<strong>cd</strong>ef<em>gh</em></p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 3}]})).toEqual(
        "<div><p>a<br>b<strong>cd</strong>ef<em>gh</em></p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 4}]})).toEqual(
        "<div><p>ab<br><strong>cd</strong>ef<em>gh</em></p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 5}]})).toEqual(
        "<div><p>ab<strong>c<br>d</strong>ef<em>gh</em></p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 6}]})).toEqual(
        "<div><p>ab<strong>cd</strong><br>ef<em>gh</em></p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 7}]})).toEqual(
        "<div><p>ab<strong>cd</strong>e<br>f<em>gh</em></p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 8}]})).toEqual(
        "<div><p>ab<strong>cd</strong>ef<br><em>gh</em></p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 9}]})).toEqual(
        "<div><p>ab<strong>cd</strong>ef<em>g<br>h</em></p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 10}]})).toEqual(
        "<div><p>ab<strong>cd</strong>ef<em>gh</em><br></p></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 11}]})).toEqual(
        "<div><p>ab<strong>cd</strong>ef<em>gh</em></p><br></div>",
    );
    expect(serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, pos: 12}]})).toEqual(
        "<div><p>ab<strong>cd</strong>ef<em>gh</em></p></div><br>",
    );
});

test("can insert an inline decoration anywhere", () => {
    const doc = node("doc", {}, [
        node("paragraph", {}, [text("foo")]),
        node("paragraph", {}, [text("bar")]),
    ]);

    const widget: Omit<ProsemirrorHtmlSerializationInlineDecoration, "from" | "to"> = {
        type: "Inline",
        attrs: {nodeName: "span"},
    };

    expect(serializeProsemirrorNodeToHtml(doc)).toEqual("<div><p>foo</p><p>bar</p></div>");

    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 0, to: 1}]}),
    ).toEqual("<div><p>foo</p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 0, to: 2}]}),
    ).toEqual("<div><p><span>f</span>oo</p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 0, to: 3}]}),
    ).toEqual("<div><p><span>fo</span>o</p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 0, to: 4}]}),
    ).toEqual("<div><p><span>foo</span></p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 0, to: 5}]}),
    ).toEqual("<div><p><span>foo</span></p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 0, to: 6}]}),
    ).toEqual("<div><p><span>foo</span></p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 0, to: 7}]}),
    ).toEqual("<div><p><span>foo</span></p><p><span>b</span>ar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 0, to: 8}]}),
    ).toEqual("<div><p><span>foo</span></p><p><span>ba</span>r</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 0, to: 9}]}),
    ).toEqual("<div><p><span>foo</span></p><p><span>bar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 0, to: 10}]}),
    ).toEqual("<div><p><span>foo</span></p><p><span>bar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 0, to: 11}]}),
    ).toEqual("<div><p><span>foo</span></p><p><span>bar</span></p></div>");

    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 1, to: 2}]}),
    ).toEqual("<div><p><span>f</span>oo</p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 1, to: 3}]}),
    ).toEqual("<div><p><span>fo</span>o</p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 1, to: 4}]}),
    ).toEqual("<div><p><span>foo</span></p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 1, to: 5}]}),
    ).toEqual("<div><p><span>foo</span></p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 1, to: 6}]}),
    ).toEqual("<div><p><span>foo</span></p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 1, to: 7}]}),
    ).toEqual("<div><p><span>foo</span></p><p><span>b</span>ar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 1, to: 8}]}),
    ).toEqual("<div><p><span>foo</span></p><p><span>ba</span>r</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 1, to: 9}]}),
    ).toEqual("<div><p><span>foo</span></p><p><span>bar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 1, to: 10}]}),
    ).toEqual("<div><p><span>foo</span></p><p><span>bar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 1, to: 11}]}),
    ).toEqual("<div><p><span>foo</span></p><p><span>bar</span></p></div>");

    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 2, to: 3}]}),
    ).toEqual("<div><p>f<span>o</span>o</p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 2, to: 4}]}),
    ).toEqual("<div><p>f<span>oo</span></p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 2, to: 5}]}),
    ).toEqual("<div><p>f<span>oo</span></p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 2, to: 6}]}),
    ).toEqual("<div><p>f<span>oo</span></p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 2, to: 7}]}),
    ).toEqual("<div><p>f<span>oo</span></p><p><span>b</span>ar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 2, to: 8}]}),
    ).toEqual("<div><p>f<span>oo</span></p><p><span>ba</span>r</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 2, to: 9}]}),
    ).toEqual("<div><p>f<span>oo</span></p><p><span>bar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 2, to: 10}]}),
    ).toEqual("<div><p>f<span>oo</span></p><p><span>bar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 2, to: 11}]}),
    ).toEqual("<div><p>f<span>oo</span></p><p><span>bar</span></p></div>");

    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 3, to: 4}]}),
    ).toEqual("<div><p>fo<span>o</span></p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 3, to: 5}]}),
    ).toEqual("<div><p>fo<span>o</span></p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 3, to: 6}]}),
    ).toEqual("<div><p>fo<span>o</span></p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 3, to: 7}]}),
    ).toEqual("<div><p>fo<span>o</span></p><p><span>b</span>ar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 3, to: 8}]}),
    ).toEqual("<div><p>fo<span>o</span></p><p><span>ba</span>r</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 3, to: 9}]}),
    ).toEqual("<div><p>fo<span>o</span></p><p><span>bar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 3, to: 10}]}),
    ).toEqual("<div><p>fo<span>o</span></p><p><span>bar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 3, to: 11}]}),
    ).toEqual("<div><p>fo<span>o</span></p><p><span>bar</span></p></div>");

    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 4, to: 5}]}),
    ).toEqual("<div><p>foo</p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 4, to: 6}]}),
    ).toEqual("<div><p>foo</p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 4, to: 7}]}),
    ).toEqual("<div><p>foo</p><p><span>b</span>ar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 4, to: 8}]}),
    ).toEqual("<div><p>foo</p><p><span>ba</span>r</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 4, to: 9}]}),
    ).toEqual("<div><p>foo</p><p><span>bar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 4, to: 10}]}),
    ).toEqual("<div><p>foo</p><p><span>bar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 4, to: 11}]}),
    ).toEqual("<div><p>foo</p><p><span>bar</span></p></div>");

    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 5, to: 6}]}),
    ).toEqual("<div><p>foo</p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 5, to: 7}]}),
    ).toEqual("<div><p>foo</p><p><span>b</span>ar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 5, to: 8}]}),
    ).toEqual("<div><p>foo</p><p><span>ba</span>r</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 5, to: 9}]}),
    ).toEqual("<div><p>foo</p><p><span>bar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 5, to: 10}]}),
    ).toEqual("<div><p>foo</p><p><span>bar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 5, to: 11}]}),
    ).toEqual("<div><p>foo</p><p><span>bar</span></p></div>");

    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 6, to: 7}]}),
    ).toEqual("<div><p>foo</p><p><span>b</span>ar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 6, to: 8}]}),
    ).toEqual("<div><p>foo</p><p><span>ba</span>r</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 6, to: 9}]}),
    ).toEqual("<div><p>foo</p><p><span>bar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 6, to: 10}]}),
    ).toEqual("<div><p>foo</p><p><span>bar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 6, to: 11}]}),
    ).toEqual("<div><p>foo</p><p><span>bar</span></p></div>");

    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 7, to: 8}]}),
    ).toEqual("<div><p>foo</p><p>b<span>a</span>r</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 7, to: 9}]}),
    ).toEqual("<div><p>foo</p><p>b<span>ar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 7, to: 10}]}),
    ).toEqual("<div><p>foo</p><p>b<span>ar</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 7, to: 11}]}),
    ).toEqual("<div><p>foo</p><p>b<span>ar</span></p></div>");

    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 8, to: 9}]}),
    ).toEqual("<div><p>foo</p><p>ba<span>r</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 8, to: 10}]}),
    ).toEqual("<div><p>foo</p><p>ba<span>r</span></p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 8, to: 11}]}),
    ).toEqual("<div><p>foo</p><p>ba<span>r</span></p></div>");

    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 9, to: 10}]}),
    ).toEqual("<div><p>foo</p><p>bar</p></div>");
    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 9, to: 11}]}),
    ).toEqual("<div><p>foo</p><p>bar</p></div>");

    expect(
        serializeProsemirrorNodeToHtml(doc, {decorations: [{...widget, from: 10, to: 11}]}),
    ).toEqual("<div><p>foo</p><p>bar</p></div>");
});

test("can overlapping inline decorations anywhere", () => {
    const doc = node("doc", {}, [node("paragraph", {}, [text("test")])]);

    const widget1: Omit<ProsemirrorHtmlSerializationInlineDecoration, "from" | "to"> = {
        type: "Inline",
        attrs: {nodeName: "span", id: "1"},
    };

    const widget2: Omit<ProsemirrorHtmlSerializationInlineDecoration, "from" | "to"> = {
        type: "Inline",
        attrs: {nodeName: "span", id: "2"},
    };

    expect(serializeProsemirrorNodeToHtml(doc)).toEqual("<div><p>test</p></div>");

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 2},
                {...widget2, from: 1, to: 2},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span>est</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 3},
                {...widget2, from: 1, to: 2},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span><span id="1">e</span>st</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 4},
                {...widget2, from: 1, to: 2},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span><span id="1">es</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 5},
                {...widget2, from: 1, to: 2},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span><span id="1">est</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 3},
                {...widget2, from: 1, to: 2},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span><span id="1">e</span>st</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 4},
                {...widget2, from: 1, to: 2},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span><span id="1">es</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 5},
                {...widget2, from: 1, to: 2},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span><span id="1">est</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 4},
                {...widget2, from: 1, to: 2},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span>e<span id="1">s</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 5},
                {...widget2, from: 1, to: 2},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span>e<span id="1">st</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 4, to: 5},
                {...widget2, from: 1, to: 2},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span>es<span id="1">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 2},
                {...widget2, from: 1, to: 3},
            ],
        }),
    ).toEqual('<div><p><span id="2">te</span>st</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 3},
                {...widget2, from: 1, to: 3},
            ],
        }),
    ).toEqual('<div><p><span id="2">te</span>st</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 4},
                {...widget2, from: 1, to: 3},
            ],
        }),
    ).toEqual('<div><p><span id="2">te</span><span id="1">s</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 5},
                {...widget2, from: 1, to: 3},
            ],
        }),
    ).toEqual('<div><p><span id="2">te</span><span id="1">st</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 3},
                {...widget2, from: 1, to: 3},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span><span id="1">e</span>st</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 4},
                {...widget2, from: 1, to: 3},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span><span id="1">es</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 5},
                {...widget2, from: 1, to: 3},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span><span id="1">est</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 4},
                {...widget2, from: 1, to: 3},
            ],
        }),
    ).toEqual('<div><p><span id="2">te</span><span id="1">s</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 5},
                {...widget2, from: 1, to: 3},
            ],
        }),
    ).toEqual('<div><p><span id="2">te</span><span id="1">st</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 4, to: 5},
                {...widget2, from: 1, to: 3},
            ],
        }),
    ).toEqual('<div><p><span id="2">te</span>s<span id="1">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 2},
                {...widget2, from: 1, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="2">tes</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 3},
                {...widget2, from: 1, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="2">tes</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 4},
                {...widget2, from: 1, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="2">tes</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 5},
                {...widget2, from: 1, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="2">tes</span><span id="1">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 3},
                {...widget2, from: 1, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span><span id="1">e</span><span id="2">s</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 4},
                {...widget2, from: 1, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span><span id="1">es</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 5},
                {...widget2, from: 1, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span><span id="1">est</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 4},
                {...widget2, from: 1, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="2">te</span><span id="1">s</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 5},
                {...widget2, from: 1, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="2">te</span><span id="1">st</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 4, to: 5},
                {...widget2, from: 1, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="2">tes</span><span id="1">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 2},
                {...widget2, from: 1, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="2">test</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 3},
                {...widget2, from: 1, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="2">test</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 4},
                {...widget2, from: 1, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="2">test</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 5},
                {...widget2, from: 1, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="2">test</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 3},
                {...widget2, from: 1, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span><span id="1">e</span><span id="2">st</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 4},
                {...widget2, from: 1, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span><span id="1">es</span><span id="2">t</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 5},
                {...widget2, from: 1, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="2">t</span><span id="1">est</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 4},
                {...widget2, from: 1, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="2">te</span><span id="1">s</span><span id="2">t</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 5},
                {...widget2, from: 1, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="2">te</span><span id="1">st</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 4, to: 5},
                {...widget2, from: 1, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="2">tes</span><span id="1">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 2},
                {...widget2, from: 2, to: 3},
            ],
        }),
    ).toEqual('<div><p><span id="1">t</span><span id="2">e</span>st</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 3},
                {...widget2, from: 2, to: 3},
            ],
        }),
    ).toEqual('<div><p><span id="1">t</span><span id="2">e</span>st</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 4},
                {...widget2, from: 2, to: 3},
            ],
        }),
    ).toEqual('<div><p><span id="1">t</span><span id="2">e</span><span id="1">s</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 5},
                {...widget2, from: 2, to: 3},
            ],
        }),
    ).toEqual('<div><p><span id="1">t</span><span id="2">e</span><span id="1">st</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 3},
                {...widget2, from: 2, to: 3},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">e</span>st</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 4},
                {...widget2, from: 2, to: 3},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">e</span><span id="1">s</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 5},
                {...widget2, from: 2, to: 3},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">e</span><span id="1">st</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 4},
                {...widget2, from: 2, to: 3},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">e</span><span id="1">s</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 5},
                {...widget2, from: 2, to: 3},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">e</span><span id="1">st</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 4, to: 5},
                {...widget2, from: 2, to: 3},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">e</span>s<span id="1">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 2},
                {...widget2, from: 2, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="1">t</span><span id="2">es</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 3},
                {...widget2, from: 2, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="1">t</span><span id="2">es</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 4},
                {...widget2, from: 2, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="1">t</span><span id="2">es</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 5},
                {...widget2, from: 2, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="1">t</span><span id="2">es</span><span id="1">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 3},
                {...widget2, from: 2, to: 4},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">es</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 4},
                {...widget2, from: 2, to: 4},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">es</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 5},
                {...widget2, from: 2, to: 4},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">es</span><span id="1">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 4},
                {...widget2, from: 2, to: 4},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">e</span><span id="1">s</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 5},
                {...widget2, from: 2, to: 4},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">e</span><span id="1">st</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 4, to: 5},
                {...widget2, from: 2, to: 4},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">es</span><span id="1">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 2},
                {...widget2, from: 2, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="1">t</span><span id="2">est</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 3},
                {...widget2, from: 2, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="1">t</span><span id="2">est</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 4},
                {...widget2, from: 2, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="1">t</span><span id="2">est</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 5},
                {...widget2, from: 2, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="1">t</span><span id="2">est</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 3},
                {...widget2, from: 2, to: 5},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">est</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 4},
                {...widget2, from: 2, to: 5},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">est</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 5},
                {...widget2, from: 2, to: 5},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">est</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 4},
                {...widget2, from: 2, to: 5},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">e</span><span id="1">s</span><span id="2">t</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 5},
                {...widget2, from: 2, to: 5},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">e</span><span id="1">st</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 4, to: 5},
                {...widget2, from: 2, to: 5},
            ],
        }),
    ).toEqual('<div><p>t<span id="2">es</span><span id="1">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 2},
                {...widget2, from: 3, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="1">t</span>e<span id="2">s</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 3},
                {...widget2, from: 3, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="1">te</span><span id="2">s</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 4},
                {...widget2, from: 3, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="1">te</span><span id="2">s</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 5},
                {...widget2, from: 3, to: 4},
            ],
        }),
    ).toEqual('<div><p><span id="1">te</span><span id="2">s</span><span id="1">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 3},
                {...widget2, from: 3, to: 4},
            ],
        }),
    ).toEqual('<div><p>t<span id="1">e</span><span id="2">s</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 4},
                {...widget2, from: 3, to: 4},
            ],
        }),
    ).toEqual('<div><p>t<span id="1">e</span><span id="2">s</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 5},
                {...widget2, from: 3, to: 4},
            ],
        }),
    ).toEqual('<div><p>t<span id="1">e</span><span id="2">s</span><span id="1">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 4},
                {...widget2, from: 3, to: 4},
            ],
        }),
    ).toEqual('<div><p>te<span id="2">s</span>t</p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 5},
                {...widget2, from: 3, to: 4},
            ],
        }),
    ).toEqual('<div><p>te<span id="2">s</span><span id="1">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 4, to: 5},
                {...widget2, from: 3, to: 4},
            ],
        }),
    ).toEqual('<div><p>te<span id="2">s</span><span id="1">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 2},
                {...widget2, from: 3, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="1">t</span>e<span id="2">st</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 3},
                {...widget2, from: 3, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="1">te</span><span id="2">st</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 4},
                {...widget2, from: 3, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="1">te</span><span id="2">st</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 5},
                {...widget2, from: 3, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="1">te</span><span id="2">st</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 3},
                {...widget2, from: 3, to: 5},
            ],
        }),
    ).toEqual('<div><p>t<span id="1">e</span><span id="2">st</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 4},
                {...widget2, from: 3, to: 5},
            ],
        }),
    ).toEqual('<div><p>t<span id="1">e</span><span id="2">st</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 5},
                {...widget2, from: 3, to: 5},
            ],
        }),
    ).toEqual('<div><p>t<span id="1">e</span><span id="2">st</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 4},
                {...widget2, from: 3, to: 5},
            ],
        }),
    ).toEqual('<div><p>te<span id="2">st</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 5},
                {...widget2, from: 3, to: 5},
            ],
        }),
    ).toEqual('<div><p>te<span id="2">st</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 4, to: 5},
                {...widget2, from: 3, to: 5},
            ],
        }),
    ).toEqual('<div><p>te<span id="2">s</span><span id="1">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 2},
                {...widget2, from: 4, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="1">t</span>es<span id="2">t</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 3},
                {...widget2, from: 4, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="1">te</span>s<span id="2">t</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 4},
                {...widget2, from: 4, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="1">tes</span><span id="2">t</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 1, to: 5},
                {...widget2, from: 4, to: 5},
            ],
        }),
    ).toEqual('<div><p><span id="1">tes</span><span id="2">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 3},
                {...widget2, from: 4, to: 5},
            ],
        }),
    ).toEqual('<div><p>t<span id="1">e</span>s<span id="2">t</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 4},
                {...widget2, from: 4, to: 5},
            ],
        }),
    ).toEqual('<div><p>t<span id="1">es</span><span id="2">t</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 2, to: 5},
                {...widget2, from: 4, to: 5},
            ],
        }),
    ).toEqual('<div><p>t<span id="1">es</span><span id="2">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 4},
                {...widget2, from: 4, to: 5},
            ],
        }),
    ).toEqual('<div><p>te<span id="1">s</span><span id="2">t</span></p></div>');
    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 3, to: 5},
                {...widget2, from: 4, to: 5},
            ],
        }),
    ).toEqual('<div><p>te<span id="1">s</span><span id="2">t</span></p></div>');

    expect(
        serializeProsemirrorNodeToHtml(doc, {
            decorations: [
                {...widget1, from: 4, to: 5},
                {...widget2, from: 4, to: 5},
            ],
        }),
    ).toEqual('<div><p>tes<span id="2">t</span></p></div>');
});
