import {AccountId, SpaceId} from "~/shared/id/types/id_types";
import {ChatModel} from "~/shared/models/chat_model";
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
