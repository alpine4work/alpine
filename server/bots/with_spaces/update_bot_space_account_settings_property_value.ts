import {getBotSettingsSchema} from "~/server/bots/get_bot_settings_schema.js";
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getBotAccountIdForSpaceIfExists} from "~/server/spaces/get_bot_account_id_for_space_if_exists.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * Update a single property in the bot's account settings. Accounts can update
 * their own bot account settings for the space and they must update the bot
 * settings in accordance with the bot settings schema. Bot actors cannot
 * update account settings.
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

    // The only supported property type right now is `String`. TypeScript will
    // complain when we add a new property type at which point we'll need to make
    // this an exhaustive switch that validates each property type separately.
    cast<"String">(propertySchema.type);

    if (typeof propertyValue !== "string") {
        throw new FailedPreconditionError(
            "Property value must be a string according to bot settings schema",
        );
    }

    let hasAlreadyAttempted = false;

    return context.dynamo.retryTransaction(async context => {
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

        return {
            valuesVersion: newItem.updateLockVersion ?? 0,
            values: newItem.values,
        };
    });
}
