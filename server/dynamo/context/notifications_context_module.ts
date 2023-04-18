import {Queue} from "~/server/cloudflare/types/cloudflare_queues";
import {SystemContext} from "~/server/dynamo/context/system_context";
import {NotificationEvent, processNotificationEvent} from "~/server/dynamo/notifications_table";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";

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
}

export class NotificationsContextModule extends NotificationsContextModuleBase {
    private readonly _notificationQueue: Queue;

    constructor(env: {NotificationsQueue: Queue}) {
        super();
        this._notificationQueue = env.NotificationsQueue;
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
}

export class TestNotificationsContextModule extends NotificationsContextModuleBase {
    private readonly _getSystemContext: () => SystemContext;

    constructor(getSystemContext: () => SystemContext) {
        super();
        this._getSystemContext = getSystemContext;
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
        const systemContext = this._getSystemContext();
        systemContext.process.waitUntil(processNotificationEvent(systemContext, event));
    }
}
