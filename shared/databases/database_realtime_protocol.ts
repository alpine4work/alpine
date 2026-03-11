import {pageDiffSchema} from "~/shared/databases/page_diff.js";
import type {DatabaseMutationId} from "~/shared/id/types/id_types.js";
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
        execute: {
            input: {
                sql: Schema.string,
                mutationId: Schema.id<DatabaseMutationId>(),
                allowWrites: Schema.boolean,
            },
            output: {
                rows: Schema.array(Schema.unknown()),
                readPages: Schema.map(
                    Schema.integer,
                    Schema.object({
                        timestamp: Schema.integer,
                        data: Schema.bytes,
                    }),
                ),
            },
        },
        ensureCacheIsUpToDate: {
            input: {
                pageTimestampsByIndex: Schema.map(Schema.integer, Schema.integer),
            },
            output: ensureCacheIsUpToDateResultConfig,
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
        }),
    },
});
