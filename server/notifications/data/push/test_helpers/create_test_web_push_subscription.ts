import {WebPushSubscription} from "~/shared/notifications/web_push_subscription.js";

export function createTestWebPushSubscription(endpoint: string): WebPushSubscription {
    return {
        endpoint,
        expirationTime: null,
        keys: {
            p256dh: "test-p256dh-key",
            auth: "test-auth-key",
        },
    };
}
