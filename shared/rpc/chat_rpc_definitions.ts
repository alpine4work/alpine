import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {
    MessageContentSchema,
    MessageContentStepSchema,
} from "~/shared/content/message_content_schema.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessagePosOrFilesSchema} from "~/shared/messaging/message_pos_or_files_schema.js";
import {
    MessageReferencedIdsSchema,
    MessageReferencesSchema,
} from "~/shared/messaging/message_references.js";
import {MessageContentPayloadParentSchema} from "~/shared/messaging/message_schema.js";
import {createMessageUpdatesBackfillResultSchema} from "~/shared/messaging/messaging_realtime_protocol.js";
import {ReactionOrGenericLikeSchema} from "~/shared/reactions/reaction_schema.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchMentionEntityIdSchema} from "~/shared/search/search_entity_id.js";
import {ServerSynchronizationCheckpointSchema} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export const getChatMessagesFromStart = defineRpc({
    name: "getChatMessagesFromStart",
    isIdempotent: true,
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
    },
});

export const getChatMessagesFromEnd = defineRpc({
    name: "getChatMessagesFromEnd",
    isIdempotent: true,
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
    },
});

export const authorizeChatAccess = defineRpc({
    name: "authorizeChatAccess",
    isIdempotent: true,
    input: {
        chatId: Schema.id<ChatId>(),
    },
    output: {
        spaceId: Schema.id<SpaceId>(),
    },
});

export const sendChatMessage = defineRpc({
    name: "sendChatMessage",
    // We create two messages if sent twice.
    isIdempotent: false,
    input: {
        chatId: Schema.id<ChatId>(),
        parent: MessageContentPayloadParentSchema.nullable(),
        content: MessageContentSchema,
        fileIds: Schema.array(FileIdOrFileEntityIdSchema).default([]),
        createdTimeZone: TimeZoneSchema,
        dangerousCurrentlyViewingSearchEntityId: SearchMentionEntityIdSchema.optional(),
    },
    output: {
        index: Schema.integer,
        createdTime: Schema.date,
    },
});

export const updateChatMessageContent = defineRpc({
    name: "updateChatMessageContent",
    // Fails if `contentVersion` isn't the current version.
    isIdempotent: false,
    input: {
        chatId: Schema.id<ChatId>(),
        messageIndex: Schema.integer,
        contentVersion: Schema.integer,
        steps: Schema.array(MessageContentStepSchema),
    },
    output: {
        version: Schema.integer,
    },
});

export const deleteChatMessage = defineRpc({
    name: "deleteChatMessage",
    // Fails if the message is already deleted.
    isIdempotent: false,
    input: {
        chatId: Schema.id<ChatId>(),
        messageIndex: Schema.integer,
    },
    output: {
        version: Schema.integer,
    },
});

export const setChatMessageReaction = defineRpc({
    name: "setChatMessageReaction",
    isIdempotent: true,
    input: {
        chatId: Schema.id<ChatId>(),
        messageIndex: Schema.integer,
        contentVersion: Schema.integer,
        pos: MessagePosOrFilesSchema,
        reaction: ReactionOrGenericLikeSchema,
    },
    output: {
        version: Schema.integer,
    },
});

export const deleteChatMessageReaction = defineRpc({
    name: "deleteChatMessageReaction",
    isIdempotent: true,
    input: {
        chatId: Schema.id<ChatId>(),
        messageIndex: Schema.integer,
        contentVersion: Schema.integer,
        pos: MessagePosOrFilesSchema,
    },
    output: {
        version: Schema.integer,
    },
});

export const backfillChatMessages = defineRpc({
    name: "backfillChatMessages",
    isIdempotent: true,
    input: {
        chatId: Schema.id<ChatId>(),
        checkpoint: ServerSynchronizationCheckpointSchema,
        clientMessageCount: Schema.integer,
        newMessageLimit: Schema.integer,
    },
    output: {
        messageCount: Schema.integer,
        newMessages: Schema.array(ChatMessageModel.schema()),
        newOtherReferencedMessages: Schema.array(ChatMessageModel.schema()),
        messageUpdatesResult: createMessageUpdatesBackfillResultSchema(ChatMessageModel.schema()),
    },
});

export const getChatMessageAtVersion = defineRpc({
    name: "getChatMessageAtVersion",
    isIdempotent: true,
    input: {
        chatId: Schema.id<ChatId>(),
        messageIndex: Schema.integer,
        version: Schema.integer,
    },
    output: {
        message: ChatMessageModel.schema(),
    },
});

export const getChatMessageReferences = defineRpc({
    name: "getChatMessageReferences",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        chatId: Schema.id<ChatId>(),
        referencedIds: MessageReferencedIdsSchema,
    },
    output: {
        references: MessageReferencesSchema,
    },
});
