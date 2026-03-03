import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {initialBotSettingsItem} from "~/server/bots/internal/initial_bot_settings_item.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {BotSettingsSchema} from "~/shared/bots/bot_settings_schema.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {SimpleContentWithReferences} from "~/shared/content/simple_content_schema.js";
import {BotId} from "~/shared/id/types/id_types.js";

/**
 * Get the settings for a `BotId`. Won't throw if the bot doesn't exist. Instead
 * we'll return the initial bot settings.
 *
 * Doesn't perform authorization since basic information about bots are accessible
 * to all users.
 */
export async function getBotSettingsSchema(
    context: DynamoContext,
    botId: BotId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    description: SimpleContentWithReferences;
    schema: BotSettingsSchema;
}> {
    const botItem =
        (await BotsTable.getItemIfExists(
            context,
            {partitionType: "Bot", sortRangeType: "SettingsSchema", botId},
            {consistency},
        )) ?? initialBotSettingsItem;

    return {
        description: {
            doc: botItem.description,
            // Simple content doesn't have any references. It has no mentions, no files,
            // nothing.
            references: emptyContentReferences,
        },
        schema: botItem.schema,
    };
}
