// Result group from webhook template using {{ toJson .Result.GroupsTriggered }}
// See: https://docs.honeycomb.io/notify/webhooks/variables/
type HoneycombResultGroupColumn = {
    /**
     * Column name used for grouping results.
     */
    key: string;

    /**
     * Value of the grouping column for this result group.
     */
    value: string;
};

export type HoneycombResultGroup = {
    /**
     * Grouping columns that identified this triggered result group.
     */
    group: Array<HoneycombResultGroupColumn>;

    /**
     * Query result value for this specific triggered group.
     */
    result: number;
};

export type HoneycombEventPayload = {
    /**
     * Custom recipient field naming the Alpine channel to receive the alert.
     */
    channel: string;

    /**
     * Custom recipient field used as the header emoji for event-style alerts.
     */
    emoji?: string;

    /**
     * Custom recipient field listing result group columns to display.
     */
    displayFields?: string;

    /**
     * Triggered groups from `{{ toJson .Result.GroupsTriggered }}`.
     */
    groupsTriggered?: Array<HoneycombResultGroup>;

    /**
     * Trigger name.
     */
    name: string;

    /**
     * Custom recipient field indicating the alert should be treated as an "event".
     * Event alerts are one-time notifications; `OK` event payloads are ignored by the
     * source.
     */
    isEvent?: string;

    /**
     * Trigger identifier.
     */
    id: string;

    /**
     * Trigger description.
     */
    description: string;

    /**
     * Environment where the trigger evaluated.
     */
    environment: string;

    /**
     * Links Honeycomb exposes for the trigger and the specific result.
     */
    links: {
        /**
         * Direct link to the trigger configuration.
         */
        trigger: string;

        /**
         * Direct link to the query result that caused the alert.
         */
        result: string;
    };

    /**
     * Trigger threshold configuration.
     */
    threshold: {
        /**
         * Threshold comparison operator.
         */
        op: string;

        /**
         * Threshold comparison value.
         */
        value: string | number;
    };

    /**
     * Query result metadata.
     */
    result: {
        /**
         * Raw groups that met or exceeded the trigger threshold.
         */
        groupsTriggered: Array<unknown>;
    };

    /**
     * Alert firing metadata.
     */
    alert: {
        /**
         * Unique identifier for this trigger firing.
         */
        instanceId: string;

        /**
         * Short summary of the alert.
         */
        description: string;

        /**
         * Trigger status, such as `TRIGGERED` or `OK`.
         */
        status: string;

        /**
         * Notification-ready alert summary.
         */
        summary: string;

        /**
         * Whether this firing came from Honeycomb's test-alert flow.
         */
        isTest: boolean;
    };
};
