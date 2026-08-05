import {LocalAccessPolicySchema} from "~/shared/access/access_policy.js";
import {
    DatabaseExecuteActionInputConfig,
    DatabaseExecuteActionOutputConfig,
    DatabasePageDiffsSchema,
    DatabaseRegisterTablesResultConfig,
    DatabaseTableAccessLevelsSchema,
    DatabaseTableRegistrationsSchema,
} from "~/shared/databases/database_protocol_schemas.js";
import {DatabaseTableMetadataModel} from "~/shared/databases/database_table_metadata_model.js";
import {RynamoEventStubSchema, createRynamoEventSchema} from "~/shared/dynamo/rynamo_types.js";
import type {DatabaseMutationId, DatabaseTableId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

export type DatabaseRealtimeEvent = WebSocketProtocolEventType<typeof DatabaseRealtimeProtocol>;

export const DatabaseTableMetadataRealtimeEventSchema = createRynamoEventSchema(
    DatabaseTableMetadataModel.schema(),
);

export const DatabaseRealtimeProtocol = defineWebSocketProtocol({
    procedures: {
        executeAction: {
            input: DatabaseExecuteActionInputConfig,
            output: DatabaseExecuteActionOutputConfig,
        },
        registerTables: {
            input: {tables: DatabaseTableRegistrationsSchema},
            output: DatabaseRegisterTablesResultConfig,
        },
    },
    events: {
        PagesChanged: Schema.object({
            type: Schema.value("PagesChanged"),
            pageDiffs: DatabasePageDiffsSchema,
            mutationId: Schema.id<DatabaseMutationId>(),
        }),
        TableMetadataChanged: Schema.object({
            type: Schema.value("TableMetadataChanged"),
            /**
             * Only the events the receiving account may see; events for tables it lacks `View`
             * on are dropped (their ids surface in `tableAccess` as `null` instead — never as
             * a socket error, since a group mixes accessible and inaccessible tables).
             */
            events: Schema.array(DatabaseTableMetadataRealtimeEventSchema),
            /**
             * Access-map delta covering every table this batch touched. The client merges it
             * over the entries it accumulated from table registrations. Empty for trusted
             * internal connections.
             */
            tableAccess: DatabaseTableAccessLevelsSchema,
        }),
    },
});

export const DatabaseTableMetadataBroadcastRealtimeEventsSchema = Schema.object({
    events: Schema.array(RynamoEventStubSchema),
    resolvedAccessPolicyByTableId: Schema.map(
        Schema.id<DatabaseTableId>(),
        LocalAccessPolicySchema.nullable(),
    ),
});
