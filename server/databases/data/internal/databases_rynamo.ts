import {dangerouslyResolveDatabaseTableAccessPolicyReplica} from "~/server/databases/data/dangerously_resolve_database_table_access_policy_replica.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {RynamoTableItemType, RynamoTableSchema} from "~/server/rynamo/rynamo_table_schema.js";
import {AccessPolicySchema, type LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {DatabaseTableMetadataBroadcastRealtimeEventsSchema} from "~/shared/databases/database_realtime_protocol.js";
import type {DatabaseTableAccessPolicyRevision} from "~/shared/databases/database_table_access_policy_revision.js";
import {DatabaseTableMetadataModel} from "~/shared/databases/database_table_metadata_model.js";
import {RynamoEventStub} from "~/shared/dynamo/rynamo_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import type {
    DatabaseGroupId,
    DatabaseTableId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.js";

export const DatabasesRynamo = RynamoTableSchema.new({
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
    // Best-effort: a crash between the DynamoDB write and this callback loses the
    // push, and a `Site` policy source can change with no table metadata write at all.
    // Neither can preserve revoked access — each active database group Durable Object
    // periodically re-pulls its resolved policy replicas (see
    // `getDatabaseGroupAccessPolicyReplicas`) and applies them through the same
    // monotonic revision guard.
    broadcastEvents: async (context, events) => {
        const broadcastsByDatabaseGroupId = new Map<
            DatabaseGroupId,
            {
                events: Array<RynamoEventStub>;
                resolvedAccessPolicyByTableId: Map<
                    DatabaseTableId,
                    {
                        humanName: string;
                        accessPolicy: LocalAccessPolicy | null;
                        revision: DatabaseTableAccessPolicyRevision;
                    }
                >;
            }
        >();

        const resolvedBroadcastEvents = await runAllPromises(
            events.map(async ({itemKey, eventStub, getEvent}) => {
                if (itemKey.partitionType !== "Table") return null;

                const event = await getEvent(context);
                assert(
                    event.type === "PutItem",
                    "Database table metadata deletion is not supported",
                );
                const {databaseGroupId, accessPolicy, version} = event.item.model;
                const humanName = event.item.model.name;
                assert(humanName !== null, "Database table metadata deletion is not supported");
                const resolvedAccessPolicy =
                    await dangerouslyResolveDatabaseTableAccessPolicyReplica(
                        context,
                        accessPolicy,
                        version,
                        {consistency: "StrongWithinCache"},
                    );

                return {
                    databaseGroupId,
                    eventStub,
                    resolvedAccessPolicy,
                    humanName,
                    tableId: itemKey.tableId,
                };
            }),
        );

        for (const resolvedBroadcastEvent of resolvedBroadcastEvents) {
            if (resolvedBroadcastEvent === null) continue;
            const {databaseGroupId, eventStub, resolvedAccessPolicy, humanName, tableId} =
                resolvedBroadcastEvent;
            const broadcast = getOrSetDefaultMapValue(
                broadcastsByDatabaseGroupId,
                databaseGroupId,
                () => ({events: [], resolvedAccessPolicyByTableId: new Map()}),
            );
            broadcast.events.push(eventStub);
            broadcast.resolvedAccessPolicyByTableId.set(tableId, {
                humanName,
                ...resolvedAccessPolicy,
            });
        }

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

export type DatabaseTableItem = RynamoTableItemType<typeof DatabasesRynamo, "Table", "Attributes">;
