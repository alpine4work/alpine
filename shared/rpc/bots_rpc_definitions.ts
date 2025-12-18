import {BotSchema} from "~/shared/bots/bot_schema.js";
import {AvatarId, BotId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

export const finishUploadingBotAvatar = defineRpc({
    name: "finishUploadingBotAvatar",
    isIdempotent: true,
    input: {
        avatarContent: Schema.bytes,
        avatarId: Schema.id<AvatarId>(),
        botId: Schema.id<BotId>(),
    },
    output: {
        bot: BotSchema,
    },
});
