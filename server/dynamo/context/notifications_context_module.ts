import {SystemActionContext} from "~/server/dynamo/context/action_context";
import {NotificationEvent, processNotificationEvent} from "~/server/dynamo/notifications_table";
import {Queue} from "~/server/helpers/types/cloudflare_queues";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types";
import {assert} from "~/shared/helpers/control/assert";
import {SpaceId} from "~/shared/id/types/id_types";

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
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>,
    ): Promise<void>;
}

export class NotificationsContextModule extends NotificationsContextModuleBase {
    private readonly _notificationQueue: Queue;
    private readonly _myAccountDurableObjectNamespace: DurableObjectNamespace;

    constructor(env: {
        NotificationsQueue: Queue;
        MyAccountDurableObjectNamespace: DurableObjectNamespace;
    }) {
        super();
        this._notificationQueue = env.NotificationsQueue;
        this._myAccountDurableObjectNamespace = env.MyAccountDurableObjectNamespace;
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

                return this._notificationQueue.send({
                    event,
                    tracerContext: span.getPropagationContext(),
                });
            }),
        );
    }

    public override async sendInboxRealtimeEventTransaction(
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>,
    ) {
        // NOCOMMIT
    }
}

export class TestNotificationsContextModule extends NotificationsContextModuleBase {
    private readonly _createSystemContext: (spaceId: SpaceId) => SystemActionContext;

    constructor(createSystemContext: (spaceId: SpaceId) => SystemActionContext) {
        // Can only use this context module in unit tests.
        assert(typeof jest !== "undefined");

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
