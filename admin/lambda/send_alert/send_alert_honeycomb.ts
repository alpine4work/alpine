export type HoneycombEventPayload = {
    // Custom field from the honeycomb "Create recipient" UI
    channel: string; // channel name to send to
    emoji?: string; // an optional emoji to add to the trigger
    displayFields?: string; // a comma separated list of fields to display
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
