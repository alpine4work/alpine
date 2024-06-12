/**
 * The JSON payload of a notification. Type is derived from Apple's
 * “[Generating a remove notification][1]” documentation.
 *
 * [1]: https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
 */
export type ApnsAlertNotification = {
    readonly aps: {
        readonly alert:
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
