import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {WebPushContextModuleBase} from "~/server/context/web_push_context_module.js";
import {getWebPushSubscriptionItemIfExistsWithoutAuthorization} from "~/server/notifications/data/internal/push/get_web_push_subscription_item_if_exists_without_authorization.js";
import {removeWebPushSubscriptionWithoutAuthorization} from "~/server/notifications/data/internal/push/remove_web_push_subscription_without_authorization.js";
import {authorizeNotBotSpaceAccount, authorizeSpaceAccess} from "~/server/spaces/spaces_actions.js";
import {Context} from "~/shared/context/context.js";
import {InternalError, NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId, BrowserId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    SendWebPushNotificationOptions,
    WebPushNotificationContent,
} from "~/shared/notifications/web_push_notification_content.js";

/**
 * Send a web push notification to a subscription.
 *
 * We use the browserId to get the subscription item, and throw `NotFoundError` if the subscription
 * item doesn't exist or doesn't have a subscription attribute.
 */
export async function sendWebPushNotificationToSubscription(
    context: Context<ServerActionContextModules & {webPush: WebPushContextModuleBase}>,
    {
        spaceId,
        accountId,
        browserId,
        notificationContent,
        options,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        browserId: BrowserId;
        notificationContent: WebPushNotificationContent;
        options?: SendWebPushNotificationOptions;
    },
) {
    return context.tracer.withSpan(
        "Send Web Push notification to subscription",
        async (context, span) => {
            await runAllPromises([
                authorizeSpaceAccess(context, spaceId),
                authorizeNotBotSpaceAccount(context, spaceId, accountId),
            ]);

            const subscriptionItem = await getWebPushSubscriptionItemIfExistsWithoutAuthorization(
                context,
                {
                    accountId,
                    browserId,
                },
                {consistency: "Strong"},
            );

            // If the subscription item doesn't exist or doesn't have a subscription, throw a
            // non-transient error since this is not recoverable.
            // This can happen if the user has signed out, their browserId has changed and we removed
            // this browserId entry, or the subscription was invalidated and set to null.
            if (!subscriptionItem || !subscriptionItem.subscription) {
                throw new NotFoundError("Expected `WebPushSubscription` item but none found");
            }

            span.addData({webPush: {browserId: subscriptionItem.browserId}});

            if (subscriptionItem.optedOutSpaceIds.has(spaceId)) {
                return;
            }

            try {
                await context.webPush.sendNotificationToBrowser(
                    subscriptionItem.subscription,
                    notificationContent,
                    options,
                );
            } catch (error) {
                // If the error is an internal error, our subscription is no longer valid and a retry
                // will not be successful. Deregister it so we don't try to send to it again.
                if (error instanceof InternalError) {
                    span.logException("Received non-transient error from web push service", error);
                    await removeWebPushSubscriptionWithoutAuthorization(context, {
                        accountId,
                        browserId,
                    });
                    return;
                }
                throw error;
            }
        },
    );
}
