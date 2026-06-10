import {createBot} from "~/server/bots/create_bot.js";
import {createScopedApiKeyForBot} from "~/server/bots/create_scoped_api_key_for_bot.js";
import {createUnscopedApiKeyForBot} from "~/server/bots/create_unscoped_api_key_for_bot.js";
import {deleteBot} from "~/server/bots/delete_bot.js";
import {finishUploadingBotAvatar} from "~/server/bots/finish_uploading_bot_avatar.js";
import {updateBotSpaceAccountSettingsPropertyValue} from "~/server/bots/with_spaces/update_bot_space_account_settings_property_value.js";
import {updateBotSpaceSettingsPropertyValue} from "~/server/bots/with_spaces/update_bot_space_settings_property_value.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {getBotAccountIdForSpaceIfExists} from "~/server/spaces/get_bot_account_id_for_space_if_exists.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import * as definitions from "~/shared/rpc/bots_rpc_definitions.js";

export default implementRpcs(definitions, {
    deleteBot: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await deleteBot(context, {botId: input.botId});
            return {};
        },
    },
    createBot: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            return await createBot(context, {
                name: input.name,
                webhookUrl: input.webhookUrl,
            });
        },
    },
    createUnscopedApiKeyForBot: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const apiKey = await createUnscopedApiKeyForBot(context, {
                botId: input.botId,
                name: input.name,
            });
            return {apiKey};
        },
    },
    createScopedApiKeyForBot: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const apiKey = await createScopedApiKeyForBot(context, {
                botId: input.botId,
                spaceId: input.spaceId,
                accountId: input.accountId,
                name: input.name,
                scope: input.scope as BotTokenPayloadScope,
            });
            return {apiKey};
        },
    },
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
    getBotAccountIdForSpaceIfExists: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const accountId = await getBotAccountIdForSpaceIfExists(
                context.actor.authorizeSession(),
                input.botId,
                input.spaceId,
            );
            return {accountId};
        },
    },
});
