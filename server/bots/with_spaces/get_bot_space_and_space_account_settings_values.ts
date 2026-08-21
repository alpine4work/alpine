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
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
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
    await runAllPromises([
        authorizeBotOperation(context, botId, {type: "ViewSpaceSettings", spaceId}, {consistency}),
        authorizeBotOperation(
            context,
            botId,
            {type: "ViewSpaceSettingsForActor", spaceId, accountId},
            {consistency},
        ),
    ]);

    const [settings, spaceSettingsItem, accountSettingsItem, actorBotId] = await runAllPromises([
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

    const spaceValues = new Map<string, SchemaSerializedValue>();
    const spaceSecretPropertyKeysWithValues = new Set<string>();

    // We expose which secret space properties have values to non-admin accounts.
    for (const [propertyKey, propertySchema] of settings.schema.properties) {
        if (propertySchema.level !== "Space") continue;

        switch (propertySchema.type) {
            case "String": {
                const value = spaceSettingsItem?.values.get(propertyKey);

                spaceValues.set(propertyKey, value ?? "");

                if (propertySchema.isSecret && !isBotSpaceSettingsPropertyValueEmptySecret(value)) {
                    spaceSecretPropertyKeysWithValues.add(propertyKey);
                }
                break;
            }
            case "Select": {
                const value = spaceSettingsItem?.values.get(propertyKey);

                spaceValues.set(propertyKey, value ?? propertySchema.defaultValue);
                break;
            }
            default:
                throw exhaustive(propertySchema);
        }
    }

    const accountValues = new Map<string, SchemaSerializedValue>();

    for (const [propertyKey, propertySchema] of settings.schema.properties) {
        if (propertySchema.level !== "SpaceAccount") continue;

        switch (propertySchema.type) {
            case "String": {
                const value = accountSettingsItem?.values.get(propertyKey);

                accountValues.set(propertyKey, value ?? "");
                break;
            }
            case "Select": {
                const value = accountSettingsItem?.values.get(propertyKey);

                accountValues.set(propertyKey, value ?? propertySchema.defaultValue);
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
            spaceValuesVersion: spaceSettingsItem?.updateLockVersion ?? 0,
            spaceValues,
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
    for (const [propertyKey, propertySchema] of settings.schema.properties) {
        if (propertySchema.level !== "Space") continue;
        if (propertySchema.type === "String" && propertySchema.isSecret) continue;

        const value = spaceValues.get(propertyKey);
        if (value !== undefined) {
            spaceValuesForMember.set(propertyKey, value);
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
