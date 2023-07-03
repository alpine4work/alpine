import {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {createDurableObject} from "~/server/cloudflare/create_durable_object.js";
import {WebSocketServer} from "~/server/cloudflare/web_socket_server.js";
import {MyAccountConnection} from "~/server/notifications/my_account_connection.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {MyAccountProtocol} from "~/shared/notifications/my_account_protocol.js";
import {getAccountIfExists} from "~/shared/rpc/accounts_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";

class MyAccountDurableObject {
    public static readonly serviceName = "MyAccountService";

    private readonly _processContext: WorkerProcessContext;
    private readonly _accountId: AccountId;

    private readonly _webSocketServer: WebSocketServer<
        typeof MyAccountProtocol,
        MyAccountConnection
    >;

    public static async initialize({
        processContext,
        initializeActionContext,
        idName,
    }: {
        processContext: WorkerProcessContext;
        initializeActionContext: WorkerActionContext;
        idName: string;
    }): Promise<MyAccountDurableObject> {
        const accountId = Schema.id<AccountId>().deserialize(idName);

        await authorizeMyAccountAccess(initializeActionContext, accountId);

        return new MyAccountDurableObject({
            processContext,
            accountId,
        });
    }

    private constructor({
        processContext,
        accountId,
    }: {
        processContext: WorkerProcessContext;
        accountId: AccountId;
    }) {
        // Propagate the `AccountId` to all logs for this durable object.
        processContext = processContext.tracer.withPropagatedData({context: {accountId}});

        this._processContext = processContext;
        this._accountId = accountId;

        this._webSocketServer = new WebSocketServer(
            this._processContext,
            MyAccountProtocol,
            async ({connectActionContext}) => {
                await authorizeMyAccountAccess(connectActionContext, this._accountId);
                return new MyAccountConnection();
            },
        );
    }

    public async fetch(context: WorkerActionContext, request: Request): Promise<Response> {
        // Propagate the `AccountId` to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {accountId: this._accountId},
        });

        const url = new URL(request.url);
        switch (url.pathname) {
            case "/": {
                return this._webSocketServer.upgrade(context.actor.authorizeSession(), request);
            }
            case "/inbox-realtime-event-transaction": {
                // NOCOMMIT
                //
                // await authorizeMyAccountAccess(context, this._accountId);
                //
                // const {readTime, eventTransaction} =
                //     MyAccountInboxRealtimeEventTransactionSchema.deserialize(await request.json());
                //
                // // Forward the event transaction to all our connected clients...
                // this._webSocketServer.sendEventToAll(context, {
                //     type: "InboxRealtimeEventTransaction",
                //     readTime,
                //     eventTransaction,
                // });

                return new Response();
            }
            default:
                throw new NotFoundError("Unexpected path");
        }
    }
}

const MyAccountDurableObjectWrapper = createDurableObject(MyAccountDurableObject);
export {MyAccountDurableObjectWrapper as MyAccountDurableObject};

async function authorizeMyAccountAccess(context: WorkerActionContext, accountId: AccountId) {
    switch (context.actor.type) {
        case "Session": {
            if (context.actor.getAccountId() !== accountId) {
                throw new PermissionDeniedError(
                    "Can only access the durable object for your own account",
                );
            }
            break;
        }
        case "System": {
            const {account} = await getAccountIfExists(context, {
                spaceId: context.actor.getSpaceId(),
                accountId: accountId,
            });
            if (!account) {
                throw new PermissionDeniedError("Account does not exist in space");
            }
            break;
        }
        default:
            throw exhaustive(context.actor);
    }
}
