import {getBotSettingsSchema} from "~/server/bots/get_bot_settings_schema.js";
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {isBotSpaceSettingsPropertyValueEmptySecret} from "~/server/bots/internal/is_bot_space_settings_property_value_empty_secret.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    authorizeBotOperation,
    hasBotOperationAccess,
} from "~/server/spaces/authorize_bot_operation.js";
import {getSpaceAccountBotIdIfExistsWithoutAuthorization} from "~/server/spaces/get_space_account_bot_id_if_exists.js";
import {BotSettingsSchema} from "~/shared/bots/bot_settings_schema.js";
import {SimpleContentWithReferences} from "~/shared/content/simple_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

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
    const [, settings, spaceSettingsItem, actorBotId] = await runAllPromises([
        authorizeBotOperation(context, botId, {type: "ViewSpaceSettings", spaceId}, {consistency}),

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

        // Bots may read their own secret space settings even though they can't manage
        // them. Resolve the acting bot id up front so we can check that case below.
        context.actor.type === "Bot"
            ? getSpaceAccountBotIdIfExistsWithoutAuthorization(
                  context,
                  spaceId,
                  context.actor.getBotAccountId(),
              )
            : null,
    ]);

    const values = new Map<string, SchemaSerializedValue>();
    const secretPropertyKeysWithValues = new Set<string>();

    // We expose which secret properties has values to non-admin accounts. We only add
    // string values to this set if the string is non-empty.
    for (const [propertyKey, propertySchema] of settings.schema.properties) {
        if (propertySchema.level !== "Space") continue;

        switch (propertySchema.type) {
            case "String": {
                const value = spaceSettingsItem?.values.get(propertyKey);

                values.set(propertyKey, value ?? "");

                if (propertySchema.isSecret && !isBotSpaceSettingsPropertyValueEmptySecret(value)) {
                    secretPropertyKeysWithValues.add(propertyKey);
                }
                break;
            }
            case "Select": {
                const value = spaceSettingsItem?.values.get(propertyKey);

                values.set(propertyKey, value ?? propertySchema.defaultValue);
                break;
            }
            default:
                throw exhaustive(propertySchema);
        }
    }

    // Admins who can manage space settings see all values. A bot reading its own
    // settings can also see secrets even though `ManageSpaceSettings` is intentionally
    // not granted to bot actors.
    if (
        actorBotId === botId ||
        (await hasBotOperationAccess(
            context,
            botId,
            {type: "ManageSpaceSettings", spaceId},
            {consistency},
        ))
    ) {
        return {
            ...settings,
            valuesVersion: spaceSettingsItem?.updateLockVersion ?? 0,
            values,
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
    for (const [propertyKey, propertySchema] of settings.schema.properties) {
        if (propertySchema.level !== "Space") continue;
        if (propertySchema.type === "String" && propertySchema.isSecret) continue;

        const propertyValue = values.get(propertyKey);
        if (propertyValue !== undefined) {
            valuesForMember.set(propertyKey, propertyValue);
        }
    }

    return {
        ...settings,
        valuesVersion: spaceSettingsItem?.updateLockVersion ?? 0,
        values: valuesForMember,
        secretPropertyKeysWithValues,
    };
}
