import {SQSClient, SendMessageCommand} from "@aws-sdk/client-sqs";
import {AppSystemActionContext} from "~/server/dynamo/context/app_action_context.js";
import {AppActorContextModule} from "~/server/dynamo/context/app_actor_context_module.js";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module.js";
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
import {DataLossError} from "~/shared/error/error.js";
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
    private readonly _edgeServiceUrl: string;
    private readonly _tokenAgent: TokenAgentBase;
    private readonly _awsSqsClient: SQSClient;
    private readonly _awsQueueUrl: string;

    constructor({
        edgeServiceUrl,
        tokenAgent,
        awsSqsClient,
        awsQueueUrl,
    }: {
        edgeServiceUrl: string;
        tokenAgent: TokenAgentBase;
        awsSqsClient: SQSClient;
        awsQueueUrl: string;
    }) {
        super();
        this._edgeServiceUrl = edgeServiceUrl;
        this._tokenAgent = tokenAgent;
        this._awsSqsClient = awsSqsClient;
        this._awsQueueUrl = awsQueueUrl;
    }

    public override sendNotificationEvent(event: NotificationEvent) {
        this._context.process.waitUntil(
            this._context.tracer.withSpan("Send notification event", async (context, span) => {
                const lastPathSegmentIndex = this._awsQueueUrl.lastIndexOf("/");
                const queueName =
                    lastPathSegmentIndex !== -1
                        ? this._awsQueueUrl.slice(lastPathSegmentIndex + 1)
                        : undefined;

                span.addData({
                    notifications: {
                        eventType: event.type,
                        eventId: event.id,
                    },
                    aws: {
                        sqs: {
                            queue: queueName,
                        },
                    },
                });

                try {
                    const output = await this._awsSqsClient.send(
                        new SendMessageCommand({
                            QueueUrl: this._awsQueueUrl,
                            MessageBody: JSON.stringify(
                                NotificationsQueueMessageSchema.serialize({
                                    event,
                                    tracerContext: span.getPropagationContext(),
                                }),
                            ),
                        }),
                    );

                    span.addData({
                        aws: {
                            sqs: {
                                messageId: output.MessageId,
                            },
                        },
                    });
                } catch (error) {
                    // Escalate any failed message delivery errors to data loss errors since it
                    // means we won't see notifications for this event.
                    throw DataLossError.from(error);
                }
            }),
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

                    // We're allowed to broadcast realtime events to `MyAccountService` if we are
                    // system actor with space access.
                    this._context.actor.authorizeSystem();
                    await authorizeSpaceAccess(this._context, spaceId);

                    const token = await this._tokenAgent.dangerouslySignShortLivedToken(
                        "MyAccountService",
                        {type: "System", spaceId},
                    );

                    await fetchWithTracer(
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
