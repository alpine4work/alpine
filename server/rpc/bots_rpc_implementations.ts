import {createBot} from "~/server/bots/with_spaces/create_bot.js";
import {createScopedApiKeyForBot} from "~/server/bots/with_spaces/create_scoped_api_key_for_bot.js";
import {createUnscopedApiKeyForBot} from "~/server/bots/with_spaces/create_unscoped_api_key_for_bot.js";
import {deleteApiKeyForBotIfExists} from "~/server/bots/with_spaces/delete_api_key_for_bot.js";
import {deleteBotIfExists} from "~/server/bots/with_spaces/delete_bot_if_exists.js";
import {finishUploadingBotAvatar} from "~/server/bots/with_spaces/finish_uploading_bot_avatar.js";
import {rotateApiKeyForBot} from "~/server/bots/with_spaces/rotate_api_key_for_bot.js";
import {updateBot} from "~/server/bots/with_spaces/update_bot.js";
import {updateBotSpaceAccountSettingsPropertyValue} from "~/server/bots/with_spaces/update_bot_space_account_settings_property_value.js";
import {updateBotSpaceSettingsPropertyValue} from "~/server/bots/with_spaces/update_bot_space_settings_property_value.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {getBotAccountIdForSpaceIfExists} from "~/server/spaces/get_bot_account_id_for_space_if_exists.js";
import {parseBotOwnerEntityId} from "~/shared/bots/owners/bot_owner_entity.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {assertApiKey} from "~/shared/id/api_key.js";
import * as definitions from "~/shared/rpc/bots_rpc_definitions.js";

export default implementRpcs(definitions, {
    createBot: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            return await createBot(context.actor.authorizeSession(), {
                name: input.name,
                webhook: input.webhook,
                description: input.description,
                ownerEntity: assertExists(parseBotOwnerEntityId(input.ownerEntity)),
                spaceId: input.spaceId,
            });
        },
    },
    deleteBot: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await deleteBotIfExists(context.actor.authorizeSession(), {botId: input.botId});
            return {};
        },
    },
    updateBot: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await updateBot(context.actor.authorizeSession(), {
                botId: input.botId,
                name: input.name,
                description: input.description,
                webhook: input.webhook,
            });
            return {};
        },
    },
    createUnscopedApiKeyForBot: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const apiKey = await createUnscopedApiKeyForBot(context.actor.authorizeSession(), {
                botId: input.botId,
                name: input.name,
            });
            return {apiKey};
        },
    },
    createScopedApiKeyForBot: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {apiKey, scope} = await createScopedApiKeyForBot(
                context.actor.authorizeSession(),
                {
                    botId: input.botId,
                    spaceId: input.spaceId,
                    name: input.name,
                    scope: input.scope,
                },
            );
            return {apiKey, scope};
        },
    },
    deleteApiKeyForBot: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await deleteApiKeyForBotIfExists(context.actor.authorizeSession(), {
                botId: input.botId,
                apiKey: assertApiKey(input.apiKey),
            });
            return {};
        },
    },
    rotateApiKeyForBot: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const apiKey = await rotateApiKeyForBot(context.actor.authorizeSession(), {
                botId: input.botId,
                apiKey: assertApiKey(input.apiKey),
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
