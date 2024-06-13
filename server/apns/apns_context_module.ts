import {
    ApnsAlertNotification,
    ApnsAlertNotificationOptions,
} from "~/server/apns/apns_alert_notification.js";
import {ApnsConnectionPool} from "~/server/apns/apns_connection_pool.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {assert} from "~/shared/helpers/control/assert.js";

export abstract class ApnsContextModuleBase extends ContextModuleBase<ServerActionContextModules> {
    /**
     * Send a push notification to the provided Apple device token.
     *
     * For more information on supported properties on a notification object
     * see “[Generating a remove notification][1]”.
     *
     * [1]: https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
     */
    public abstract sendAlert(
        deviceToken: Uint8Array,
        notification: ApnsAlertNotification,
        options?: ApnsAlertNotificationOptions,
    ): Promise<void>;
}

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
     * see “[Generating a remove notification][1]”.
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
}

export class TestApnsContextModule extends ApnsContextModuleBase {
    constructor() {
        super();
        assert(import.meta.jest);
    }

    public async sendAlert() {
        // Noop in tests...
    }
}
