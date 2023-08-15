import {NotificationEvent} from "~/server/notifications/core/notification_event.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";

/**
 * Context module available on contexts that can add to our notification
 * event queue.
 */
export interface NotificationsContextModuleBase extends ContextModuleBase {
    /**
     * Send a notification event to be processed asynchronously by our notification
     * queue. Our notification queue guarantees at-least-once delivery and does
     * not block request processing.
     */
    sendNotificationEvent(event: NotificationEvent): void;

    /**
     * Sends an event transaction from the inbox DynamoDB table to "my account"
     * durable objects which users connect to for seeing realtime changes to their
     * notification count.
     */
    sendInboxRealtimeEventTransaction(
        readTime: Date,
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>,
    ): Promise<void>;
}
