import {getBotSettingsSchema} from "~/server/bots/get_bot_settings_schema.js";
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {isBotSpaceSettingsPropertyValueEmptySecret} from "~/server/bots/internal/is_bot_space_settings_property_value_empty_secret.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getSpaceAccountBotIdIfExists} from "~/server/spaces/get_space_account_bot_id_if_exists.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {BotSettingsSchema} from "~/shared/bots/bot_settings_schema.js";
import {SimpleContentWithReferences} from "~/shared/content/simple_content_schema.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * Get both space and space account settings for a bot in one request.
 *
 * Only the account itself may load its account settings. Bots can load account
 * settings for any account in the space for their bot id. Space settings are
 * filtered based on role for non-admin accounts.
 */
export async function getBotSpaceAndSpaceAccountSettingsValues(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    botId: BotId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    description: SimpleContentWithReferences;
    schema: BotSettingsSchema;
    accountValuesVersion: number;
    accountValues: ReadonlyMap<string, SchemaSerializedValue>;
    spaceValuesVersion: number;
    spaceValues: ReadonlyMap<string, SchemaSerializedValue>;
    spaceSecretPropertyKeysWithValues: Set<string>;
}> {
    const [
        ,
        ,
        isSpaceAccount,
        hasAdminAccess,
        actorBotId,
        settings,
        spaceSettingsItem,
        accountSettingsItem,
    ] = await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        // Bots are allowed to read the bot settings for all accounts. In Alpine you can
        // only read your own bot settings but the third-party bot creator can decide a
        // different permissions scheme.
        context.actor.type !== "Bot" ? authorizeOwnSpaceAccountAccess(context, accountId) : null,
        isAccountMemberOfSpace(context, spaceId, accountId),
        isAccountMemberOfSpace(context, spaceId, context.actor.getPossiblyBotAccountId(), "Admin"),
        context.actor.type === "Bot"
            ? getSpaceAccountBotIdIfExists(context, spaceId, context.actor.getBotAccountId())
            : null,
        getBotSettingsSchema(context, botId, {consistency}),
        BotsTable.getItemIfExists(
            context,
            {
                partitionType: "Space",
                sortRangeType: "BotSettingsValues",
                spaceId,
                botId,
            },
            {consistency},
        ),
        BotsTable.getItemIfExists(
            context,
            {
                partitionType: "Space",
                sortRangeType: "AccountBotSettingsValues",
                spaceId,
                botId,
                accountId,
            },
            {consistency},
        ),
    ]);

    if (!isSpaceAccount) {
        throw new PermissionDeniedError("Account is not a member of the space", {
            displayMessage: errorDisplayMessage`Account is not a member of the space.`,
        });
    }

    if (context.actor.type === "Bot" && actorBotId !== botId) {
        throw new PermissionDeniedError("Bot can only access account settings for its own bot", {
            displayMessage: errorDisplayMessage`Bot can only access account settings for its own bot.`,
        });
    }

    const spaceSecretPropertyKeysWithValues = new Set<string>();

    // We expose which secret space properties have values to non-admin accounts.
    if (spaceSettingsItem) {
        for (const [propertyKey, propertySchema] of settings.schema.properties) {
            if ((propertySchema.level ?? "Space") !== "Space") continue;
            if (!propertySchema.isSecret) continue;

            const value = spaceSettingsItem.values.get(propertyKey);
            if (!isBotSpaceSettingsPropertyValueEmptySecret(value)) {
                spaceSecretPropertyKeysWithValues.add(propertyKey);
            }
        }
    }

    const accountValues = new Map<string, SchemaSerializedValue>();

    if (accountSettingsItem) {
        for (const [propertyKey, propertySchema] of settings.schema.properties) {
            if ((propertySchema.level ?? "Space") !== "SpaceAccount") continue;

            const value = accountSettingsItem.values.get(propertyKey);
            if (value !== undefined) {
                accountValues.set(propertyKey, value);
            }
        }
    }

    if (hasAdminAccess || (context.actor.type === "Bot" && actorBotId === botId)) {
        return {
            ...settings,
            spaceValuesVersion: spaceSettingsItem?.updateLockVersion ?? 0,
            spaceValues: spaceSettingsItem?.values ?? emptyMap,
            spaceSecretPropertyKeysWithValues,
            accountValuesVersion: accountSettingsItem?.updateLockVersion ?? 0,
            accountValues,
        };
    }

    const spaceValuesForMember = new Map<string, SchemaSerializedValue>();

    // Members can only see values that:
    //
    // - Are in the schema
    // - Are not secret
    //
    // They can see which secret properties have values, however.
    if (spaceSettingsItem) {
        for (const [propertyKey, propertySchema] of settings.schema.properties) {
            if ((propertySchema.level ?? "Space") !== "Space") continue;
            if (propertySchema.isSecret) continue;

            const value = spaceSettingsItem.values.get(propertyKey);
            if (value !== undefined) {
                spaceValuesForMember.set(propertyKey, value);
            }
        }
    }

    return {
        ...settings,
        spaceValuesVersion: spaceSettingsItem?.updateLockVersion ?? 0,
        spaceValues: spaceValuesForMember,
        spaceSecretPropertyKeysWithValues,
        accountValuesVersion: accountSettingsItem?.updateLockVersion ?? 0,
        accountValues,
    };
}
