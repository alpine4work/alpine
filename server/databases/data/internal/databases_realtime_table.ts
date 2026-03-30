import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    DynamoGeneralRealtimeTableItemType,
    DynamoGeneralRealtimeTableSchema,
} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {DatabaseModel} from "~/shared/databases/database_model.js";
import {DatabaseBroadcastRealtimeEventTransactionSchema} from "~/shared/databases/database_realtime_protocol.js";
import {DynamoGeneralRealtimeEventStub} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {AccountId, DatabaseId, SpaceId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const DatabasesRealtimeTable = DynamoGeneralRealtimeTableSchema.new({
    features: {realtimeQuery: {Database: true}},
    name: "DatabasesRealtime",
    partitions: [
        {
            name: "Database",
            partitionKeyAttributes: {
                databaseId: DynamoKeyAttributeSchema.id<DatabaseId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),

                        /** When was this database created? */
                        createdTime: Schema.date,

                        /** Account who created the database. */
                        creatorId: Schema.id<AccountId>().nullable().default(null),

                        /** The name of this database. */
                        name: LabelStringSchema,
                    }),
                },
            ],
        },
    ],
    modelSchema: createModelUnionSchema({
        Database: DatabaseModel,
    }),
    models: {
        Database: {
            Attributes: {
                build: async (_context, item) => {
                    return new DatabaseModel({
                        id: item.databaseId,
                        spaceId: item.spaceId,
                        version: item.updateLockVersion ?? 0,
                        createdTime: item.createdTime,
                        name: item.name,
                    });
                },
            },
        },
    },
    broadcastEventTransaction: async (context, eventTransaction) => {
        const eventTransactionByDatabaseId = new Map<
            DatabaseId,
            Array<DynamoGeneralRealtimeEventStub>
        >();

        for (const {itemKey, eventStub} of eventTransaction) {
            // Only Database partition type exists in this table.
            const isDatabaseCreationEvent =
                itemKey.sortRangeType === "Attributes" && eventStub.item.version === 0;

            // No one will be subscribed to the durable object before
            // the database is created.
            if (isDatabaseCreationEvent) continue;

            getOrSetDefaultMapValue(
                eventTransactionByDatabaseId,
                itemKey.databaseId,
                () => [],
            ).push(eventStub);
        }

        await runAllPromises(
            mapIterable(eventTransactionByDatabaseId, async ([databaseId, eventTransaction]) => {
                await context.edge.broadcastToDurableObject(
                    `/api/durable-objects/databases/${databaseId}/broadcast-realtime-event-transaction`,
                    {
                        serviceName: "DatabaseService",
                        route: "/api/durable-objects/databases/:databaseId/broadcast-realtime-event-transaction",
                        body: DatabaseBroadcastRealtimeEventTransactionSchema.serialize({
                            eventTransaction,
                        }),
                    },
                );
            }),
        );
    },
});

export type DatabaseAttributesItem = DynamoGeneralRealtimeTableItemType<
    typeof DatabasesRealtimeTable,
    "Database",
    "Attributes"
>;
