import {
    WorkerActionContext,
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {
    WorkerProcessContext,
    WorkerProcessContextModules,
} from "~/server/cloudflare/context/worker_process_context.js";
import {createDurableObject} from "~/server/cloudflare/create_durable_object.js";
import {MyAccountConnection} from "~/server/notifications/my_account/my_account_connection.js";
import {MyAccountDurableObjectAuthorizer} from "~/server/notifications/my_account/my_account_durable_object_authorizer.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {NotFoundError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {MyAccountSendInboxRealtimeEventTransactionSchema} from "~/shared/notifications/my_account_inbox_realtime_event_transaction_schema.js";
import {MyAccountProtocol} from "~/shared/notifications/my_account_protocol.js";
import {Schema} from "~/shared/schema/schema.js";

type MyAccountDurableObjectRoute = "Main" | "SendInboxRealtimeEventTransaction" | "NotFound";

class MyAccountDurableObject {
    public static readonly serviceName = "MyAccountService";

    private readonly _processContext: WorkerProcessContext;
    private readonly _accountId: AccountId;
    private readonly _authorizer: MyAccountDurableObjectAuthorizer;

    private readonly _webSocketServer: WebSocketServer<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
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

        const authorizer = new MyAccountDurableObjectAuthorizer();
        await authorizer.authorizeMyAccountAccess(initializeActionContext, accountId);

        return new MyAccountDurableObject({
            processContext,
            accountId,
            authorizer,
        });
    }

    private constructor({
        processContext,
        accountId,
        authorizer,
    }: {
        processContext: WorkerProcessContext;
        accountId: AccountId;
        authorizer: MyAccountDurableObjectAuthorizer;
    }) {
        // Propagate the `AccountId` to all logs for this durable object.
        processContext = processContext.tracer.withPropagatedData({context: {accountId}});

        this._processContext = processContext;
        this._accountId = accountId;
        this._authorizer = authorizer;

        this._webSocketServer = new WebSocketServer<
            WorkerProcessContextModules,
            WorkerSessionActionContextModules,
            typeof MyAccountProtocol,
            MyAccountConnection
        >(this._processContext, MyAccountProtocol, () => {
            return new MyAccountConnection({
                accountId: this._accountId,
                authorizer: this._authorizer,
            });
        });
    }

    public static parseRoute(url: URL): [string, MyAccountDurableObjectRoute] {
        if (url.pathname === "/") return ["/", "Main"];

        if (url.pathname === "/send-inbox-realtime-event-transaction")
            return ["/send-inbox-realtime-event-transaction", "SendInboxRealtimeEventTransaction"];

        return ["/*", "NotFound"];
    }

    public async fetch(
        context: WorkerActionContext,
        request: Request,
        route: MyAccountDurableObjectRoute,
    ): Promise<Response> {
        // Propagate the `AccountId` to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {accountId: this._accountId},
        });

        switch (route) {
            case "Main": {
                return this._webSocketServer.upgrade(context.actor.authorizeSession(), request);
            }
            case "SendInboxRealtimeEventTransaction": {
                await this._authorizer.authorizeMyAccountAccess(context, this._accountId);

                // Only system requests can send a realtime event transaction. This prevents a
                // user from sending a POST request from their browser.
                context.actor.authorizeSystem();

                const {readTime, eventTransaction} =
                    MyAccountSendInboxRealtimeEventTransactionSchema.deserialize(
                        await request.json(),
                    );

                // Forward the event transaction to all our connected clients...
                this._webSocketServer.sendEventToAll(context, {
                    type: "InboxRealtimeEventTransaction",
                    readTime,
                    eventTransaction,
                });

                return new Response();
            }
            case "NotFound":
                throw new NotFoundError("Route not found");
            default:
                throw exhaustive(route);
        }
    }

    public connectForTest(context: WorkerSessionActionContext) {
        return this._webSocketServer.connectForTest(context);
    }
}

const MyAccountDurableObjectWrapper = createDurableObject(MyAccountDurableObject);
export {MyAccountDurableObjectWrapper as MyAccountDurableObject};
