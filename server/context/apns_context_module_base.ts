import {
    ApnsAlertNotification,
    ApnsAlertNotificationOptions,
} from "~/server/context/apns_alert_notification.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/server/helpers/node/is_test_node_env_or_admin_scenarios_script.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {assert} from "~/shared/helpers/control/assert.js";

export abstract class ApnsContextModuleBase extends ContextModuleBase<ServerActionContextModules> {
    /**
     * Send a push notification to the provided Apple device token.
     *
     * For more information on supported properties on a notification object
     * see “[Generating a remove notification][1]”.
     *
     * If this function returns `wasDeviceTokenUnregistered` then you should delete
     * the provided device token from the database to avoid sending notifications
     * to it again.
     *
     * [1]: https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
     */
    public abstract sendAlert(
        deviceToken: Uint8Array,
        notification: ApnsAlertNotification,
        options?: ApnsAlertNotificationOptions,
    ): Promise<{wasDeviceTokenUnregistered: boolean}>;

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
     *
     * If the `sendAlert()` function returns `wasDeviceTokenUnregistered` then you
     * should delete the provided device token from the database to avoid sending
     * notifications to it again.
     */
    public abstract withSendAlert<Value>(
        action: (
            sendAlert: (
                deviceToken: Uint8Array,
                notification: ApnsAlertNotification,
                options?: ApnsAlertNotificationOptions,
            ) => Promise<{wasDeviceTokenUnregistered: boolean}>,
        ) => Promise<Value>,
    ): Promise<Value>;
}

export class TestApnsContextModule extends ApnsContextModuleBase {
    constructor() {
        super();
        assert(isTestNodeEnvOrAdminScenariosScript);
    }

    public async sendAlert() {
        // Noop in tests...
        return {wasDeviceTokenUnregistered: false};
    }

    public withSendAlert<Value>(
        action: (sendAlert: () => Promise<{wasDeviceTokenUnregistered: boolean}>) => Promise<Value>,
    ): Promise<Value> {
        return action((...args) => this.sendAlert(...args));
    }
}
