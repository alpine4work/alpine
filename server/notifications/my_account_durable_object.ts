import {createDurableObject} from "~/server/cloudflare/create_durable_object.js";
import {WebSocketServer} from "~/server/cloudflare/web_socket_server.js";
import {getAccountIfExists} from "~/server/dynamo/accounts_table.js";
import {ActionContext} from "~/server/dynamo/context/action_context.js";
import {MyAccountInboxRealtimeEventTransactionSchema} from "~/server/dynamo/context/notifications_context_module.js";
import {ProcessContext} from "~/server/dynamo/context/process_context.js";
import {MyAccountConnection} from "~/server/notifications/my_account_connection.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {MyAccountProtocol} from "~/shared/notifications/my_account_protocol.js";
import {Schema} from "~/shared/schema/schema.js";

class MyAccountDurableObject {
    public static readonly serviceName = "MyAccountService";

    private readonly _processContext: ProcessContext;
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
        processContext: ProcessContext;
        initializeActionContext: ActionContext;
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
        processContext: ProcessContext;
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

    public async fetch(context: ActionContext, request: Request): Promise<Response> {
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
                await authorizeMyAccountAccess(context, this._accountId);

                const {readTime, eventTransaction} =
                    MyAccountInboxRealtimeEventTransactionSchema.deserialize(await request.json());

                // Forward the event transaction to all our connected clients...
                this._webSocketServer.sendEventToAll(context, {
                    type: "InboxRealtimeEventTransaction",
                    readTime,
                    eventTransaction,
                });

                return new Response();
            }
            default:
                throw new NotFoundError("Unexpected path");
        }
    }
}

const MyAccountDurableObjectWrapper = createDurableObject(MyAccountDurableObject);
export {MyAccountDurableObjectWrapper as MyAccountDurableObject};

async function authorizeMyAccountAccess(context: ActionContext, accountId: AccountId) {
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
            if (!(await getAccountIfExists(context, context.actor.getSpaceId(), accountId))) {
                throw new PermissionDeniedError("Account does not exist in space");
            }
            break;
        }
        default:
            throw exhaustive(context.actor);
    }
}
