import {
    DatabaseEnsureCacheIsUpToDateResultConfig,
    DatabaseExecuteActionInputConfig,
    DatabaseExecuteActionOutputConfig,
    DatabasePageDiffsSchema,
    DatabasePageIndexesSchema,
    DatabasePageVersionsByIndexSchema,
} from "~/shared/databases/database_protocol_schemas.js";
import {DatabaseTableMetadataModel} from "~/shared/databases/database_table_metadata_model.js";
import {RynamoEventStubSchema, createRynamoEventSchema} from "~/shared/dynamo/rynamo_types.js";
import type {DatabaseMutationId} from "~/shared/id/types/id_types.js";
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
        ensureCacheIsUpToDate: {
            input: {pageVersionsByIndex: DatabasePageVersionsByIndexSchema},
            output: DatabaseEnsureCacheIsUpToDateResultConfig,
        },
        acknowledgePages: {
            input: {pageIndexes: DatabasePageIndexesSchema},
            output: {},
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
            events: Schema.array(DatabaseTableMetadataRealtimeEventSchema),
        }),
    },
});

export const DatabaseTableMetadataBroadcastRealtimeEventsSchema = Schema.object({
    events: Schema.array(RynamoEventStubSchema),
});
