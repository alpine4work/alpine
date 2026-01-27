import {BotSettingsSchemaItem} from "~/server/bots/internal/bots_table.js";
import {emptySimpleContent} from "~/shared/content/simple_content_schema.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";

export const initialBotSettingsItem: Omit<
    BotSettingsSchemaItem,
    "partitionType" | "sortRangeType" | "botId"
> = {
    description: emptySimpleContent,
    schema: {properties: emptyMap},
};
