import {ApnsConnectionPool} from "~/server/apns/apns_connection_pool.js";
import {
    ApnsAlertNotification,
    ApnsAlertNotificationOptions,
} from "~/server/context/apns_alert_notification.js";
import {ApnsContextModuleBase} from "~/server/context/apns_context_module_base.js";

export class ApnsContextModule extends ApnsContextModuleBase {
    private readonly _connectionPool: ApnsConnectionPool;

    constructor(connectionPool: ApnsConnectionPool) {
        super();
        this._connectionPool = connectionPool;
    }

    /**
     * Send a push notification to the provided Apple device token.
     *
     * For more information on supported properties on a notification object
     * see "[Generating a remove notification][1]".
     *
     * [1]: https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
     */
    public sendAlert(
        deviceToken: Uint8Array,
        notification: ApnsAlertNotification,
        options?: ApnsAlertNotificationOptions,
    ) {
        return this._connectionPool.sendAlert(this._context, deviceToken, notification, options);
    }

    /**
     * Provides a `sendAlert()` function to the action that does the same thing as
     * our class's `sendAlert()` function. If we don't have an APNs connection yet
     * then we'll connect in parallel with the action so if the action starts with
     * any data loading we can connect to APNs in parallel with that.
     *
     * For the duration of the action we will use the same APNs connection.
     *
     * Use this function as an optimization when you want to connect to APNs in
     * parallel with some other work.
     */
    public withSendAlert<Value>(
        action: (
            sendAlert: (
                deviceToken: Uint8Array,
                notification: ApnsAlertNotification,
                options?: ApnsAlertNotificationOptions,
            ) => Promise<{wasDeviceTokenUnregistered: boolean}>,
        ) => Promise<Value>,
    ): Promise<Value> {
        return this._connectionPool.withSendAlert(this._context, action);
    }
}
