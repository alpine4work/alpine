import {
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {authorizeChannelAccessForDurableObject} from "~/server/forum/realtime/authorize_channel_access_for_durable_object.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {ChannelRealtimeEvent} from "~/shared/forum/channel_realtime_protocol.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {MyAccountProtocol} from "~/shared/notifications/my_account_protocol.js";

export class ChannelRealtimeConnection {
    private readonly _channelId: ChannelId;

    constructor({channelId}: {channelId: ChannelId}) {
        this._channelId = channelId;
    }

    public async authorize(context: WorkerSessionActionContext) {
        await authorizeChannelAccessForDurableObject(context, this._channelId);
    }

    public readonly procedures: WebSocketConnectionProcedures<
        WorkerSessionActionContextModules,
        typeof MyAccountProtocol
    > = {};

    public async transformEvent(
        context: WorkerSessionActionContext,
        eventStub: ChannelRealtimeEvent,
    ): Promise<ChannelRealtimeEvent> {
        // TODO(calebmer, #content-references-privacy-fix): Implement a proper event stub.
        return eventStub;
    }
}
