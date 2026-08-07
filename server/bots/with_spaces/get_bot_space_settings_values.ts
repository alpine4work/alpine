import {getBotSettingsSchema} from "~/server/bots/get_bot_settings_schema.js";
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {isBotSpaceSettingsPropertyValueEmptySecret} from "~/server/bots/internal/is_bot_space_settings_property_value_empty_secret.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getSpaceAccountBotIdIfExists} from "~/server/spaces/get_space_account_bot_id_if_exists.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {BotSettingsSchema} from "~/shared/bots/bot_settings_schema.js";
import {SimpleContentWithReferences} from "~/shared/content/simple_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.open_source.js";
import {BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.open_source.js";

/**
 * Get the bot settings for a particular space.
 *
 * Admins are allowed to see all bot space settings but members are only allowed to
 * see bot space settings that are not secrets and have corresponding property
 * schemas.
 *
 * If it's a bot actor and we're requesting the settings for the bot itself then
 * the bot is allowed to see its own settings.
 *
 * Throws if the actor isn't a member of the space.
 */
export async function getBotSpaceSettingsValues(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    botId: BotId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    description: SimpleContentWithReferences;
    schema: BotSettingsSchema;
    valuesVersion: number;
    values: ReadonlyMap<string, SchemaSerializedValue>;
    secretPropertyKeysWithValues: Set<string>;
}> {
    const [, hasAdminAccess, actorBotId, settings, spaceSettingsItem] = await runAllPromises([
        // These three requests should all check the same cache and so should only make ~1
        // database request for the account data.
        authorizeSpaceAccess(context, spaceId),
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
    ]);

    const secretPropertyKeysWithValues = new Set<string>();

    // We expose which secret properties has values to non-admin accounts. We only add
    // string values to this set if the string is non-empty.
    if (spaceSettingsItem) {
        for (const [propertyKey, propertySchema] of settings.schema.properties) {
            if (propertySchema.level !== "Space") continue;
            if (!propertySchema.isSecret) continue;

            const value = spaceSettingsItem.values.get(propertyKey);
            if (!isBotSpaceSettingsPropertyValueEmptySecret(value)) {
                secretPropertyKeysWithValues.add(propertyKey);
            }
        }
    }

    if (hasAdminAccess || (context.actor.type === "Bot" && actorBotId === botId)) {
        return {
            ...settings,
            valuesVersion: spaceSettingsItem?.updateLockVersion ?? 0,
            values: spaceSettingsItem?.values ?? emptyMap,
            secretPropertyKeysWithValues,
        };
    }

    const valuesForMember = new Map<string, SchemaSerializedValue>();

    // Members can only see values that:
    //
    // - Are in the schema
    // - Are not secret
    //
    // They can see which secret properties have values, however.
    if (spaceSettingsItem) {
        for (const [propertyKey, propertySchema] of settings.schema.properties) {
            if (propertySchema.level !== "Space") continue;
            if (propertySchema.isSecret) continue;

            const propertyValue = spaceSettingsItem.values.get(propertyKey);
            if (propertyValue !== undefined) {
                valuesForMember.set(propertyKey, propertyValue);
            }
        }
    }

    return {
        ...settings,
        valuesVersion: spaceSettingsItem?.updateLockVersion ?? 0,
        values: valuesForMember,
        secretPropertyKeysWithValues,
    };
}
