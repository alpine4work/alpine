import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {ApiBotWebhookEvent} from "~/shared/api/types/api_specification_convenience_types.js";
import {BotId, BotWebhookEventId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export const botWebhookMaxRetryCount = 3;

export const BotWebhookEventsTable = DynamoTableSchema.new({
    name: "BotWebhookEvents",
    partitions: [
        {
            name: "BotSpace",
            partitionKeyAttributes: {
                botId: DynamoKeyAttributeSchema.id<BotId>(),
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                {
                    name: "Event",
                    sortKeyAttributes: {
                        eventId: DynamoKeyAttributeSchema.id<BotWebhookEventId>(),
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        /**
                         * The event we're sending to the webhook.
                         */
                        event: Schema.unknown<ApiBotWebhookEvent>(),

                        /**
                         * Information about what attempt we're on for this event. We'll retry events
                         * a couple times if they fail.
                         */
                        attempt: Schema.object({
                            number: Schema.integer.min(1).max(botWebhookMaxRetryCount),
                            startTime: Schema.date,
                            status: Schema.union({
                                Pending: Schema.object({type: Schema.value("Pending")}),
                                Rejected: Schema.object({
                                    type: Schema.value("Rejected"),
                                    endTime: Schema.date,
                                    reason: Schema.enum([
                                        "DeadlineExceeded",
                                        "Unavailable",
                                        "Internal",
                                        "ServerErrorStatusCode",
                                    ]),
                                }),
                                Resolved: Schema.object({
                                    type: Schema.value("Resolved"),
                                    endTime: Schema.date,
                                }),
                            }),
                        }),
                    }),
                },
            ],
        },
    ],
});

export type BotWebhookEventItem = DynamoTableItemType<
    typeof BotWebhookEventsTable,
    "BotSpace",
    "Event"
>;
