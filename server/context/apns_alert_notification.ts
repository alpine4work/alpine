import {Id} from "~/shared/id/id.open_source.js";

/**
 * The JSON payload of a notification. Type is derived from Apple's "[Generating a
 * remove notification][1]" documentation.
 *
 * [1]:
 *     https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
 */
export type ApnsAlertNotification = {
    /**
     * Custom Alpine property that specifies the URL path for this entry. If the user
     * taps on a notification then we'll navigate to their inbox and open this URL.
     */
    readonly entry?: string;

    readonly aps: {
        readonly alert?:
            | string
            | {
                  readonly title?: string;
                  readonly subtitle?: string;
                  readonly body?: string;
                  readonly "launch-image"?: string;
              };
        readonly badge?: number;
        readonly sound?:
            | string
            | {
                  readonly critical?: number;
                  readonly name?: string;
                  readonly volume?: number;
              };
        readonly "thread-id"?: string;
        readonly category?: string;
        readonly "content-available"?: number;
        readonly "mutable-content"?: number;
        readonly "target-content-id"?: string;
        readonly "interruption-level"?: string;
        readonly "relevance-score"?: number;
        readonly "filter-criteria"?: string;
    };
};

/**
 * Other system options that aren't part of the notification body. All optional and
 * they typically have defaults.
 *
 * For more information on these options see "[Sending notification requests to
 * APNs][1]."
 *
 * [1]:
 *     https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
 */
export type ApnsAlertNotificationOptions = {
    /**
     * Identifies the notification. Will be converted into UUID. The APNs console will
     * report any notification errors with the UUID format of this string.
     *
     * Corresponds to the `apns-id` header when communicating with APNs over HTTP/2.
     */
    id?: Id;

    /**
     * The date at which the notification is no longer valid.
     *
     * If an expiration time is set to null then APNs attempts to deliver the
     * notification only once and doesn't store it. Otherwise, APNs will store the
     * notification and try to send it until the expiration time is reached.
     *
     * Defaults to 28 days after the current time. 30 days is the max according to
     * Apple's documentation.
     *
     * Corresponds to the `apns-expiration` header when communicating with APNs over
     * HTTP/2.
     */
    expirationTime?: Date | null;

    /**
     * The priority of the notification. Defaults to 10.
     *
     * - Specify 10 to send the notification immediately.
     * - Specify 5 to send the notification based on power considerations on the user's
     *   device.
     * - Specify 1 to prioritize the device's power considerations over all other
     *   factors for delivery, and prevent awakening the device.
     *
     * Corresponds to the `apns-priority` header when communicating with APNs over
     * HTTP/2.
     */
    priority?: 1 | 5 | 10;

    /**
     * An identifier you use to merge multiple notifications into a single notification
     * for the user. Typically, each notification request displays a new notification
     * on the user's device. When sending the same notification more than once, use the
     * same value in this header to merge the requests. The value of this key must not
     * exceed 64 bytes.
     *
     * Corresponds to the `apns-collapse-id` header when communicating with APNs over
     * HTTP/2.
     */
    collapseId?: string;
};
