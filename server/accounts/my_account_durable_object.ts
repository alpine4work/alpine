import {MyAccountConnection} from "~/server/accounts/my_account_connection";
import {createDurableObject} from "~/server/cloudflare/create_durable_object";
import {WebSocketServer} from "~/server/cloudflare/web_socket_server";
import {getAccountIfExists} from "~/server/dynamo/accounts_table";
import {ActionContext} from "~/server/dynamo/context/action_context";
import {MyAccountInboxRealtimeEventTransactionSchema} from "~/server/dynamo/context/notifications_context_module";
import {ProcessContext} from "~/server/dynamo/context/process_context";
import {MyAccountProtocol} from "~/shared/accounts/my_account_protocol";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {AccountId} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";

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
            async ({connectActionContext, sendEvent}) => {
                await authorizeMyAccountAccess(connectActionContext, this._accountId);
                return new MyAccountConnection({sendEvent});
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

                const eventTransaction = MyAccountInboxRealtimeEventTransactionSchema.deserialize(
                    await request.json(),
                );

                // Forward the event transaction to all our connected clients...
                //
                // NOCOMMIT: Tests!
                this._webSocketServer.sendEventToAll(context, {
                    type: "InboxRealtimeEventTransaction",
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
