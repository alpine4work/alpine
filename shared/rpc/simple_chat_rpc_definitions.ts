import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {SimpleChatId} from "~/shared/id/types/id_types";
import {defineRpc} from "~/shared/rpc/internal/define_rpc";
import {Schema} from "~/shared/schema/schema";

export const createSimpleChatMessage = defineRpc({
    name: "createSimpleChatMessage",
    input: {
        simpleChatId: Schema.id<SimpleChatId>(),
        parentMessageId: Schema.integer.nullable(),
        content: MessageContentSchema,
    },
    output: {},
});
