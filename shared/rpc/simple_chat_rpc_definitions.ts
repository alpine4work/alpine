import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {SimpleChatId} from "~/shared/id/types/id_types";
import {SimpleChatMessageModel} from "~/shared/models/simple_chat_model";
import {defineRpc} from "~/shared/rpc/internal/define_rpc";
import {Schema} from "~/shared/schema/schema";

export const createSimpleChatMessage = defineRpc({
    name: "createSimpleChatMessage",
    input: {
        simpleChatId: Schema.id<SimpleChatId>(),
        parentMessageIndex: Schema.integer.nullable(),
        content: MessageContentSchema,
    },
    output: {},
});

export const getSimpleChatMessagesFromStart = defineRpc({
    name: "getSimpleChatMessagesFromStart",
    input: {
        simpleChatId: Schema.id<SimpleChatId>(),
        limit: Schema.integer,
        afterMessageIndex: Schema.integer.nullable(),
        beforeMessageIndex: Schema.integer.nullable(),
    },
    output: {
        hasMoreMessagesAfter: Schema.boolean,
        messages: Schema.array(SimpleChatMessageModel.schema()),
    },
});

export const getSimpleChatMessagesFromEnd = defineRpc({
    name: "getSimpleChatMessagesFromEnd",
    input: {
        simpleChatId: Schema.id<SimpleChatId>(),
        limit: Schema.integer,
        afterMessageIndex: Schema.integer.nullable(),
        beforeMessageIndex: Schema.integer.nullable(),
    },
    output: {
        hasMoreMessagesBefore: Schema.boolean,
        messages: Schema.array(SimpleChatMessageModel.schema()),
    },
});
