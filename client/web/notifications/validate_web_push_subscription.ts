import {assert} from "~/shared/helpers/control/assert.js";
import {
    WebPushSubscription,
    WebPushSubscriptionSchema,
} from "~/shared/notifications/web_push_subscription.js";

export function validateWebPushSubscription(subscription: PushSubscription): WebPushSubscription {
    const subscriptionJson = subscription.toJSON();
    assert(subscriptionJson.endpoint, "Subscription endpoint is required");
    assert(
        subscriptionJson.keys && subscriptionJson.keys.p256dh && subscriptionJson.keys.auth,
        "Subscription keys are required",
    );
    return WebPushSubscriptionSchema.deserialize({
        endpoint: subscriptionJson.endpoint,
        // NOTE(rmtobin): Safari doesn't include expiration time in toJSON for some reason,
        // so we set it to null if it's not present
        expirationTime: subscriptionJson.expirationTime ?? null,
        keys: subscriptionJson.keys,
    });
}
