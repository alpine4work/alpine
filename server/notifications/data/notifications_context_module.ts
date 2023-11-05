import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {
    NotificationEvent,
    NotificationEventSchema,
} from "~/server/notifications/core/notification_event.js";
import {NotificationsContextModuleBase as NotificationsContextModuleBaseInterface} from "~/server/notifications/core/notifications_context_module_base.js";
import {processNotificationEvent} from "~/server/notifications/data/notifications_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {TokenAgentBase} from "~/server/tokens/token_agent.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DataLossError, InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {InboxItemModelSchema} from "~/shared/notifications/inbox_model.js";
import {MyAccountSendInboxRealtimeEventTransactionSchema} from "~/shared/notifications/my_account_inbox_realtime_event_transaction_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";
import {TracerPropagationContextSchema} from "~/shared/tracer/tracer_propagation_context_schema.js";

export const NotificationsQueueMessageSchema = Schema.object({
    event: NotificationEventSchema,
    tracerContext: TracerPropagationContextSchema,
});

/**
 * Context module available on contexts that can add to our notification
 * event queue.
 */
abstract class NotificationsContextModuleBase
    extends ContextModuleBase<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        dynamo: DynamoContextModule;
        cache: CacheContextModule;
        actor: DynamoActorContextModule;
    }>
    implements NotificationsContextModuleBaseInterface
{
    protected readonly _dangerouslyEscalateToSystemContext: <Value>(
        context: Context<{
            tracer: TracerContextModule;
            actor: DynamoActorContextModule;
            cache: CacheContextModule;
        }>,
        spaceId: SpaceId,
        action: (
            context: Context<
                ServerSystemActionContextModules & {
                    notifications: NotificationsContextModuleBaseInterface;
                }
            >,
        ) => Promise<Value>,
    ) => Promise<Value>;

    constructor({
        dangerouslyEscalateToSystemContext,
    }: {
        dangerouslyEscalateToSystemContext: <Value>(
            context: Context<{
                tracer: TracerContextModule;
                actor: DynamoActorContextModule;
                cache: CacheContextModule;
            }>,
            spaceId: SpaceId,
            action: (
                context: Context<
                    ServerSystemActionContextModules & {
                        notifications: NotificationsContextModuleBaseInterface;
                    }
                >,
            ) => Promise<Value>,
        ) => Promise<Value>;
    }) {
        super();
        this._dangerouslyEscalateToSystemContext = dangerouslyEscalateToSystemContext;
    }

    /**
     * Send a notification event to be processed asynchronously by our notification
     * queue. Our notification queue guarantees at-least-once delivery and does
     * not block request processing.
     */
    public sendNotificationEvent(event: NotificationEvent) {
        // Don't block the current action on sending out a notification event. Send it
        // asynchronously.
        //
        // We create a new system action context from our process context to make sure
        // our notification event processing is isolated from the original action.
        // Since processing a notification event is acting on behalf of many users, we
        // need broader permissions than the currently authenticated user.
        //
        // There is no means of error recovery at the moment. It is essential
        // notification events are processed and it's essential they are processed
        // fast. If our Node.js process crashes while we are handling a notification
        // event we will lose the notification! Processing notifications in a queue
        // like AWS SQS would help with this but might hurt latency.
        //
        // We'll wait to have problems with notification delivery and decide on the
        // best solution then.
        //
        // NOTE(calebmer, 2023-07-07): When this code was running on Cloudflare Workers
        // we were processing notification events in Cloudflare Queues. That's because
        // at the time I thought `executionContext.waitUntil()` had a ~30s execution
        // time limit. But re-reading [the documentation][1] I might have been mistaken
        // and `executionContext.waitUntil()` is, in fact, unbounded. That's part of
        // the reason the code was structured this way. We effectively had a separate
        // `AppQueue` service that constructed its own context. Leaving the
        // construction of a system context in since the permission escalation is still
        // necessary and it will help us migrate notification processing to a separate
        // service someday if we need.
        //
        // [1]: https://developers.cloudflare.com/workers/platform/limits/#cpu-runtime
        this._context.process.waitUntil(
            this._dangerouslyEscalateToSystemContext(
                this._context,
                event.spaceId,
                async context => {
                    try {
                        await processNotificationEvent(context, event);
                    } catch (error) {
                        // Escalate notification processing errors to `DataLossError` since it means we
                        // failed to deliver a notification but the user doesn't know.
                        //
                        // It would be very bad for the process to shutdown midway through indexing
                        // such that we don't see this error! We need some backup monitoring/retry method.
                        throw DataLossError.from(error);
                    }
                },
            ),
        );
    }

    /**
     * Sends an event transaction from the inbox DynamoDB table to "my account"
     * durable objects which users connect to for seeing realtime changes to their
     * notification count.
     */
    public abstract sendInboxRealtimeEventTransaction(
        readTime: Date,
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>,
    ): Promise<void>;

    public abstract fork(): NotificationsContextModuleBase;
}

export class NotificationsContextModule extends NotificationsContextModuleBase {
    private readonly _edgeServiceUrl: string;
    private readonly _tokenAgent: TokenAgentBase;

