// Result group from webhook template using {{ toJson .Result.GroupsTriggered }}
// See: https://docs.honeycomb.io/notify/webhooks/variables/
export type HoneycombResultGroup = {
    group: Array<{key: string; value: string}>; // GROUP BY columns
    result: number; // The query result value for this group
};

export type HoneycombEventPayload = {
    // Custom field from the honeycomb "Create recipient" UI
    channel: string; // channel name to send to
    emoji?: string; // an optional emoji to add to the trigger
    displayFields?: string; // a comma separated list of fields to display Custom field: include via
    // {{ toJson .Result.GroupsTriggered }} in webhook template
    groupsTriggered?: Array<HoneycombResultGroup>;
    // Standard honeycomb fields
    name: string;
    isEvent?: string;
    id: string;
    description: string;
    environment: string;
    links: {
        trigger: string;
        result: string;
    };
    threshold: {
        op: string;
        value: string | number;
    };
    result: {
        groupsTriggered: Array<unknown>;
    };
    alert: {
        instanceId: string;
        description: string;
        status: string;
        summary: string;
        isTest: boolean;
    };
};
