import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {WebPushContextModuleBase} from "~/server/context/web_push_context_module.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {AccountId, BrowserId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    SendWebPushNotificationOptions,
    WebPushNotificationContent,
} from "~/shared/notifications/web_push_notification_content.js";
import {WebPushSubscription} from "~/shared/notifications/web_push_subscription.js";

const maxWebPushPayloadSizeKb = 4;

// Web push services do not allow payloads larger than 4KB.
// It's unlikely we'll hit this limit, but we'll validate just in case.
function validateWebPushPayload(payload: string) {
    const encoder = new TextEncoder();
    const sizeInKB = encoder.encode(JSON.stringify(payload)).length / 1024;
    assert(sizeInKB <= maxWebPushPayloadSizeKb, "Web push payload must be less than 4KB");
}

function validateWebPushOptions(options?: SendWebPushNotificationOptions) {
    if (options?.topic) {
        assert(options.topic.length <= 32, "Topic must be 32 characters or less");
    }
}

export async function sendWebPushNotificationToAllSubscriptions(
    context: Context<ServerActionContextModules & {webPush: WebPushContextModuleBase}>,
    {
        spaceId,
        accountId,
        subscriptions,
        notificationContent,
        options,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        subscriptions: Array<{browserId: BrowserId; subscription: WebPushSubscription}>;
        notificationContent: WebPushNotificationContent;
        options?: SendWebPushNotificationOptions;
    },
): Promise<void> {
    validateWebPushPayload(notificationContent.body);
    validateWebPushOptions(options);

    await runAllPromises(
        subscriptions.map(({browserId}) =>
            context.jobs.sendAndWait({
                type: "SendWebPushNotification",
                spaceId,
                accountId,
                browserId,
                notificationContent,
                options,
            }),
        ),
    );
}
