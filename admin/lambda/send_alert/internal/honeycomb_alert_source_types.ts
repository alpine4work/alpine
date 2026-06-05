// Result group from webhook template using {{ toJson .Result.GroupsTriggered }}
// See: https://docs.honeycomb.io/notify/webhooks/variables/
export type HoneycombResultGroup = {
    group: Array<{key: string; value: string}>;
    result: number;
};

export type HoneycombEventPayload = {
    // Custom field from the honeycomb "Create recipient" UI
    channel: string;
    emoji?: string;
    displayFields?: string;
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
