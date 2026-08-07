import {
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {authorizeChannelAccessForDurableObject} from "~/server/forum/realtime/authorize_channel_access_for_durable_object.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {RynamoEventStub} from "~/shared/dynamo/rynamo_types.js";
import {ChannelRealtimeEvent} from "~/shared/forum/channel_realtime_protocol.js";
import {ChannelId} from "~/shared/id/types/id_types.open_source.js";
import {MyAccountProtocol} from "~/shared/notifications/my_account_protocol.js";
import {getChannelRealtimeEvent} from "~/shared/rpc/forum_rpc_definitions.js";

export type ChannelRealtimeEventStub = {
    readonly type: "RealtimeEvents";
    readonly events: ReadonlyArray<RynamoEventStub>;
};

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
        eventStub: ChannelRealtimeEventStub,
    ): Promise<ChannelRealtimeEvent> {
        const {events} = await getChannelRealtimeEvent(context, {
            channelId: this._channelId,
            events: eventStub.events,
        });

        return {
            type: eventStub.type,
            events,
        };
    }
}
