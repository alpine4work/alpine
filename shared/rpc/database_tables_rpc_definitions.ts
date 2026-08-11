import {LocalAccessPolicySchema} from "~/shared/access/access_policy.js";
import {CreateOrUpdateAccessPolicySchema} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {DatabaseTableMetadataRealtimeEventSchema} from "~/shared/databases/database_realtime_protocol.js";
import {DatabaseTableAccessPolicyRevisionSchema} from "~/shared/databases/database_table_access_policy_revision.js";
import {DatabaseTableMetadataModel} from "~/shared/databases/database_table_metadata_model.js";
import {RynamoEventStubSchema, createRynamoItemSchema} from "~/shared/dynamo/rynamo_types.js";
import {
    DatabaseGroupId,
    DatabaseTableId,
    DatabaseViewId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

export const createDatabaseTable = defineRpc({
    name: "createDatabaseTable",
    // Creates a new table each time.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        name: LabelStringSchema,
    },
    output: {
        tableId: Schema.id<DatabaseTableId>(),
        viewId: Schema.id<DatabaseViewId>(),
    },
});

export const updateDatabaseTableAccessPolicy = defineRpc({
    name: "updateDatabaseTableAccessPolicy",
    // Access policy updates are applied as a full replacement.
    isIdempotent: true,
    input: {
        tableId: Schema.id<DatabaseTableId>(),
        accessPolicy: CreateOrUpdateAccessPolicySchema,
    },
    output: {
        events: Schema.array(DatabaseTableMetadataRealtimeEventSchema),
    },
});

export const getDatabaseTableMetadataItem = defineRpc({
    name: "getDatabaseTableMetadataItem",
    isIdempotent: true,
    input: {
        tableId: Schema.id<DatabaseTableId>(),
    },
    output: {
        item: createRynamoItemSchema(DatabaseTableMetadataModel.schema()),
    },
});

export const getDatabaseTableMetadataRealtimeEvent = defineRpc({
    name: "getDatabaseTableMetadataRealtimeEvent",
    isIdempotent: true,
    input: {
        databaseGroupId: Schema.id<DatabaseGroupId>(),
        events: Schema.array(RynamoEventStubSchema),
    },
    output: {
        /** The events the calling actor may see. */
        events: Schema.array(DatabaseTableMetadataRealtimeEventSchema),
        /**
         * Tables whose events were withheld — the actor lacks `View` on them (or the
         * metadata was deleted). Redacted rather than an error: a group mixes accessible
         * and inaccessible tables, and the ids double as the revocation signal for the
         * receiver's access map.
         */
        deniedTableIds: Schema.array(Schema.id<DatabaseTableId>()),
    },
});

/**
 * Authorizes the calling actor's access to the space a database group belongs to.
 * Called by the database group durable object when a realtime connection is
 * (re-)authorized; throws `PermissionDeniedError` when the actor is not a member
 * of the group's space.
 */
export const authorizeDatabaseGroupAccess = defineRpc({
    name: "authorizeDatabaseGroupAccess",
    isIdempotent: true,
    input: {
        databaseGroupId: Schema.id<DatabaseGroupId>(),
    },
    output: {},
});

/**
 * Called by the database group durable object to reconcile its per-table access
 * policy copies. The push paths (`DatabasesRynamo.broadcastEvents` and the search
 * index sync) are best-effort, so the durable object periodically re-pulls every
 * table's resolved policy replica and applies it through its monotonic revision
 * guard.
 *
 * The output contains resolved policies for every requested table in the group,
 * regardless of the calling account's per-table access — it must stay visible to
 * `DatabaseGroupService` only.
 */
export const getDatabaseGroupAccessPolicyReplicas = defineRpc({
    name: "getDatabaseGroupAccessPolicyReplicas",
    isIdempotent: true,
    input: {
        databaseGroupId: Schema.id<DatabaseGroupId>(),
        tableIds: Schema.array(Schema.id<DatabaseTableId>()),
    },
    output: {
        /**
         * Requested tables with no metadata item (or an item outside the group) are absent
         * — the durable object keeps its current copy for them.
         */
        replicaByTableId: Schema.map(
            Schema.id<DatabaseTableId>(),
            Schema.object({
                accessPolicy: LocalAccessPolicySchema,
                revision: DatabaseTableAccessPolicyRevisionSchema,
            }),
        ),
    },
});
