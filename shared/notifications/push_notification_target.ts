import {BrowserId} from "~/shared/id/types/id_types.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {WebPushSubscription} from "~/shared/notifications/web_push_subscription.js";

export type AppleDeviceTarget = {
    readonly type: "AppleDevice";
    readonly deviceToken: Uint8Array;
};

export type WebPushSubscriptionTarget = {
    readonly type: "WebPushSubscription";
    readonly browserId: BrowserId;
    readonly subscription: WebPushSubscription;
    readonly optedOutSpaceIds: ReadonlySet<SpaceId>;
};

export type SlackIntegrationTarget = {
    readonly type: "SlackIntegration";
    readonly spaceId: SpaceId;
    readonly slackUserId: string;
    readonly workspaceId: string;
};

export type PushNotificationTarget =
    | SlackIntegrationTarget
    | WebPushSubscriptionTarget
    | AppleDeviceTarget;
