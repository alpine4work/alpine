import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageChangeSchema} from "~/shared/messaging/message_change_schema.js";
import {
    MessageContentSchema,
    MessageContentStepSchema,
} from "~/shared/messaging/message_content_schema.js";
import {
    MessageReferencedIdsSchema,
    MessageReferencesSchema,
} from "~/shared/messaging/message_references.js";
import {MessageContentPayloadContentUpdateSchema} from "~/shared/messaging/message_schema.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

export const getChatMessagesFromStart = defineRpc({
    name: "getChatMessagesFromStart",
    input: {
        chatId: Schema.id<ChatId>(),
        limit: Schema.integer,
        afterMessageIndex: Schema.integer.nullable(),
        beforeMessageIndex: Schema.integer.nullable(),
    },
    output: {
        messageCount: Schema.integer,
        messages: Schema.array(ChatMessageModel.schema()),
        otherReferencedMessages: Schema.array(ChatMessageModel.schema()),
        lastMessageChangeTime: Schema.date.nullable(),
    },
});

export const getChatMessagesFromEnd = defineRpc({
    name: "getChatMessagesFromEnd",
    input: {
        chatId: Schema.id<ChatId>(),
        limit: Schema.integer,
        afterMessageIndex: Schema.integer.nullable(),
        beforeMessageIndex: Schema.integer.nullable(),
    },
    output: {
        messageCount: Schema.integer,
        messages: Schema.array(ChatMessageModel.schema()),
        otherReferencedMessages: Schema.array(ChatMessageModel.schema()),
        lastMessageChangeTime: Schema.date.nullable(),
    },
});

export const authorizeChatAccess = defineRpc({
    name: "authorizeChatAccess",
    input: {
        chatId: Schema.id<ChatId>(),
    },
    output: {
        spaceId: Schema.id<SpaceId>(),
    },
});

export const sendChatMessage = defineRpc({
    name: "sendChatMessage",
    input: {
        chatId: Schema.id<ChatId>(),
        parentMessageIndex: Schema.integer.nullable(),
        content: MessageContentSchema,
        fileIds: Schema.array(FileIdOrFileEntityIdSchema).default([]),
    },
    output: {
        index: Schema.integer,
        createdTime: Schema.date,
    },
});

export const updateChatMessageContent = defineRpc({
    name: "updateChatMessageContent",
    input: {
        chatId: Schema.id<ChatId>(),
        messageIndex: Schema.integer,
        version: Schema.integer,
        steps: Schema.array(MessageContentStepSchema),
    },
    output: {
        content: MessageContentSchema,
        contentUpdate: MessageContentPayloadContentUpdateSchema,
    },
});

export const deleteChatMessage = defineRpc({
    name: "deleteChatMessage",
    input: {
        chatId: Schema.id<ChatId>(),
        messageIndex: Schema.integer,
    },
    output: {
        deletedTime: Schema.date,
    },
});

export const backfillChatMessages = defineRpc({
    name: "backfillChatMessages",
    input: {
        chatId: Schema.id<ChatId>(),
        clientMessageCount: Schema.integer,
        clientLastMessageChangeTime: Schema.date.nullable(),
        newMessageLimit: Schema.integer,
    },
    output: {
        messageCount: Schema.integer,
        lastMessageChangeTime: Schema.date.nullable(),
        newMessages: Schema.array(ChatMessageModel.schema()),
        newOtherReferencedMessages: Schema.array(ChatMessageModel.schema()),
        messageChangesResult: Schema.union({
            Available: Schema.object({
                type: Schema.value("Available"),
                changes: Schema.array(MessageChangeSchema),
            }),
            Unavailable: Schema.object({
                type: Schema.value("Unavailable"),
            }),
        }),
    },
});

export const getChatMessageReferences = defineRpc({
    name: "getChatMessageReferences",
    input: {
        spaceId: Schema.id<SpaceId>(),
        chatId: Schema.id<ChatId>(),
        referencedIds: MessageReferencedIdsSchema,
    },
    output: {
        references: MessageReferencesSchema,
    },
});
