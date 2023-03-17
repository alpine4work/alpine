import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types";
import {ChatMessageModel, ChatModel} from "~/shared/models/chat_model";
import {defineRpc} from "~/shared/rpc/internal/define_rpc";
import {Schema} from "~/shared/schema/schema";

export const getRecommendedChats = defineRpc({
    name: "getRecommendedChats",
    input: {
        spaceId: Schema.id<SpaceId>(),
        otherAccountIds: Schema.array(Schema.id<AccountId>()),
        exactMatchInitialMessagesLimit: Schema.integer,
    },
    output: {
        /**
         * If a chat exists between all the provided accounts, our current account, and
         * no other accounts then we will populate this object with that chat.
         * Otherwise returns null.
         */
        exactMatch: Schema.object({
            chat: ChatModel.schema(),
            initialMessages: Schema.array(ChatMessageModel.schema()),
            initialOtherReferencedMessages: Schema.array(ChatMessageModel.schema()),
        }).nullable(),

        /**
         * Some recommended chats that are shared between the current account and at
         * least one of the provided accounts. Ranked by relevance to the current
         * account.
         */
        recommendedChats: Schema.array(ChatModel.schema()),
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
    output: {
        chat: ChatModel.schema(),
    },
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
