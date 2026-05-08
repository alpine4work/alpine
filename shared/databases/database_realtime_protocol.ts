import {
    DatabaseEnsureCacheIsUpToDateResultConfig,
    DatabaseExecuteActionInputConfig,
    DatabaseExecuteActionOutputConfig,
    DatabasePageDiffsSchema,
    DatabasePageIndexesSchema,
    DatabasePageVersionsByIndexSchema,
} from "~/shared/databases/database_protocol_schemas.js";
import type {DatabaseMutationId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

export type DatabaseRealtimeEvent = WebSocketProtocolEventType<typeof DatabaseRealtimeProtocol>;

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
    },
});
