import {
    AppSystemActionContext,
    AppSystemActionContextModules,
} from "~/server/dynamo/context/app_action_context.js";
import {
    AppActorContextModule,
    AppSystemActorContextModule,
} from "~/server/dynamo/context/app_actor_context_module.js";
import {
    AppProcessContext,
    AppProcessContextModules,
} from "~/server/dynamo/context/app_process_context.js";
import {
    DynamoBatchContextModule,
    DynamoContextModule,
} from "~/server/dynamo/dynamo_context_module.js";
import {
    NotificationEvent,
    NotificationEventSchema,
    processNotificationEvent,
} from "~/server/dynamo/notifications_table.js";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table.js";
import {TokenAgentBase} from "~/server/tokens/token_agent.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
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
import {MyAccountInboxRealtimeEventTransactionSchema} from "~/shared/notifications/my_account_inbox_realtime_event_transaction_schema.js";
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
export abstract class NotificationsContextModuleBase extends ContextModuleBase<{
    process: ProcessContextModule;
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    cache: CacheContextModule;
    actor: AppActorContextModule;
}> {
    /**
     * Send a notification event to be processed asynchronously by our notification
     * queue. Our notification queue guarantees at-least-once delivery and does
     * not block request processing.
     */
    public abstract sendNotificationEvent(event: NotificationEvent): void;

    /**
     * Sends an event transaction from the inbox DynamoDB table to "my account"
     * durable objects which users connect to for seeing realtime changes to their
     * notification count.
     */
    public abstract sendInboxRealtimeEventTransaction(
        readTime: Date,
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>,
    ): Promise<void>;
}

export class NotificationsContextModule extends NotificationsContextModuleBase {
    private readonly _processContext: AppProcessContext;
    private readonly _edgeServiceUrl: string;
    private readonly _tokenAgent: TokenAgentBase;

    constructor({
        processContext,
        edgeServiceUrl,
        tokenAgent,
    }: {
        processContext: AppProcessContext;
        edgeServiceUrl: string;
        tokenAgent: TokenAgentBase;
    }) {
        super();
        this._processContext = processContext;
        this._edgeServiceUrl = edgeServiceUrl;
        this._tokenAgent = tokenAgent;
    }

    public override sendNotificationEvent(event: NotificationEvent) {
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
            this._processContext.with<
                Omit<
                    AppSystemActionContextModules,
                    Exclude<keyof AppProcessContextModules, "tracer">
                >,
                // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
                void
            >(
                {
                    tracer: new TracerContextModule(this._context.tracer.getTracer()),
                    cache: new CacheContextModule(),
                    dynamoBatchContext: new DynamoBatchContextModule(),
                    notifications: new NotificationsContextModule({
                        processContext: this._processContext,
                        edgeServiceUrl: this._edgeServiceUrl,
                        tokenAgent: this._tokenAgent,
                    }),
                    actor: AppSystemActorContextModule.dangerouslyNew(
                        this._context.actor.serviceName,
                        event.spaceId,
                    ),
                },
                async context => {
                    try {
                        await processNotificationEvent(context, event);
                    } catch (error) {
                        // Escalate notification processing errors to `DataLossError` since it means we
                        // failed to deliver a notification but the user doesn't know.
                        throw DataLossError.from(error);
                    }
                },
            ),
        );
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
                            `/api/durable-objects/my-account/${accountId}/inbox-realtime-event-transaction`,
                            this._edgeServiceUrl,
                        ),
                        {
                            method: "POST",
                            headers: {
                                authorization: `bearer ${token}`,
                                "content-type": "application/json",
                            },
                            body: JSON.stringify(
                                MyAccountInboxRealtimeEventTransactionSchema.serialize({
                                    readTime,
                                    eventTransaction,
                                }),
                            ),
                        },
                    );

                    if (response.status !== 200) {
                        throw new InternalError(
                            "Failed to broadcast inbox realtime events from `MyAccountService`",
                        );
                    }
                },
            ),
        );
    }
}

export class TestNotificationsContextModule extends NotificationsContextModuleBase {
    private readonly _createSystemContext: (spaceId: SpaceId) => AppSystemActionContext;

    constructor(createSystemContext: (spaceId: SpaceId) => AppSystemActionContext) {
        // Can only use this context module in tests.
        assert(process.env.NODE_ENV === "test");

        super();
        this._createSystemContext = createSystemContext;
    }

    public override sendNotificationEvent(event: NotificationEvent) {
        // To simulate realistic conditions in tests, process the notification event
        // asynchronously outside the body of the `sendNotificationEvent()` call.
        //
        // If you want to wait for the queue events to be processed in your test you
        // may call `ProcessContextModule.waitForTestTasks()`.
        //
        // Notably we use `systemContext.process.waitUntil()` instead of
        // `this._context.process.waitUntil()`! That's because we don't want
        // notification processing to extend the lifetime of our request context.
        const systemContext = this._createSystemContext(event.spaceId);

        systemContext.process.waitUntil(processNotificationEvent(systemContext, event));

        // 1% of the time process the event twice in tests to exercise our idempotence
        // logic. We use queues with at-least-once delivery semantics which means an
        // event could be delivered twice. So we want our tests to exercise this
        // eventuality.
        if (Math.random() < 0.01) {
            systemContext.process.waitUntil(processNotificationEvent(systemContext, event));
        }
    }

    public override async sendInboxRealtimeEventTransaction() {
        // Ignore realtime events in tests...
    }
}
