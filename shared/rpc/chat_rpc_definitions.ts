import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {ChatId} from "~/shared/id/types/id_types";
import {ChatMessageModel} from "~/shared/models/chat_model";
import {defineRpc} from "~/shared/rpc/internal/define_rpc";
import {Schema} from "~/shared/schema/schema";

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
