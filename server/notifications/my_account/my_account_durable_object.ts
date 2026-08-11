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
import {
    MyAccountConnection,
    MyAccountEventStub,
} from "~/server/notifications/my_account/my_account_connection.js";
import {MyAccountDurableObjectAuthorizer} from "~/server/notifications/my_account/my_account_durable_object_authorizer.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {
    MyAccountBroadcastInboxRealtimeEventsSchema,
    MyAccountProtocol,
} from "~/shared/notifications/my_account_protocol.js";
import {Schema} from "~/shared/schema/schema.js";

type MyAccountDurableObjectRoute = "Main" | "BroadcastInboxRealtimeEvents" | "NotFound";

class MyAccountDurableObject {
    public static readonly serviceName = "MyAccountService";

    private readonly _processContext: WorkerProcessContext;
    private readonly _accountId: AccountId;
    private readonly _authorizer: MyAccountDurableObjectAuthorizer;

    private readonly _webSocketServer: WebSocketServer<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
        typeof MyAccountProtocol,
        MyAccountEventStub,
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
            MyAccountEventStub,
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

        if (url.pathname === "/broadcast-inbox-realtime-event-transaction") {
            return ["/broadcast-inbox-realtime-event-transaction", "BroadcastInboxRealtimeEvents"];
        }

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
                return await this._webSocketServer.upgrade(
                    context.actor.authorizeSession(),
                    request,
                );
            }
            case "BroadcastInboxRealtimeEvents": {
                // Make sure a user can't POST from their browser to broadcast a realtime event
                // transaction. A POST request from a browser would be from the `AppClient` or
                // `EdgeService` service.
                if (
                    context.actor.serviceName !== "AppService" &&
                    context.actor.serviceName !== "JobQueueService" &&
                    context.actor.serviceName !== "ApiService"
                ) {
                    throw new PermissionDeniedError(
                        "Only some services can broadcast realtime event transactions",
                    );
                }

                await this._authorizer.authorizeMyAccountAccess(context, this._accountId);

                const {events} = MyAccountBroadcastInboxRealtimeEventsSchema.deserialize(
                    await request.json(),
                );

                // Forward the event transaction to all our connected clients...
                this._webSocketServer.sendEventToAll(context, {
                    type: "InboxRealtimeEvents",
                    events,
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
