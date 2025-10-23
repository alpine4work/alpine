import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayloadSchema} from "~/shared/messaging/message_schema.js";

test("serializes message content payload with null `parent` and null `contentUpdate`", () => {
    const serializedMessage = MessageContentPayloadSchema.serialize({
        type: "Content",
        parent: null,
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: null,
        fileIds: [],
        reactionsByPos: emptyMap,
    });

    expect(serializedMessage).toEqual({
        type: "Content",
        parentMessageIndex: null,
        content: createSimpleMessageContent("Hello, world!").toJSON(),
        contentUpdatedTime: null,
        fileIds: [],
        reactionsByPos: [],
    });

    expect(MessageContentPayloadSchema.deserialize(serializedMessage)).toEqual({
        type: "Content",
        parent: null,
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: null,
        fileIds: [],
        reactionsByPos: emptyMap,
    });
});

test("serializes message content payload with message `parent` and null `contentUpdate`", () => {
    const serializedMessage = MessageContentPayloadSchema.serialize({
        type: "Content",
        parent: {type: "Message", index: 42},
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: null,
        fileIds: [],
        reactionsByPos: emptyMap,
    });

    expect(serializedMessage).toEqual({
        type: "Content",
        parentMessageIndex: 42,
        parent: {type: "Message"},
        content: createSimpleMessageContent("Hello, world!").toJSON(),
        contentUpdatedTime: null,
        fileIds: [],
        reactionsByPos: [],
    });

    expect(MessageContentPayloadSchema.deserialize(serializedMessage)).toEqual({
        type: "Content",
        parent: {type: "Message", index: 42},
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: null,
        fileIds: [],
        reactionsByPos: emptyMap,
    });
});

test("serializes message content payload with message range `parent` and null `contentUpdate`", () => {
    const serializedMessage = MessageContentPayloadSchema.serialize({
        type: "Content",
        parent: {
            type: "MessagesRange",
            startIndex: 3,
            startPos: 0,
            startContentVersion: 0,
            endIndex: 5,
            endPos: 2,
            endContentVersion: 0,
        },
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: null,
        fileIds: [],
        reactionsByPos: emptyMap,
    });

    expect(serializedMessage).toEqual({
        type: "Content",
        parent: {
            type: "MessagesRange",
            startIndex: 3,
            startPos: 0,
            startVersion: 0,
            endIndex: 5,
            endPos: 2,
            endVersion: 0,
        },
        content: createSimpleMessageContent("Hello, world!").toJSON(),
        contentUpdatedTime: null,
        fileIds: [],
        reactionsByPos: [],
    });

    expect(MessageContentPayloadSchema.deserialize(serializedMessage)).toEqual({
        type: "Content",
        parent: {
            type: "MessagesRange",
            startIndex: 3,
            startPos: 0,
            startContentVersion: 0,
            endIndex: 5,
            endPos: 2,
            endContentVersion: 0,
        },
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: null,
        fileIds: [],
        reactionsByPos: emptyMap,
    });
});

test("serializes message content payload with null `parent` and some `contentUpdate`", () => {
    const currentTime = new Date();

    const serializedMessage = MessageContentPayloadSchema.serialize({
        type: "Content",
        parent: null,
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: {time: currentTime, mappings: []},
        fileIds: [],
        reactionsByPos: emptyMap,
    });

    expect(serializedMessage).toEqual({
        type: "Content",
        parentMessageIndex: null,
        content: createSimpleMessageContent("Hello, world!").toJSON(),
        contentUpdatedTime: currentTime.toISOString(),
        contentUpdate: {mappings: []},
        fileIds: [],
        reactionsByPos: [],
    });

    expect(MessageContentPayloadSchema.deserialize(serializedMessage)).toEqual({
        type: "Content",
        parent: null,
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: {time: currentTime, mappings: []},
        fileIds: [],
        reactionsByPos: emptyMap,
    });
});

test("deserializes message content payload with missing `parentMessageIndex` and some `contentUpdatedTime`", () => {
    const currentTime = new Date();

    expect(
        MessageContentPayloadSchema.deserialize({
            type: "Content",
            content: createSimpleMessageContent("Hello, world!").toJSON(),
            contentUpdatedTime: currentTime.toISOString(),
            contentUpdate: {mappings: []},
            fileIds: [],
        }),
    ).toEqual({
        type: "Content",
        parent: null,
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: {
            time: currentTime,
            mappings: [],
        },
        fileIds: [],
        reactionsByPos: emptyMap,
    });
});

test("deserializes message content payload with null `parentMessageIndex` and missing `contentUpdatedTime`", () => {
    expect(
        MessageContentPayloadSchema.deserialize({
            type: "Content",
            parentMessageIndex: null,
            content: createSimpleMessageContent("Hello, world!").toJSON(),
            fileIds: [],
        }),
    ).toEqual({
        type: "Content",
        parent: null,
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: null,
        fileIds: [],
        reactionsByPos: emptyMap,
    });
});

test("deserializes message content payload with missing `parentMessageIndex`, missing `contentUpdatedTime`, and missing `fileIds`", () => {
    expect(
        MessageContentPayloadSchema.deserialize({
            type: "Content",
            content: createSimpleMessageContent("Hello, world!").toJSON(),
        }),
    ).toEqual({
        type: "Content",
        parent: null,
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: null,
        fileIds: [],
        reactionsByPos: emptyMap,
    });
});
