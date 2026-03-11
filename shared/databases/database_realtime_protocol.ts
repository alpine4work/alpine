import {pageDiffSchema} from "~/shared/databases/page_diff.js";
import type {DatabaseMutationId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

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
        getPageLastModifiedTimes: {
            input: {
                pageIndexes: Schema.array(Schema.integer),
            },
            output: {
                pageTimestampsByIndex: Schema.map(Schema.integer, Schema.integer),
            },
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
