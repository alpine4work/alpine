import {
    DatabaseActionObjectSchema,
    DatabaseActionResultSchema,
} from "~/shared/databases/database_actions.js";
import {DatabaseModel} from "~/shared/databases/database_model.js";
import {pageDiffSchema} from "~/shared/databases/page_diff.js";
import {
    DynamoGeneralRealtimeEventStubSchema,
    createDynamoGeneralRealtimeEventSchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import type {DatabaseMutationId} from "~/shared/id/types/id_types.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {type ObjectSchemaConfigType, Schema} from "~/shared/schema/schema.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

/**
 * Schema output config for `ensureCacheIsUpToDate`.
 * Reused by both the WebSocket protocol definition
 * and the worker-to-tab RPC method definition.
 *
 * Empty states represent different modes:
 * - Both empty — cache is up to date.
 * - `updatedPages` non-empty — server inlined page
 *   data for a small number of stale pages.
 * - `stalePageIndexes` non-empty, `updatedPages`
 *   empty — too many stale pages; client deletes
 *   them and re-fetches on demand.
 */
export const ensureCacheIsUpToDateResultConfig = {
    updatedPages: Schema.map(
        Schema.integer,
        Schema.object({
            timestamp: Schema.integer,
            data: Schema.bytes,
        }),
    ),
    stalePageIndexes: Schema.array(Schema.integer),
    fileSizeInPages: Schema.integer,
};

/**
 * TypeScript type for the `ensureCacheIsUpToDate`
 * result, inferred from the shared schema config.
 */
export type EnsureCacheIsUpToDateResult = ObjectSchemaConfigType<
    typeof ensureCacheIsUpToDateResultConfig
>;

export type DynamoGeneralRealtimeDatabaseEvent = ReturnType<
    typeof DynamoGeneralRealtimeDatabaseEventSchema.deserialize
>;

export const DynamoGeneralRealtimeDatabaseEventSchema = createDynamoGeneralRealtimeEventSchema(
    createModelUnionSchema({Database: DatabaseModel}),
);

export const DatabaseBroadcastRealtimeEventTransactionSchema = Schema.object({
    eventTransaction: Schema.array(DynamoGeneralRealtimeEventStubSchema),
});

export type DatabaseRealtimeEvent = WebSocketProtocolEventType<typeof DatabaseRealtimeProtocol>;

export const DatabaseRealtimeProtocol = defineWebSocketProtocol({
    procedures: {
        executeAction: {
            input: {
                action: DatabaseActionObjectSchema,
                mutationId: Schema.id<DatabaseMutationId>(),
                returnResult: Schema.boolean.default(true),
                returnPages: Schema.boolean.default(true),
            },
            output: {
                result: DatabaseActionResultSchema.nullable(),
                readPages: Schema.map(
                    Schema.integer,
                    Schema.object({
                        timestamp: Schema.integer,
                        data: Schema.bytes,
                    }),
                ).nullable(),
            },
        },
        ensureCacheIsUpToDate: {
            input: {
                pageTimestampsByIndex: Schema.map(Schema.integer, Schema.integer),
            },
            output: ensureCacheIsUpToDateResultConfig,
        },
        acknowledgePages: {
            input: {
                pageIndexes: Schema.array(Schema.integer),
            },
            output: {},
        },
    },
    events: {
        PagesChanged: Schema.object({
            type: Schema.value("PagesChanged"),
            pages: Schema.array(
                Schema.object({
                    pageIndex: Schema.integer,
                    timestamp: Schema.integer,
                    diff: pageDiffSchema,
                }),
            ),
            mutationId: Schema.id<DatabaseMutationId>(),
            fileSizeInPages: Schema.integer,
        }),
        RealtimeEventTransaction: Schema.object({
            type: Schema.value("RealtimeEventTransaction"),
            eventTransaction: Schema.array(DynamoGeneralRealtimeDatabaseEventSchema),
        }),
    },
});
