import {differenceInMinutes} from "date-fns";
import {
    WorkerActionContext,
    WorkerSessionActionContext,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {createDurableObject} from "~/server/cloudflare/create_durable_object.js";
import {WebSocketServer} from "~/server/cloudflare/web_socket_server.js";
import {MyAccountConnection} from "~/server/notifications/my_account/my_account_connection.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {MyAccountSendInboxRealtimeEventTransactionSchema} from "~/shared/notifications/my_account_inbox_realtime_event_transaction_schema.js";
import {MyAccountProtocol} from "~/shared/notifications/my_account_protocol.js";
import {getAccount} from "~/shared/rpc/accounts_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";

class MyAccountDurableObject {
    public static readonly serviceName = "MyAccountService";

    private readonly _processContext: WorkerProcessContext;
    private readonly _accountId: AccountId;
    private readonly _authorizer: MyAccountDurableObjectAuthorizer;

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

        this._webSocketServer = new WebSocketServer(
            this._processContext,
            MyAccountProtocol,
            async ({connectActionContext}) => {
                await this._authorizer.authorizeMyAccountAccess(
                    connectActionContext,
                    this._accountId,
                );
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
            case "/send-inbox-realtime-event-transaction": {
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
            default:
                throw new NotFoundError("Unexpected path");
        }
    }

    public connectForTest(context: WorkerSessionActionContext) {
        return this._webSocketServer.connectForTest(context);
    }
}

const MyAccountDurableObjectWrapper = createDurableObject(MyAccountDurableObject);
export {MyAccountDurableObjectWrapper as MyAccountDurableObject};

class MyAccountDurableObjectAuthorizer {
    private readonly _systemActorCache = new Map<
        `${SpaceId}:${AccountId}`,
        {cacheTime: Date; promise: Promise<void>}
    >();

    async authorizeMyAccountAccess(context: WorkerActionContext, accountId: AccountId) {
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
                const currentTime = new Date();
                const spaceId = context.actor.getSpaceId();
                const cacheKey = `${spaceId}:${accountId}` as const;
                let cacheValue = this._systemActorCache.get(cacheKey);

                // Only call the `getAccount()` RPC every 30min. If we find the account exists
                // in the space once, it is likely to continue to exist in the space for a long
                // time. (If not forever.)
                if (cacheValue && differenceInMinutes(currentTime, cacheValue.cacheTime) < 30) {
                    await cacheValue.promise;
                } else {
                    cacheValue = {
                        cacheTime: currentTime,
                        promise: (async () => {
                            try {
                                await getAccount(context, {spaceId, accountId});
                            } catch (error) {
                                if (error instanceof NotFoundError) {
                                    throw PermissionDeniedError.from(error);
                                }
                                throw error;
                            }
                        })(),
                    };
                    this._systemActorCache.set(cacheKey, cacheValue);
                    await cacheValue.promise;
                }
                break;
            }
            default:
                throw exhaustive(context.actor);
        }
    }
}
