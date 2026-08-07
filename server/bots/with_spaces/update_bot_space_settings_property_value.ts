import {getBotSettingsSchema} from "~/server/bots/get_bot_settings_schema.js";
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {isBotSpaceSettingsPropertyValueEmptySecret} from "~/server/bots/internal/is_bot_space_settings_property_value_empty_secret.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getBotAccountIdForSpaceIfExists} from "~/server/spaces/get_bot_account_id_for_space_if_exists.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.open_source.js";

/**
 * Update a single property in the bot's space settings. Only admins can update the
 * bot settings for their space and they must update the bot space settings in
 * accordance with the bot settings schema.
 */
export async function updateBotSpaceSettingsPropertyValue(
    context: ServerSessionActionContext,
    {
        spaceId,
        botId,
        propertyKey,
        propertyValue,
    }: {
        spaceId: SpaceId;
        botId: BotId;
        propertyKey: string;
        propertyValue: SchemaSerializedValue;
    },
): Promise<{
    valuesVersion: number;
    values: Map<string, SchemaSerializedValue>;
    secretPropertyKeysWithValues: Set<string>;
}> {
    const [, botAccountId, settings, spaceSettingsItem] = await runAllPromises([
        authorizeSpaceAccess(context, spaceId, "Admin"),
        getBotAccountIdForSpaceIfExists(context, botId, spaceId),
        getBotSettingsSchema(context, botId),
        BotsTable.getItemIfExists(context, {
            partitionType: "Space",
            sortRangeType: "BotSettingsValues",
            spaceId,
            botId,
        }),
    ]);

    if (botAccountId === null) {
        throw new FailedPreconditionError("Bot is not installed in the space");
    }

    const propertySchema = settings.schema.properties.get(propertyKey);
    if (!propertySchema) {
        throw new FailedPreconditionError("Property not found in bot settings schema");
    }

    if (propertySchema.level !== "Space") {
        throw new FailedPreconditionError("Property is not a space-level bot setting");
    }

    // The only supported property type right now is `String`. TypeScript will complain
    // when we add a new property type at which point we'll need to make this an
    // exhaustive switch that validates each property type separately.
    cast<"String">(propertySchema.type);

    if (typeof propertyValue !== "string") {
        throw new FailedPreconditionError(
            "Property value must be a string according to bot settings schema",
        );
    }

    let hasAlreadyAttempted = false;

    return await context.dynamo.retryTransaction(async context => {
        const isInitialAttempt = !hasAlreadyAttempted;
        hasAlreadyAttempted = true;

        let item = isInitialAttempt
            ? spaceSettingsItem
            : await BotsTable.getItemIfExists(context, {
                  partitionType: "Space",
                  sortRangeType: "BotSettingsValues",
                  spaceId,
                  botId,
              });

        item ??= {
            partitionType: "Space",
            sortRangeType: "BotSettingsValues",
            spaceId,
            botId,
            values: new Map(),
        };

        const newValues = new Map(item.values);
        newValues.set(propertyKey, propertyValue);

        const newItem = await BotsTable.directlyUpdateItem(context, {
            ...item,
            values: newValues,
        });

        const secretPropertyKeysWithValues = new Set<string>();

        for (const [propertyKey, propertySchema] of settings.schema.properties) {
            if (!propertySchema.isSecret) continue;

            const value = newValues.get(propertyKey);
            if (!isBotSpaceSettingsPropertyValueEmptySecret(value)) {
                secretPropertyKeysWithValues.add(propertyKey);
            }
        }

        return {
            valuesVersion: newItem.updateLockVersion ?? 0,
            values: newItem.values,
            secretPropertyKeysWithValues,
        };
    });
}