    constructor({
        dangerouslyEscalateToSystemContext,
        edgeServiceUrl,
        tokenAgent,
    }: {
        dangerouslyEscalateToSystemContext: <Value>(
            context: Context<{
                tracer: TracerContextModule;
                actor: DynamoActorContextModule;
                cache: CacheContextModule;
            }>,
            spaceId: SpaceId,
            action: (
                context: Context<
                    ServerSystemActionContextModules & {
                        notifications: NotificationsContextModuleBaseInterface;
                    }
                >,
            ) => Promise<Value>,
        ) => Promise<Value>;
        edgeServiceUrl: string;
        tokenAgent: TokenAgentBase;
    }) {
        super({dangerouslyEscalateToSystemContext});
        this._edgeServiceUrl = edgeServiceUrl;
        this._tokenAgent = tokenAgent;
    }

    public override async sendInboxRealtimeEventTransaction(
        readTime: Date,
        eventTransaction: ReadonlyArray<
            DynamoGeneralRealtimeEvent<SchemaType<typeof InboxItemModelSchema>>
        >,
    ) {
        // Split up event transactions by unique `SpaceId` and `AccountId`
        // combinations. By splitting a transaction it may not be applied atomically.
        // We split by `AccountId` since events need to go to different durable
        // objects.
        //
        // Having a transaction across two accounts or two spaces isn't theoretically
        // impossible but would be weird and doesn't currently happen in practice.
        const eventTransactionBySpaceIdAndAccountId = new Map<
            `${SpaceId}:${AccountId}`,
            Array<DynamoGeneralRealtimeEvent<SchemaType<typeof InboxItemModelSchema>>>
        >();

        for (const event of eventTransaction) {
            getOrSetDefaultMapValue(
                eventTransactionBySpaceIdAndAccountId,
                `${event.item.model.spaceId}:${event.item.model.accountId}`,
                () => [],
            ).push(event);
        }

        await runAllPromises(
            Array.from(
                eventTransactionBySpaceIdAndAccountId,
                async ([spaceIdAndAccountId, eventTransaction]) => {
                    const [spaceId, accountId] = spaceIdAndAccountId.split(":");
                    assert(spaceId && isId<SpaceId>(spaceId));
                    assert(accountId && isId<AccountId>(accountId));

                    // Double check that we're allowed to escalate to system privileges.
                    await authorizeSpaceAccess(this._context, spaceId);

                    const token = await this._tokenAgent.dangerouslySignShortLivedToken(
                        "MyAccountService",
                        {type: "System", spaceId},
                    );

                    const response = await fetchWithTracer(
                        this._context.tracer.getTracer(),
                        new URL(
                            `/api/durable-objects/my-account/${accountId}/send-inbox-realtime-event-transaction`,
                            this._edgeServiceUrl,
                        ),
                        {
                            spanRoute:
                                "/api/durable-objects/my-account/:accountId/send-inbox-realtime-event-transaction",
                            method: "POST",
                            headers: {
                                authorization: `bearer ${token}`,
                                "content-type": "application/json",
                                // If the durable object is not initialized this request will fail with a 412.
                                // If there are no realtime subscribers on the durable object, we don't need to
                                // send our event transaction. We can drop this request on the floor.
                                "cyberworlds-durable-object-if-initialized": "true",
                            },
                            body: JSON.stringify(
                                MyAccountSendInboxRealtimeEventTransactionSchema.serialize({
                                    readTime,
                                    eventTransaction,
                                }),
                            ),
                        },
                    );

                    if (response.status !== 200 && response.status !== 412) {
                        throw new InternalError(
                            "Failed to broadcast inbox realtime events from `MyAccountService`",
                        );
                    }
                },
            ),
        );
    }

    public fork() {
        return new NotificationsContextModule({
            dangerouslyEscalateToSystemContext: this._dangerouslyEscalateToSystemContext,
            edgeServiceUrl: this._edgeServiceUrl,
            tokenAgent: this._tokenAgent,
        });
    }
}

export class TestNotificationsContextModule extends NotificationsContextModuleBase {
    constructor({
        dangerouslyEscalateToSystemContext,
    }: {
        dangerouslyEscalateToSystemContext: <Value>(
            context: Context<{
                tracer: TracerContextModule;
                actor: DynamoActorContextModule;
                cache: CacheContextModule;
            }>,
            spaceId: SpaceId,
            action: (
                context: Context<
                    ServerSystemActionContextModules & {
                        notifications: NotificationsContextModuleBaseInterface;
                    }
                >,
            ) => Promise<Value>,
        ) => Promise<Value>;
    }) {
        // Can only use this context module in tests.
        assert(process.env.NODE_ENV === "test");

        super({dangerouslyEscalateToSystemContext});
    }

    public override async sendInboxRealtimeEventTransaction() {
        // Ignore realtime events in tests...
    }

    public fork() {
        return new TestNotificationsContextModule({
            dangerouslyEscalateToSystemContext: this._dangerouslyEscalateToSystemContext,
        });
    }
}
