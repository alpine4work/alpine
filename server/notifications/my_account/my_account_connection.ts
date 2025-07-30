import {
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {MyAccountDurableObjectAuthorizer} from "~/server/notifications/my_account/my_account_durable_object_authorizer.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {MyAccountEvent, MyAccountProtocol} from "~/shared/notifications/my_account_protocol.js";

export class MyAccountConnection {
    private readonly _accountId: AccountId;
    private readonly _authorizer: MyAccountDurableObjectAuthorizer;

    constructor({
        accountId,
        authorizer,
    }: {
        accountId: AccountId;
        authorizer: MyAccountDurableObjectAuthorizer;
    }) {
        this._accountId = accountId;
        this._authorizer = authorizer;
    }

    public async authorize(context: WorkerSessionActionContext) {
        await this._authorizer.authorizeMyAccountAccess(context, this._accountId);
    }

    public readonly procedures: WebSocketConnectionProcedures<
        WorkerSessionActionContextModules,
        typeof MyAccountProtocol
    > = {};

    public async transformEvent(
        context: WorkerSessionActionContext,
        eventStub: MyAccountEvent,
    ): Promise<MyAccountEvent> {
        // TODO(calebmer, #content-references-privacy-fix): Implement a proper event stub.
        return eventStub;
    }
}
