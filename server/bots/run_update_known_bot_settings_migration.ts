import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {initialBotSettingsItem} from "~/server/bots/internal/initial_bot_settings_item.js";
import {knownBotSettings} from "~/server/bots/known_bot_settings.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {BotSpaceSettingsSchemaSchema} from "~/shared/bots/bot_space_settings_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";

/**
 * Update the settings for all known bots in the database. We commit settings
 * to the codebase to make them easier to manage. This migration saves those
 * settings to the database where they're used to drive the UI.
 */
export async function runUpdateKnownBotSettingsMigration(context: DynamoContext) {
    await runAllPromises(
        getObjectEntriesWithKeyofType(knownBotSettings.get()).map(async ([botId, settings]) => {
            await BotsTable.updateItem(
                context,
                {
                    partitionType: "Bot",
                    sortRangeType: "SettingsSchema",
                    botId,
                },
                item => {
                    item ??= {
                        partitionType: "Bot",
                        sortRangeType: "SettingsSchema",
                        botId,
                        ...initialBotSettingsItem,
                    };

                    if (!item.description.eq(settings.description)) {
                        item = {...item, description: settings.description};
                    }

                    // Make sure the bot settings object is valid. So we don't write corrupt data to
                    // the database in local development when the developer is ignoring TypeScript.
                    BotSpaceSettingsSchemaSchema.deserialize(
                        BotSpaceSettingsSchemaSchema.serialize(settings.schema),
                    );

                    if (!isDeepEqual(item.schema, settings.schema)) {
                        item = {...item, schema: settings.schema};
                    }

                    // Will noop if `item` was unchanged.
                    return item;
                },
            );
        }),
    );
}
