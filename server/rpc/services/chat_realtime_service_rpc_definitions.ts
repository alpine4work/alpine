import {defineServiceRpcs} from "~/server/rpc/services/internal/define_service_rpcs";
import {MessageChangeSchema} from "~/shared/messaging/message_change_schema";
import {ChatMessageModel} from "~/shared/models/chat_model";

export const ChatRealtimeServiceRpcDefinitions = defineServiceRpcs("ChatRealtimeService", {
    onCreateChatMessage: {
        input: {
            message: ChatMessageModel.schema(),
        },
        output: {},
    },
    onChangeChatMessage: {
        input: {
            messageChange: MessageChangeSchema,
        },
        output: {},
    },
});

export const {onCreateChatMessage, onChangeChatMessage} = ChatRealtimeServiceRpcDefinitions;
