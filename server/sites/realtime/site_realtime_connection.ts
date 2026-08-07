import {
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {authorizeSiteAccessForDurableObject} from "~/server/sites/realtime/authorize_site_access_for_durable_object.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {RynamoEventStub} from "~/shared/dynamo/rynamo_types.js";
import {SiteId} from "~/shared/id/types/id_types.open_source.js";
import {MyAccountProtocol} from "~/shared/notifications/my_account_protocol.js";
import {getSiteRealtimeEvent} from "~/shared/rpc/sites_rpc_definitions.js";
import {SiteRealtimeEvent} from "~/shared/sites/site_realtime_protocol.js";

export type SiteRealtimeEventStub = {
    readonly type: "RealtimeEvents";
    readonly events: ReadonlyArray<RynamoEventStub>;
};

export class SiteRealtimeConnection {
    private readonly _siteId: SiteId;

    constructor({siteId}: {siteId: SiteId}) {
        this._siteId = siteId;
    }

    public async authorize(context: WorkerSessionActionContext) {
        await authorizeSiteAccessForDurableObject(context, this._siteId);
    }

    public readonly procedures: WebSocketConnectionProcedures<
        WorkerSessionActionContextModules,
        typeof MyAccountProtocol
    > = {};

    public async transformEvent(
        context: WorkerSessionActionContext,
        eventStub: SiteRealtimeEventStub,
    ): Promise<SiteRealtimeEvent> {
        const {events} = await getSiteRealtimeEvent(context, {
            siteId: this._siteId,
            events: eventStub.events,
        });

        return {
            type: eventStub.type,
            events,
        };
    }
}
