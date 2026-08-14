import {getBotSettingsSchema} from "~/server/bots/get_bot_settings_schema.js";
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getBotAccountIdForSpaceIfExists} from "~/server/spaces/get_bot_account_id_for_space_if_exists.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * Update a single property in the bot's account settings. Accounts can update
 * their own bot account settings for the space and they must update the bot
 * settings in accordance with the bot settings schema. Bot actors cannot update
 * account settings.
 */
export async function updateBotSpaceAccountSettingsPropertyValue(
    context: ServerAccountActionContext,
    {
        spaceId,
        accountId,
        botId,
        propertyKey,
        propertyValue,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        botId: BotId;
        propertyKey: string;
        propertyValue: SchemaSerializedValue;
    },
): Promise<{
    valuesVersion: number;
    values: Map<string, SchemaSerializedValue>;
}> {
    if (context.actor.type === "Bot") {
        throw new PermissionDeniedError("Bot accounts don\u2019t have space account settings");
    }

    const [, , botAccountId, settings, accountSettingsItem] = await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        authorizeOwnSpaceAccountAccess(context, accountId),
        getBotAccountIdForSpaceIfExists(context, botId, spaceId),
        getBotSettingsSchema(context, botId),
        BotsTable.getItemIfExists(context, {
            partitionType: "Space",
            sortRangeType: "AccountBotSettingsValues",
            spaceId,
            botId,
            accountId,
        }),
    ]);

    if (botAccountId === null) {
        throw new FailedPreconditionError("Bot is not installed in the space");
    }

    const propertySchema = settings.schema.properties.get(propertyKey);
    if (!propertySchema) {
        throw new FailedPreconditionError("Property not found in bot settings schema");
    }

    if (propertySchema.level !== "SpaceAccount") {
        throw new FailedPreconditionError("Property is not an account-level bot setting");
    }

    switch (propertySchema.type) {
        case "String": {
            if (typeof propertyValue !== "string") {
                throw new FailedPreconditionError(
                    "Property value must be a string according to bot settings schema",
                );
            }
            break;
        }
        case "Select": {
            if (typeof propertyValue !== "string") {
                throw new FailedPreconditionError(
                    "Property value must be a string according to bot settings schema",
                );
            }

            if (!propertySchema.options.some(option => option.value === propertyValue)) {
                throw new FailedPreconditionError(
                    "Property value must match an option in the bot settings schema",
                );
            }
            break;
        }
        default:
            throw exhaustive(propertySchema);
    }

    let hasAlreadyAttempted = false;

    return await context.dynamo.retryTransaction(async context => {
        const isInitialAttempt = !hasAlreadyAttempted;
        hasAlreadyAttempted = true;

        let item = isInitialAttempt
            ? accountSettingsItem
            : await BotsTable.getItemIfExists(context, {
                  partitionType: "Space",
                  sortRangeType: "AccountBotSettingsValues",
                  spaceId,
                  botId,
                  accountId,
              });

        item ??= {
            partitionType: "Space",
            sortRangeType: "AccountBotSettingsValues",
            spaceId,
            botId,
            accountId,
            values: new Map(),
        };

        const newValues = new Map(item.values);
        newValues.set(propertyKey, propertyValue);

        const newItem = await BotsTable.directlyUpdateItem(context, {
            ...item,
            values: newValues,
        });

        const values = new Map<string, SchemaSerializedValue>();

        for (const [propertyKey, propertySchema] of settings.schema.properties) {
            if (propertySchema.level !== "SpaceAccount") continue;

            switch (propertySchema.type) {
                case "String": {
                    const value = newItem.values.get(propertyKey);

                    values.set(propertyKey, value ?? "");
                    break;
                }
                case "Select": {
                    const value = newItem.values.get(propertyKey);

                    values.set(propertyKey, value ?? propertySchema.defaultValue);
                    break;
                }
                default:
                    throw exhaustive(propertySchema);
            }
        }

        return {
            valuesVersion: newItem.updateLockVersion ?? 0,
            values,
        };
    });
}
