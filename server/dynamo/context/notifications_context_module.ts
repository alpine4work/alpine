import {SignJWT} from "jose";
import {SystemActionContext} from "~/server/dynamo/context/action_context";
import {
    NotificationEvent,
    NotificationEventSchema,
    processNotificationEvent,
} from "~/server/dynamo/notifications_table";
import {Queue} from "~/server/helpers/types/cloudflare_queues";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {
    DynamoGeneralRealtimeEvent,
    createDynamoGeneralRealtimeEventSchema,
} from "~/shared/dynamo/dynamo_general_realtime_types";
import {InternalError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {isId} from "~/shared/id/id";
import {AccountId, SpaceId} from "~/shared/id/types/id_types";
import {InboxItemModelSchema} from "~/shared/notifications/inbox_model";
import {Schema, SchemaType} from "~/shared/schema/schema";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer";
import {TracerPropagationContextSchema} from "~/shared/tracer/tracer_propagation_context_schema";

export const NotificationsQueueMessageSchema = Schema.object({
    event: NotificationEventSchema,
    tracerContext: TracerPropagationContextSchema,
});

export const MyAccountInboxRealtimeEventTransactionSchema = Schema.object({
    readTime: Schema.date,
    eventTransaction: Schema.array(createDynamoGeneralRealtimeEventSchema(InboxItemModelSchema)),
});

/**
 * Context module available on contexts that can add to our notification
 * event queue.
 */
export abstract class NotificationsContextModuleBase extends ContextModuleBase<{
    process: ProcessContextModule;
    tracer: TracerContextModule;
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
    private readonly _notificationQueue: Queue;
    private readonly _myAccountDurableObjectNamespace: DurableObjectNamespace;
    private readonly _sessionCookieSecret: string;

    constructor(env: {
        NotificationsQueue: Queue;
        MyAccountDurableObjectNamespace: DurableObjectNamespace;
        SESSION_COOKIE_SECRET?: string;
    }) {
        super();
        this._notificationQueue = env.NotificationsQueue;
        this._myAccountDurableObjectNamespace = env.MyAccountDurableObjectNamespace;

        const sessionCookieSecret = env.SESSION_COOKIE_SECRET;
        if (!sessionCookieSecret)
            throw new InternalError("Missing `SESSION_COOKIE_SECRET` environment variable");

        this._sessionCookieSecret = sessionCookieSecret;
    }

    public override sendNotificationEvent(event: NotificationEvent) {
        this._context.process.waitUntil(
            this._context.tracer.withSpan("Send notification event", (context, span) => {
                span.addData({
                    notifications: {
                        eventType: event.type,
                        eventId: event.id,
                    },
                });

                return this._notificationQueue.send(
                    NotificationsQueueMessageSchema.serialize({
                        event,
                        tracerContext: span.getPropagationContext(),
                    }),
                );
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

                    const durableObjectId =
                        this._myAccountDurableObjectNamespace.idFromName(accountId);
                    const durableObjectStub =
                        this._myAccountDurableObjectNamespace.get(durableObjectId);

                    // Create a short-lived JWT for authenticating as a system actor when
                    // executing the durable object.
                    //
                    // We use a JWT to ensure that it's our app worker sending the token. If
                    // an attacker got access to the Durable Object URL then they could use
                    // `type: "System"` with any arbitrary `SpaceId`! Using a signed JWT
                    // prevents that.
                    const authenticationToken = await new SignJWT({
                        type: "System",
                        spaceId,
                    })
                        .setProtectedHeader({alg: "HS256"})
                        .setIssuedAt()
                        .setExpirationTime("2m")
                        .sign(new TextEncoder().encode(this._sessionCookieSecret));

                    await fetchWithTracer(
                        this._context.tracer.getTracer(),
                        "/inbox-realtime-event-transaction",
                        {
                            fetch: (url, requestInit) =>
                                durableObjectStub.fetch(
                                    (typeof url === "string"
                                        ? // NOTE(calebmer): Dummy domain owned by Cloudflare. We seem to get an error
                                          // when just passing in a path? Maybe this is a Miniflare only bug.
                                          new URL(url, "https://workers.dev")
                                        : url) as any,
                                    requestInit,
                                ),
                            method: "POST",
                            headers: {
                                authorization: `bearer ${authenticationToken}`,
                                "cyberworlds-id-name": accountId,
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
    private readonly _createSystemContext: (spaceId: SpaceId) => SystemActionContext;

    constructor(createSystemContext: (spaceId: SpaceId) => SystemActionContext) {
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
