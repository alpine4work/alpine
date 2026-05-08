import {
    DatabaseActionObjectSchema,
    DatabaseActionResultSchema,
} from "~/shared/databases/database_actions.js";
import {
    DatabasePageDiffsSchema,
    DatabasePagesSchema,
} from "~/shared/databases/database_table_pages.js";
import type {DatabaseMutationId, DatabaseTableId} from "~/shared/id/types/id_types.js";
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
 * Keyed by {@link DatabaseTableId}: each table is its own
 * SQLite database (attached together on the client) and
 * the cache is validated independently per table.
 *
 * Within each per-table entry, empty states represent
 * different modes:
 * - Both empty — that table's cache is up to date.
 * - `updatedPages` non-empty — server inlined page
 *   data for a small number of stale pages.
 * - `stalePageIndexes` non-empty, `updatedPages`
 *   empty — too many stale pages; client deletes
 *   them and re-fetches on demand.
 */
export const ensureCacheIsUpToDateResultConfig = {
    tables: Schema.map(
        Schema.id<DatabaseTableId>(),
        Schema.object({
            updatedPages: Schema.map(
                Schema.integer,
                Schema.object({
                    timestamp: Schema.integer,
                    data: Schema.bytes,
                }),
            ),
            stalePageIndexes: Schema.array(Schema.integer),
            fileSizeInPages: Schema.integer,
        }),
    ),
};

/**
 * TypeScript type for the `ensureCacheIsUpToDate`
 * result, inferred from the shared schema config.
 */
export type EnsureCacheIsUpToDateResult = ObjectSchemaConfigType<
    typeof ensureCacheIsUpToDateResultConfig
>;

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
                readPages: DatabasePagesSchema.nullable(),
            },
        },
        ensureCacheIsUpToDate: {
            input: {
                pageTimestampsByIndex: Schema.map(
                    Schema.id<DatabaseTableId>(),
                    Schema.map(Schema.integer, Schema.integer),
                ),
            },
            output: ensureCacheIsUpToDateResultConfig,
        },
        acknowledgePages: {
            input: {
                pageIndexes: Schema.map(Schema.id<DatabaseTableId>(), Schema.array(Schema.integer)),
            },
            output: {},
        },
    },
    events: {
        PagesChanged: Schema.object({
            type: Schema.value("PagesChanged"),
            pageDiffs: DatabasePageDiffsSchema,
            fileSizesInPages: Schema.map(Schema.id<DatabaseTableId>(), Schema.integer),
            mutationId: Schema.id<DatabaseMutationId>(),
        }),
    },
});
