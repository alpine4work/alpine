import {Schema} from "~/shared/schema/schema.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

export type DatabaseRealtimeEvent = WebSocketProtocolEventType<typeof DatabaseRealtimeProtocol>;

export const DatabaseRealtimeProtocol = defineWebSocketProtocol({
    procedures: {
        query: {
            input: {
                sql: Schema.string,
            },
            output: {
                rows: Schema.array(Schema.unknown()),
                pages: Schema.array(
                    Schema.object({
                        pageIndex: Schema.integer,
                        timestamp: Schema.integer,
                        data: Schema.bytes,
                    }),
                ),
            },
        },
        mutate: {
            input: {
                sql: Schema.string,
            },
            output: {
                rows: Schema.array(Schema.unknown()),
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
                    // TODO: diffs instead of full changed pages
                    data: Schema.bytes,
                }),
            ),
        }),
    },
});
