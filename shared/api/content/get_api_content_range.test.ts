import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key.js";
import {getApiContentRange} from "~/shared/api/content/get_api_content_range.js";
import {DocumentContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {generateId} from "~/shared/id/id.js";

const entityId = `Document:${generateId()}`;

test("decodes and validates an inline range", async () => {
    const content = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("paragraph", undefined, [schema.text("Hello")]),
    ]);
    const encoder = new ApiContentKeyEncoder({entityId, version: 2});
    const paragraphKey = encoder.encode({pos: 2, nodeSize: content.nodeAt(2)!.nodeSize});

    await expect(
        getApiContentRange({
            entityId,
            latestVersion: 3,
            range: {
                start: {type: "Inline", key: paragraphKey, index: 1},
                end: {type: "Inline", key: paragraphKey, index: 4},
            },
            getContentAtVersion: async () => content,
        }),
    ).resolves.toMatchObject({
        version: 2,
        contentAtVersion: content,
        from: 4,
        to: 8,
        startNodePos: 2,
        isTargetingWholeLeafNode: false,
    });
});

test("accepts a single inclusive inline position", async () => {
    const content = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("paragraph", undefined, [schema.text("Hello")]),
    ]);
    const encoder = new ApiContentKeyEncoder({entityId, version: 2});
    const paragraphKey = encoder.encode({pos: 2, nodeSize: content.nodeAt(2)!.nodeSize});

    await expect(
        getApiContentRange({
            entityId,
            latestVersion: 2,
            range: {
                start: {type: "Inline", key: paragraphKey, index: 1},
                end: {type: "Inline", key: paragraphKey, index: 1},
            },
            getContentAtVersion: async () => content,
        }),
    ).resolves.toMatchObject({from: 4, to: 5});
});

test("does not treat the same leaf node object at different positions as one whole node", async () => {
    const fileNode = schema.node("file", {fileId: `Document:${generateId()}`});
    const content = schema.node("doc", undefined, [
        schema.node("title"),
        schema.node("fileRow", undefined, [fileNode, fileNode]),
    ]);
    const encoder = new ApiContentKeyEncoder({entityId, version: 0});
    const firstKey = encoder.encode({pos: 3, nodeSize: fileNode.nodeSize});
    const secondKey = encoder.encode({pos: 4, nodeSize: fileNode.nodeSize});

    await expect(
        getApiContentRange({
            entityId,
            latestVersion: 0,
            range: {
                start: {type: "Before", key: firstKey},
                end: {type: "After", key: secondKey},
            },
            getContentAtVersion: async () => content,
        }),
    ).resolves.toMatchObject({isTargetingWholeLeafNode: false});
});

test("rejects positions from different versions", async () => {
    const content = schema.node("doc", undefined, [schema.node("title"), schema.node("paragraph")]);
    const version0Key = new ApiContentKeyEncoder({entityId, version: 0}).encode({
        pos: 2,
        nodeSize: content.nodeAt(2)!.nodeSize,
    });
    const version1Key = new ApiContentKeyEncoder({entityId, version: 1}).encode({
        pos: 2,
        nodeSize: content.nodeAt(2)!.nodeSize,
    });

    await expect(
        getApiContentRange({
            entityId,
            latestVersion: 1,
            range: {
                start: {type: "Inline", key: version0Key, index: 0},
                end: {type: "Inline", key: version1Key, index: 1},
            },
            getContentAtVersion: async () => content,
        }),
    ).rejects.toThrow("Item target range start and end must be for the same item version");
});

test("rejects a future version before loading content", async () => {
    const content = schema.node("doc", undefined, [schema.node("title"), schema.node("paragraph")]);
    const key = new ApiContentKeyEncoder({entityId, version: 2}).encode({
        pos: 2,
        nodeSize: content.nodeAt(2)!.nodeSize,
    });
    let didLoadContent = false;
    const getContentAtVersion = async () => {
        didLoadContent = true;
        return content;
    };

    await expect(
        getApiContentRange({
            entityId,
            latestVersion: 1,
            range: {
                start: {type: "Inline", key, index: 0},
                end: {type: "Inline", key, index: 1},
            },
            getContentAtVersion,
        }),
    ).rejects.toThrow("Item target range version is newer than the content");
    expect(didLoadContent).toEqual(false);
});
