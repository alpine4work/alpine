import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types";
import {ChatMessageModel, ChatModel} from "~/shared/models/chat_model";
import {defineRpc} from "~/shared/rpc/internal/define_rpc";
import {Schema} from "~/shared/schema/schema";

export const getChatRecommendations = defineRpc({
    name: "getChatRecommendations",
    input: {
        spaceId: Schema.id<SpaceId>(),
        otherAccountIds: Schema.array(Schema.id<AccountId>()),
    },
    output: {
        exactMatch: Schema.object({
            chat: ChatModel.schema(),
            // TODO(calebmer): Return initial messages for chat
        }).nullable(),
        chatRecommendations: Schema.array(ChatModel.schema()),
    },
});

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

export const sendChatMessage = defineRpc({
    name: "sendChatMessage",
    input: {
        chatId: Schema.id<ChatId>(),
        parentMessageIndex: Schema.integer.nullable(),
        content: MessageContentSchema,
    },
    output: {},
});

export const sendChatMessageToAccounts = defineRpc({
    name: "sendChatMessageToAccounts",
    input: {
        spaceId: Schema.id<SpaceId>(),
        otherAccountIds: Schema.array(Schema.id<AccountId>()),
        parentMessageIndex: Schema.integer.nullable(),
        content: MessageContentSchema,
    },
    output: {},
});

export const updateChatMessageContent = defineRpc({
    name: "updateChatMessageContent",
    input: {
        chatId: Schema.id<ChatId>(),
        messageIndex: Schema.integer,
        content: MessageContentSchema,
    },
    output: {},
});

export const deleteChatMessage = defineRpc({
    name: "deleteChatMessage",
    input: {
        chatId: Schema.id<ChatId>(),
        messageIndex: Schema.integer,
    },
    output: {},
});
