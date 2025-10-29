export type HoneycombEventPayload = {
    name: string;
    channel: string;
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
