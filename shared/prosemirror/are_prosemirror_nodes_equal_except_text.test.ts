import {schema} from "prosemirror-schema-basic";
import {areProsemirrorNodesEqualExceptText} from "~/shared/prosemirror/are_prosemirror_nodes_equal_except_text.js";

test("identical nodes return true", () => {
    const node = schema.node("paragraph", null, [schema.text("hello")]);
    expect(areProsemirrorNodesEqualExceptText(node, node)).toBe(true);
});

test("nodes with same structure but different text return true", () => {
    const node1 = schema.node("paragraph", null, [schema.text("hello")]);
    const node2 = schema.node("paragraph", null, [schema.text("world")]);
    expect(areProsemirrorNodesEqualExceptText(node1, node2)).toBe(true);
});

test("nodes with different types return false", () => {
    const node1 = schema.node("paragraph", null, [schema.text("hello")]);
    const node2 = schema.node("heading", {level: 1}, [schema.text("hello")]);
    expect(areProsemirrorNodesEqualExceptText(node1, node2)).toBe(false);
});

test("nodes with different attributes return false", () => {
    const node1 = schema.node("heading", {level: 1}, [schema.text("hello")]);
    const node2 = schema.node("heading", {level: 2}, [schema.text("hello")]);
    expect(areProsemirrorNodesEqualExceptText(node1, node2)).toBe(false);
});

test("nodes with different marks return false", () => {
    const node1 = schema.node("paragraph", null, [schema.text("hello", [schema.mark("strong")])]);
    const node2 = schema.node("paragraph", null, [schema.text("hello", [schema.mark("em")])]);
    expect(areProsemirrorNodesEqualExceptText(node1, node2)).toBe(false);
});

test("nodes with same marks but different text return true", () => {
    const node1 = schema.node("paragraph", null, [schema.text("hello", [schema.mark("strong")])]);
    const node2 = schema.node("paragraph", null, [schema.text("world", [schema.mark("strong")])]);
    expect(areProsemirrorNodesEqualExceptText(node1, node2)).toBe(true);
});

test("nodes with different number of children return false", () => {
    const node1 = schema.node("paragraph", null, [schema.text("hello")]);
    const node2 = schema.node("paragraph", null, [
        schema.text("hello"),
        schema.text(" world", [schema.mark("strong")]),
    ]);
    expect(areProsemirrorNodesEqualExceptText(node1, node2)).toBe(false);
});

test("empty nodes return true", () => {
    const node1 = schema.node("paragraph", null, []);
    const node2 = schema.node("paragraph", null, []);
    expect(areProsemirrorNodesEqualExceptText(node1, node2)).toBe(true);
});

test("nested nodes with same structure but different text return true", () => {
    const node1 = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("first")]),
        schema.node("paragraph", null, [schema.text("second")]),
    ]);
    const node2 = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("third")]),
        schema.node("paragraph", null, [schema.text("fourth")]),
    ]);
    expect(areProsemirrorNodesEqualExceptText(node1, node2)).toBe(true);
});

test("nested nodes with different structure return false", () => {
    const node1 = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("first")]),
        schema.node("paragraph", null, [schema.text("second")]),
    ]);
    const node2 = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("first")]),
        schema.node("heading", {level: 1}, [schema.text("second")]),
    ]);
    expect(areProsemirrorNodesEqualExceptText(node1, node2)).toBe(false);
});

test("deeply nested nodes with same structure return true", () => {
    const node1 = schema.node("doc", null, [
        schema.node("blockquote", null, [
            schema.node("paragraph", null, [schema.text("nested text")]),
        ]),
    ]);
    const node2 = schema.node("doc", null, [
        schema.node("blockquote", null, [
            schema.node("paragraph", null, [schema.text("different text")]),
        ]),
    ]);
    expect(areProsemirrorNodesEqualExceptText(node1, node2)).toBe(true);
});

test("nodes with mixed content but same structure return true", () => {
    const node1 = schema.node("paragraph", null, [
        schema.text("hello "),
        schema.text("world", [schema.mark("strong")]),
        schema.text("!"),
    ]);
    const node2 = schema.node("paragraph", null, [
        schema.text("foo "),
        schema.text("bar", [schema.mark("strong")]),
        schema.text("?"),
    ]);
    expect(areProsemirrorNodesEqualExceptText(node1, node2)).toBe(true);
});

test("nodes with mixed content but different marks return false", () => {
    const node1 = schema.node("paragraph", null, [
        schema.text("hello "),
        schema.text("world", [schema.mark("strong")]),
        schema.text("!"),
    ]);
    const node2 = schema.node("paragraph", null, [
        schema.text("foo ", [schema.mark("em")]),
        schema.text("bar", [schema.mark("strong")]),
        schema.text("?"),
    ]);
    expect(areProsemirrorNodesEqualExceptText(node1, node2)).toBe(false);
});

test("nodes with different mark counts return false", () => {
    const node1 = schema.node("paragraph", null, [schema.text("hello", [schema.mark("strong")])]);
    const node2 = schema.node("paragraph", null, [
        schema.text("hello", [schema.mark("strong"), schema.mark("em")]),
    ]);
    expect(areProsemirrorNodesEqualExceptText(node1, node2)).toBe(false);
});

test("code blocks with same structure but different text return true", () => {
    const node1 = schema.node("code_block", null, [schema.text("const x = 1;")]);
    const node2 = schema.node("code_block", null, [schema.text("const y = 2;")]);
    expect(areProsemirrorNodesEqualExceptText(node1, node2)).toBe(true);
});
