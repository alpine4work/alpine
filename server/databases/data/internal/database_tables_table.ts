import {intoEffectiveAccessPolicy} from "~/server/access/into_effective_access_policy.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {RynamoTableItemType, RynamoTableSchema} from "~/server/rynamo/rynamo_table_schema.js";
import {AccessPolicySchema, type LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {DatabaseTableMetadataBroadcastRealtimeEventsSchema} from "~/shared/databases/database_realtime_protocol.js";
import {DatabaseTableMetadataModel} from "~/shared/databases/database_table_metadata_model.js";
import {RynamoEventStub} from "~/shared/dynamo/rynamo_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import type {DatabaseGroupId, DatabaseTableId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export const DatabaseTablesTable = RynamoTableSchema.new({
    name: "DatabaseTableMetadata",
    partitions: [
        {
            name: "Table",
            partitionKeyAttributes: {
                tableId: DynamoKeyAttributeSchema.id<DatabaseTableId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        databaseGroupId: Schema.id<DatabaseGroupId>(),
                        name: Schema.string.nullable(),
                        spaceId: Schema.id<SpaceId>(),
                        isDeleted: Schema.boolean,
                        accessPolicy: AccessPolicySchema,
                    }),
                },
            ],
        },
    ],
    modelSchema: DatabaseTableMetadataModel.schema(),
    models: {
        Table: {
            Attributes: {
                build: async (_context, item) =>
                    new DatabaseTableMetadataModel({
                        databaseGroupId: item.databaseGroupId,
                        tableId: item.tableId,
                        spaceId: item.spaceId,
                        name: item.name,
                        isDeleted: item.isDeleted,
                        accessPolicy: item.accessPolicy,
                        version: item.updateLockVersion ?? 0,
                    }),
            },
        },
    },
    broadcastEvents: async (context, events) => {
        const broadcastsByDatabaseGroupId = new Map<
            DatabaseGroupId,
            {
                events: Array<RynamoEventStub>;
                resolvedAccessPolicyByTableId: Map<DatabaseTableId, LocalAccessPolicy | null>;
            }
        >();

        await runAllPromises(
            events.map(async ({itemKey, eventStub, getEvent}) => {
                if (itemKey.partitionType !== "Table") return;

                const event = await getEvent(context);
                assert(
                    event.type === "PutItem",
                    "Database table metadata deletion is not supported",
                );
                const {databaseGroupId, accessPolicy} = event.item.model;
                const resolvedAccessPolicy: LocalAccessPolicy = await intoEffectiveAccessPolicy(
                    context,
                    accessPolicy,
                    {consistency: "StrongWithinCache"},
                );

                const broadcast = getOrSetDefaultMapValue(
                    broadcastsByDatabaseGroupId,
                    databaseGroupId,
                    () => ({events: [], resolvedAccessPolicyByTableId: new Map()}),
                );
                broadcast.events.push(eventStub);
                broadcast.resolvedAccessPolicyByTableId.set(itemKey.tableId, resolvedAccessPolicy);
            }),
        );

        await runAllPromises(
            mapIterable(broadcastsByDatabaseGroupId, async ([databaseGroupId, broadcast]) => {
                await context.edge.broadcastToDurableObject(
                    `/api/durable-objects/database-groups/${databaseGroupId}/broadcast-table-metadata-realtime-event-transaction`,
                    {
                        serviceName: "DatabaseGroupService",
                        route: "/api/durable-objects/database-groups/:databaseGroupId/broadcast-table-metadata-realtime-event-transaction",
                        body: DatabaseTableMetadataBroadcastRealtimeEventsSchema.serialize({
                            events: broadcast.events,
                            resolvedAccessPolicyByTableId: broadcast.resolvedAccessPolicyByTableId,
                        }),
                    },
                );
            }),
        );
    },
});

export type DatabaseTableItem = RynamoTableItemType<
    typeof DatabaseTablesTable,
    "Table",
    "Attributes"
>;
