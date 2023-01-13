import {DOMSerializer, Node, Schema} from "prosemirror-model";
import {marks as basicMarks, nodes as basicNodes} from "prosemirror-schema-basic";
import {assert} from "~/shared/helpers/control/assert";
import {
    serializeProsemirrorFragmentToHtml,
    serializeProsemirrorNodeToHtml,
} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";

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
        expect(expectedHtml).toEqual(testElement.innerHTML);
    });

    test(`works with ${name} (fragment)`, () => {
        const fragment = serializer.serializeFragment(node.content);
        const element = document.createElement("div");
        element.appendChild(fragment);
        const expectedHTML = element.innerHTML;

        const testElement = document.createElement("div");
        testElement.innerHTML = serializeProsemirrorFragmentToHtml(node.content);
        expect(expectedHTML).toEqual(testElement.innerHTML);
    });
}
