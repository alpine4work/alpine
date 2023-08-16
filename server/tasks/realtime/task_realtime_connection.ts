import {ServerSessionActionContextModules} from "~/server/context/server_action_context.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TaskRealtimeProtocol} from "~/shared/tasks/task_realtime_protocol.js";

export class TaskRealtimeConnection {
    private readonly _server: TaskRealtimeServer;
    private readonly _spaceId: SpaceId;

    constructor({server, spaceId}: {server: TaskRealtimeServer; spaceId: SpaceId}) {
        this._server = server;
        this._spaceId = spaceId;
    }

    public readonly procedures: WebSocketConnectionProcedures<
        ServerSessionActionContextModules,
        typeof TaskRealtimeProtocol
    > = {
        loadQuery: async (context, input) => {
            await this._server.loadQuery(context, {
                spaceId: this._spaceId,
                filters: input.filters,
                sorts: input.sorts,
                limit: input.limit,
            });

            return {};
        },
    };
}
