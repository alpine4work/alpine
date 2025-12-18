import {finishUploadingBotAvatar} from "~/server/bots/bots_table.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import * as definitions from "~/shared/rpc/bots_rpc_definitions.js";

export default implementRpcs(definitions, {
    finishUploadingBotAvatar: {
        visibility: ["EdgeService"],
        execute: async (context, input) => {
            const bot = await finishUploadingBotAvatar(context.actor.authorizeSession(), {
                avatarContent: input.avatarContent,
                avatarId: input.avatarId,
                botId: input.botId,
            });
            return {bot};
        },
    },
});
