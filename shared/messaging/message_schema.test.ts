import {agentToolAnnotations} from "~/shared/agents/agent_tool_annotations.js";
import {fromApiLabelContent} from "~/shared/api/content/closed_source/from_api_label_content.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {DocumentId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {
    MessageContentPayloadSchema,
    MessageStreamToolCallPartPayloadSchema,
} from "~/shared/messaging/message_schema.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {JsonStringifiableUint8Array} from "~/shared/schema/schema.js";

test("serializes message content payload with null `parent` and null `contentUpdate`", () => {
    const serializedMessage = MessageContentPayloadSchema.serialize({
        type: "Content",
        parent: null,
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: null,
        fileIds: [],
        reactionsByPos: emptyMap,
        filesReactions: emptyReactionSet,
    });

    expect(serializedMessage).toEqual({
        type: "Content",
        parentMessageIndex: null,
        content: createSimpleMessageContent("Hello, world!").toJSON(),
        contentUpdatedTime: null,
        fileIds: [],
        reactionsByPos: [],
        filesReactions: new JsonStringifiableUint8Array(0),
    });

    const deserialized = MessageContentPayloadSchema.deserialize(serializedMessage);
    expect(deserialized).toMatchObject({
        type: "Content",
        parent: null,
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: null,
        fileIds: [],
        reactionsByPos: emptyMap,
    });
    expect(deserialized.filesReactions.get()).toEqual(emptyReactionSet.get());
});

test("serializes message content payload with message `parent` and null `contentUpdate`", () => {
    const serializedMessage = MessageContentPayloadSchema.serialize({
        type: "Content",
        parent: {type: "Message", index: 42},
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: null,
        fileIds: [],
        reactionsByPos: emptyMap,
        filesReactions: emptyReactionSet,
    });

    expect(serializedMessage).toEqual({
        type: "Content",
        parentMessageIndex: 42,
        parent: {type: "Message"},
        content: createSimpleMessageContent("Hello, world!").toJSON(),
        contentUpdatedTime: null,
        fileIds: [],
        reactionsByPos: [],
        filesReactions: new JsonStringifiableUint8Array(0),
    });

    const deserialized = MessageContentPayloadSchema.deserialize(serializedMessage);
    expect(deserialized).toMatchObject({
        type: "Content",
        parent: {type: "Message", index: 42},
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: null,
        fileIds: [],
        reactionsByPos: emptyMap,
    });
    expect(deserialized.filesReactions.get()).toEqual(emptyReactionSet.get());
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
        filesReactions: emptyReactionSet,
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
        filesReactions: new JsonStringifiableUint8Array(0),
    });

    const deserialized = MessageContentPayloadSchema.deserialize(serializedMessage);
    expect(deserialized).toMatchObject({
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
    expect(deserialized.filesReactions.get()).toEqual(emptyReactionSet.get());
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
        filesReactions: emptyReactionSet,
    });

    expect(serializedMessage).toEqual({
        type: "Content",
        parentMessageIndex: null,
        content: createSimpleMessageContent("Hello, world!").toJSON(),
        contentUpdatedTime: currentTime.toISOString(),
        contentUpdate: {mappings: []},
        fileIds: [],
        reactionsByPos: [],
        filesReactions: new JsonStringifiableUint8Array(0),
    });

    const deserialized = MessageContentPayloadSchema.deserialize(serializedMessage);
    expect(deserialized).toMatchObject({
        type: "Content",
        parent: null,
        content: createSimpleMessageContent("Hello, world!"),
        contentUpdate: {time: currentTime, mappings: []},
        fileIds: [],
        reactionsByPos: emptyMap,
    });
    expect(deserialized.filesReactions.get()).toEqual(emptyReactionSet.get());
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
        filesReactions: emptyReactionSet,
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
        filesReactions: emptyReactionSet,
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
        filesReactions: emptyReactionSet,
    });
});

test("deserializes a legacy read message stream tool call", () => {
    const documentId = generateId<DocumentId>();
    const serializedToolCall = {
        type: "ToolCall",
        call: {
            type: "Read",
            targetPath: `/documents/${documentId}`,
        },
    };

    expect(MessageStreamToolCallPartPayloadSchema.deserialize(serializedToolCall)).toEqual({
        type: "ToolCall",
        call: {
            content: fromApiLabelContent({
                elements: [
                    {type: "Text", text: "Reading "},
                    {
                        type: "Mention",
                        reference: {
                            type: "Document",
                            id: documentId,
                        },
                    },
                ],
            }),
            annotations: agentToolAnnotations.read,
        },
    });
});

test("deserializes a legacy search message stream tool call", () => {
    expect(
        MessageStreamToolCallPartPayloadSchema.deserialize({
            type: "ToolCall",
            call: {type: "Search", query: "quarterly plan"},
        }),
    ).toEqual({
        type: "ToolCall",
        call: {
            content: createSimpleMessageContent("Searching \u201Cquarterly plan\u201D"),
            annotations: agentToolAnnotations.search,
        },
    });
});

test("deserializes a legacy create message stream tool call", () => {
    const taskId = generateId<TaskId>();

    expect(
        MessageStreamToolCallPartPayloadSchema.deserialize({
            type: "ToolCall",
            call: {
                type: "Create",
                target: {type: "Task", id: taskId},
            },
        }),
    ).toEqual({
        type: "ToolCall",
        call: {
            content: fromApiLabelContent({
                elements: [
                    {type: "Text", text: "Created "},
                    {
                        type: "Mention",
                        reference: {type: "Task", id: taskId},
                    },
                ],
            }),
            annotations: agentToolAnnotations.create,
        },
    });
});

test("deserializes caller-generated tool-call content without a stored call type", () => {
    const content = createSimpleMessageContent("Updating roadmap");

    expect(
        MessageStreamToolCallPartPayloadSchema.deserialize({
            type: "ToolCall",
            call: {content: content.toJSON()},
        }),
    ).toEqual({
        type: "ToolCall",
        call: {content},
    });
});

test("serializes caller-generated tool-call content as the current schema variant", () => {
    const content = createSimpleMessageContent("Searching \u201Cquarterly plan\u201D");

    expect(
        MessageStreamToolCallPartPayloadSchema.serialize({
            type: "ToolCall",
            call: {
                content,
                annotations: agentToolAnnotations.search,
            },
        }),
    ).toEqual({
        type: "ToolCall",
        call: {
            type: "Generic",
            content: content.toJSON(),
            annotations: {
                title: "Search",
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
    });
});
