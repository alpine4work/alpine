import {CreateOrUpdateAccessPolicySchema} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {DatabaseTableMetadataRealtimeEventSchema} from "~/shared/databases/database_realtime_protocol.js";
import {DatabaseTableMetadataModel} from "~/shared/databases/database_table_metadata_model.js";
import {RynamoEventStubSchema, createRynamoItemSchema} from "~/shared/dynamo/rynamo_types.js";
import {
    DatabaseGroupId,
    DatabaseTableId,
    DatabaseViewId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.js";

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
        spaceId: Schema.id<SpaceId>(),
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
        spaceId: Schema.id<SpaceId>(),
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
