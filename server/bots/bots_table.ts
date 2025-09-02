import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {BotId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

const BotsTable = DynamoTableSchema.new({
    name: "Bots",
    partitions: [
        {
            name: "Bot",
            partitionKeyAttributes: {
                botId: DynamoKeyAttributeSchema.id<BotId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * When was the bot created?
                         */
                        createdTime: Schema.date,

                        /**
                         * Name of the bot. This name will be used for all of the bot's accounts.
                         */
                        name: Schema.string,

                        /**
                         * When the bot is mentioned, send an event to this webhook.
                         */
                        webhookUrl: Schema.string,
                    }),
                },
            ],
        },
    ],
});

export async function createBotForTest(
    context: DynamoContext,
    {name, webhookUrl}: {name: string; webhookUrl: string},
) {
    assert(import.meta.jest);

    const botId = generateId<BotId>();

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "Attributes",
        botId,
        createdTime: new Date(),
        name,
        webhookUrl,
    });

    return {id: botId};
}

/**
 * Get the information associated with a bot. Currently, basic information
 * about a bot (e.g. its name and avatar) is public globally!
 */
export async function getBot(context: DynamoContext, botId: BotId) {
    const botItem = await BotsTable.getItem(context, {
        partitionType: "Bot",
        sortRangeType: "Attributes",
        botId,
    });

    return {
        name: botItem.name,
    };
}
