import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {MessageContentSchema} from "~/shared/messaging/message_content_schema.js";
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

export const sendChatMessage = defineRpc({
    name: "sendChatMessage",
    input: {
        chatId: Schema.id<ChatId>(),
        parentMessageIndex: Schema.integer.nullable(),
        content: MessageContentSchema,
    },
    output: {},
});
