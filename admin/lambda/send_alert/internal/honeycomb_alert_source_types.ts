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
    value: string | null;
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

export type HoneycombEventPayloadBase = {
    /**
     * Custom recipient field naming the Alpine channel to receive the alert. For task
     * payloads, this is optional and posts a preview of newly-created tasks. Use this
     * for configured channel names like `honeycomb`.
     */
    channel?: string;

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
     * Custom recipient field indicating the alert should be treated as an event.
     *
     * @deprecated Use `type: "event"` instead.
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

export type HoneycombTriggerPayload = HoneycombEventPayloadBase & {
    /**
     * Custom recipient field controlling how the payload should be handled.
     *
     * - `trigger`: Post a trigger alert to a channel.
     *
     * Omitted for legacy trigger payloads.
     */
    type?: "trigger";
};

export type HoneycombEventAlertPayload = HoneycombEventPayloadBase & {
    /**
     * Custom recipient field controlling how the payload should be handled.
     *
     * - `event`: Post a one-time event alert to a channel.
     *
     * Omitted for legacy event payloads that still use `isEvent`.
     */
    type?: "event";
};

export type HoneycombTaskPayload = HoneycombEventPayloadBase & {
    /**
     * Custom recipient field controlling how the payload should be handled.
     *
     * - `task`: Create or update tasks in a task collection.
     */
    type: "task";

    /**
     * Custom recipient field naming the configured task collection key to receive task
     * alerts. The key is resolved to an Alpine task collection id.
     */
    collection: string;

    /**
     * Optional task priority to use when creating new tasks. Matching is
     * case-insensitive, and omitted or unknown values default to `Low`.
     */
    priority?: string;
};

export type HoneycombEventPayload =
    | HoneycombTriggerPayload
    | HoneycombEventAlertPayload
    | HoneycombTaskPayload;
