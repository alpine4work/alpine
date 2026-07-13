import {resolveDatabaseTableAccessPolicyForDurableObject} from "~/server/databases/data/resolve_database_table_access_policy_for_durable_object.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {RynamoTableItemType, RynamoTableSchema} from "~/server/rynamo/rynamo_table_schema.js";
import {AccessPolicySchema, type LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {DatabaseTableMetadataBroadcastRealtimeEventsSchema} from "~/shared/databases/database_realtime_protocol.js";
import {DatabaseTableMetadataModel} from "~/shared/databases/database_table_metadata_model.js";
import {RynamoEventStub} from "~/shared/dynamo/rynamo_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import type {DatabaseGroupId, DatabaseTableId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export const DatabaseTablesTable = RynamoTableSchema.new({
    name: "DatabaseTables",
    partitions: [
        {
            name: "DatabaseGroup",
            partitionKeyAttributes: {
                databaseGroupId: DynamoKeyAttributeSchema.id<DatabaseGroupId>(),
            },
            sortRanges: [
                {
                    name: "Table",
                    sortKeyAttributes: {
                        tableId: DynamoKeyAttributeSchema.id<DatabaseTableId>(),
                    },
                    attributes: Schema.object({
                        name: Schema.string.nullable(),
                        spaceId: Schema.id<SpaceId>().nullable(),
                        isDeleted: Schema.boolean,
                        accessPolicy: AccessPolicySchema,
                    }),
                },
            ],
        },
    ],
    modelSchema: DatabaseTableMetadataModel.schema(),
    models: {
        DatabaseGroup: {
            Table: {
                build: async (_context, item) =>
                    new DatabaseTableMetadataModel({
                        databaseGroupId: item.databaseGroupId,
                        tableId: item.tableId,
                        spaceId: assertExists(item.spaceId),
                        name: item.name,
                        isDeleted: item.isDeleted,
                        accessPolicy: item.accessPolicy,
                        version: item.updateLockVersion ?? 0,
                    }),
            },
        },
    },
    broadcastEvents: async (context, events) => {
        const eventsByDatabaseGroupId = new Map<DatabaseGroupId, Array<RynamoEventStub>>();
        const resolvedAccessPolicyByTableIdByDatabaseGroupId = new Map<
            DatabaseGroupId,
            Map<DatabaseTableId, LocalAccessPolicy | null>
        >();

        await runAllPromises(
            events.map(async ({itemKey, eventStub, getEvent}) => {
                if (itemKey.partitionType !== "DatabaseGroup") return;

                const event = await getEvent(context);
                let resolvedAccessPolicy: LocalAccessPolicy | null;
                switch (event.type) {
                    case "PutItem":
                        resolvedAccessPolicy =
                            await resolveDatabaseTableAccessPolicyForDurableObject(
                                context,
                                event.item.model.accessPolicy,
                            );
                        break;
                    case "DeleteItem":
                        resolvedAccessPolicy = null;
                        break;
                    default:
                        throw exhaustive(event);
                }

                getOrSetDefaultMapValue(
                    eventsByDatabaseGroupId,
                    itemKey.databaseGroupId,
                    () => [],
                ).push(eventStub);
                getOrSetDefaultMapValue(
                    resolvedAccessPolicyByTableIdByDatabaseGroupId,
                    itemKey.databaseGroupId,
                    () => new Map(),
                ).set(itemKey.tableId, resolvedAccessPolicy);
            }),
        );

        await runAllPromises(
            mapIterable(eventsByDatabaseGroupId, async ([databaseGroupId, eventsForGroup]) => {
                if (eventsForGroup.length === 0) return;

                await context.edge.broadcastToDurableObject(
                    `/api/durable-objects/database-groups/${databaseGroupId}/broadcast-table-metadata-realtime-event-transaction`,
                    {
                        serviceName: "DatabaseGroupService",
                        route: "/api/durable-objects/database-groups/:databaseGroupId/broadcast-table-metadata-realtime-event-transaction",
                        body: DatabaseTableMetadataBroadcastRealtimeEventsSchema.serialize({
                            events: eventsForGroup,
                            resolvedAccessPolicyByTableId: assertExists(
                                resolvedAccessPolicyByTableIdByDatabaseGroupId.get(databaseGroupId),
                            ),
                        }),
                    },
                );
            }),
        );
    },
});

export type DatabaseTableItem = RynamoTableItemType<
    typeof DatabaseTablesTable,
    "DatabaseGroup",
    "Table"
>;
