import {ApiContentKeyDecoder, ApiContentKeyEncoder} from "~/shared/api/content/api_content_key.js";
import {getApiContentPositionPos} from "~/shared/api/content/get_api_content_position_pos.js";
import {DocumentContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const documentEntityId = "Document:2hxv0y1b6zye9q87w2bt7fks3g";
const encoder = new ApiContentKeyEncoder({entityId: documentEntityId, version: 3});
const decoder = new ApiContentKeyDecoder(documentEntityId);
const paragraphNode = schema.nodes.paragraph.create(null, schema.text("Hello!"));
const emojiParagraphNode = schema.nodes.paragraph.create(null, schema.text("A👨‍👩‍👧‍👦B"));
const atomParagraphNode = schema.nodes.paragraph.create(null, [
    schema.nodes.break.create(),
    schema.text("Hi"),
]);
const fileNode = assertExists(schema.nodes.file).create({fileId: null});
const titleNode = schema.nodes.title.create(null, schema.text("Title"));

test("returns a ProseMirror position for an inline content position", () => {
    const key = encoder.encode({pos: 12, nodeSize: paragraphNode.nodeSize});
    const keyData = decoder.decode(key);

    expect(
        getApiContentPositionPos(keyData, {type: "Inline", key, index: 4}, paragraphNode, "Start"),
    ).toBe(17);
});

test("returns the exclusive ProseMirror end for an inclusive inline position", () => {
    const key = encoder.encode({pos: 12, nodeSize: paragraphNode.nodeSize});
    const keyData = decoder.decode(key);

    expect(
        getApiContentPositionPos(keyData, {type: "Inline", key, index: 4}, paragraphNode, "End"),
    ).toBe(18);
});

test("snaps inclusive inline positions to a whole grapheme", () => {
    const key = encoder.encode({pos: 12, nodeSize: emojiParagraphNode.nodeSize});
    const keyData = decoder.decode(key);

    expect({
        from: getApiContentPositionPos(
            keyData,
            {type: "Inline", key, index: 2},
            emojiParagraphNode,
            "Start",
        ),
        to: getApiContentPositionPos(
            keyData,
            {type: "Inline", key, index: 4},
            emojiParagraphNode,
            "End",
        ),
    }).toEqual({from: 14, to: 25});
});

test("counts Unicode code points instead of UTF-16 code units", () => {
    const key = encoder.encode({pos: 12, nodeSize: emojiParagraphNode.nodeSize});
    const keyData = decoder.decode(key);

    expect({
        from: getApiContentPositionPos(
            keyData,
            {type: "Inline", key, index: 8},
            emojiParagraphNode,
            "Start",
        ),
        to: getApiContentPositionPos(
            keyData,
            {type: "Inline", key, index: 8},
            emojiParagraphNode,
            "End",
        ),
    }).toEqual({from: 25, to: 26});
});

test("counts an atomic inline node as one index", () => {
    const key = encoder.encode({pos: 12, nodeSize: atomParagraphNode.nodeSize});
    const keyData = decoder.decode(key);

    expect(
        getApiContentPositionPos(
            keyData,
            {type: "Inline", key, index: 1},
            atomParagraphNode,
            "Start",
        ),
    ).toBe(14);
});

test("returns the node start for a before content position", () => {
    const key = encoder.encode({pos: 12, nodeSize: paragraphNode.nodeSize});
    const keyData = decoder.decode(key);

    expect(getApiContentPositionPos(keyData, {type: "Before", key}, paragraphNode, "Start")).toBe(
        12,
    );
});

test("returns the node end for an after content position", () => {
    const key = encoder.encode({pos: 12, nodeSize: paragraphNode.nodeSize});
    const keyData = decoder.decode(key);

    expect(getApiContentPositionPos(keyData, {type: "After", key}, paragraphNode, "End")).toBe(20);
});

test("rejects an inline content position before the start boundary", () => {
    const key = encoder.encode({pos: 12, nodeSize: paragraphNode.nodeSize});
    const keyData = decoder.decode(key);

    expect(() =>
        getApiContentPositionPos(keyData, {type: "Inline", key, index: -1}, paragraphNode, "Start"),
    ).toThrow("Index out of bounds");
});

test("rejects an inline content position at the exclusive end boundary", () => {
    const key = encoder.encode({pos: 12, nodeSize: paragraphNode.nodeSize});
    const keyData = decoder.decode(key);

    expect(() =>
        getApiContentPositionPos(keyData, {type: "Inline", key, index: 6}, paragraphNode, "End"),
    ).toThrow("Index out of bounds");
});

test("rejects a UTF-16 offset beyond the Unicode code point boundary", () => {
    const key = encoder.encode({pos: 12, nodeSize: emojiParagraphNode.nodeSize});
    const keyData = decoder.decode(key);

    expect(() =>
        getApiContentPositionPos(
            keyData,
            {type: "Inline", key, index: 9},
            emojiParagraphNode,
            "End",
        ),
    ).toThrow("Index out of bounds");
});

test("rejects a content key with a mismatched node size", () => {
    const key = encoder.encode({pos: 12, nodeSize: paragraphNode.nodeSize + 1});
    const keyData = decoder.decode(key);

    expect(() =>
        getApiContentPositionPos(keyData, {type: "Before", key}, paragraphNode, "Start"),
    ).toThrow("Invalid content key");
});

test("rejects a content key that does not resolve to a node", () => {
    const key = encoder.encode({pos: 12, nodeSize: paragraphNode.nodeSize});
    const keyData = decoder.decode(key);

    expect(() =>
        getApiContentPositionPos(keyData, {type: "Before", key}, undefined, "Start"),
    ).toThrow("Invalid content key");
});

test("accepts a content key for any existing node with a matching size", () => {
    const key = encoder.encode({pos: 12, nodeSize: titleNode.nodeSize});
    const keyData = decoder.decode(key);

    expect(getApiContentPositionPos(keyData, {type: "Before", key}, titleNode, "Start")).toBe(12);
});

test("rejects an inline position for a leaf node", () => {
    const key = encoder.encode({pos: 12, nodeSize: fileNode.nodeSize});
    const keyData = decoder.decode(key);

    expect(() =>
        getApiContentPositionPos(keyData, {type: "Inline", key, index: 0}, fileNode, "Start"),
    ).toThrow("Index out of bounds");
});

test("rejects an unknown content position type", () => {
    const key = encoder.encode({pos: 12, nodeSize: paragraphNode.nodeSize});
    const keyData = decoder.decode(key);

    expect(() =>
        getApiContentPositionPos(keyData, {type: "Unknown", key} as never, paragraphNode, "Start"),
    ).toThrow("Unexpected object of type");
});
