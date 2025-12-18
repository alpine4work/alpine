import webPush, {WebPushError} from "web-push";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/server/helpers/node/is_test_node_env_or_admin_scenarios_script.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {
    InternalError,
    ResourceExhaustedError,
    UnavailableError,
    UnknownError,
} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    SendWebPushNotificationOptions,
    WebPushNotificationContent,
} from "~/shared/notifications/web_push_notification_content.js";
import {WebPushSubscription} from "~/shared/notifications/web_push_subscription.js";

export abstract class WebPushContextModuleBase extends ContextModuleBase<ServerActionContextModules> {
    public abstract sendNotificationToBrowser(
        subscription: WebPushSubscription,
        notificationContent: WebPushNotificationContent,
        options?: SendWebPushNotificationOptions,
    ): Promise<webPush.SendResult>;
}
export class WebPushContextModule extends WebPushContextModuleBase {
    private readonly _webPush: typeof webPush;

    constructor({
        vapidPublicKey,
        vapidPrivateKey,
    }: {
        vapidPublicKey: string;
        vapidPrivateKey: string;
    }) {
        super();
        this._webPush = webPush;

        this._webPush.setVapidDetails(
            "mailto:systems-alerts@alpine.inc",
            vapidPublicKey,
            vapidPrivateKey,
        );
    }

    public async sendNotificationToBrowser(
        subscription: WebPushSubscription,
        notificationContent: WebPushNotificationContent,
        options?: SendWebPushNotificationOptions,
    ) {
        return this._context.tracer.withSpan(
            "Send web push request to browser push service",
            async (_context, span) => {
                const payload = JSON.stringify(notificationContent);

                try {
                    const result = await this._webPush.sendNotification(
                        subscription,
                        payload,
                        {...options, TTL: 60 * 60 * 24 * 7}, // 7 days
                    );
                    span.addData({webPush: {responseStatusCode: result.statusCode}});
                    return result;
                } catch (error) {
                    if (error instanceof WebPushError) {
                        span.addData({webPush: {responseStatusCode: error.statusCode}});
                        // 429 indicates that the subscription endpoint was rate limited.
                        if (error.statusCode === 429) {
                            throw ResourceExhaustedError.from(
                                error,
                                "Web push subscription endpoint was rate limited",
                            );
                            // These errors indicate that the subscription is no longer valid and never will be valid again.
                            // 410 indicates expiry, 404 indicates it doesn't exist anymore, and 403 indicates the auth is no longer valid.
                        } else if (
                            error.statusCode === 410 ||
                            error.statusCode === 404 ||
                            error.statusCode === 403
                        ) {
                            throw InternalError.from(
                                error,
                                "Web push subscription is no longer valid",
                            );

                            // 500-599 indicates that the push service is having an internal error.
                            // The subscription could still be valid, and we can retry.
                        } else if (error.statusCode >= 500 && error.statusCode <= 599) {
                            throw UnavailableError.from(
                                error,
                                "Error sending push notification to push service",
                            );
                        } else {
                            throw UnknownError.from(
                                error,
                                "Unknown error sending web push notification",
                            );
                        }
                    }
                    throw error;
                }
            },
        );
    }
}

export class TestWebPushContextModule extends WebPushContextModuleBase {
    constructor() {
        super();
        assert(isTestNodeEnvOrAdminScenariosScript);
    }

    public override async sendNotificationToBrowser() {
        return Promise.resolve({
            statusCode: 200,
            body: "",
            headers: {},
        } as webPush.SendResult);
    }
}
