import {finishUploadingBotAvatar} from "~/server/bots/finish_uploading_bot_avatar.js";
import {updateBotSpaceAccountSettingsPropertyValue} from "~/server/bots/with_spaces/update_bot_space_account_settings_property_value.js";
import {updateBotSpaceSettingsPropertyValue} from "~/server/bots/with_spaces/update_bot_space_settings_property_value.js";
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
    updateBotSpaceSettingsPropertyValue: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            return await updateBotSpaceSettingsPropertyValue(context.actor.authorizeSession(), {
                spaceId: input.spaceId,
                botId: input.botId,
                propertyKey: input.propertyKey,
                propertyValue: input.propertyValue,
            });
        },
    },
    updateBotSpaceAccountSettingsPropertyValue: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            return await updateBotSpaceAccountSettingsPropertyValue(
                context.actor.authorizeSession(),
                {
                    spaceId: input.spaceId,
                    accountId: input.accountId,
                    botId: input.botId,
                    propertyKey: input.propertyKey,
                    propertyValue: input.propertyValue,
                },
            );
        },
    },
});
