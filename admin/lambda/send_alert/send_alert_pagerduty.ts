// https://developer.pagerduty.com/docs/webhooks-overview#webhook-payload

export type PagerDutyReferenceType =
    | "incident_reference"
    | "service_reference"
    | "user_reference"
    | "escalation_policy_reference"
    | "team_reference"
    | "action_reference";

export type PagerDutyReference<T extends PagerDutyReferenceType = PagerDutyReferenceType> = {
    html_url: string;
    id: string;
    self: string;
    summary: string | null;
    type: T;
};

export type PagerDutyIncident = PagerDutyReference<"incident_reference">;

export type PagerDutyService = PagerDutyReference<"service_reference">;

export type PagerDutyUser = PagerDutyReference<"user_reference">;

export type PagerDutyEscalationPolicy = PagerDutyReference<"escalation_policy_reference">;

export type PagerDutyTeam = PagerDutyReference<"team_reference">;

export type PagerDutyAction = PagerDutyReference<"action_reference">;

export type PagerDutyCustomField = {
    data_type: string;
    field_type: string;
    id: string;
    name: string;
    namespace?: string;
    type: string;
    value: string | Array<string>;
};

export type PagerDutyRole = {
    id: string;
    summary: string;
    type: string;
};

export type PagerDutyIncidentEventData = {
    id: string;
    type: "incident";
    self: string;
    html_url: string;
    number: number;
    status: string;
    incident_key: string;
    created_at: string;
    reopened_at: string | null;
    title: string;
    incident_type: {
        name: string;
    };
    service: PagerDutyService;
    assignees: Array<PagerDutyUser>;
    escalation_policy: PagerDutyEscalationPolicy;
    teams: Array<PagerDutyTeam>;
    priority: PagerDutyReference & {
        type: string;
    };
    urgency: string;
    conference_bridge: {
        conference_number: string;
        conference_url: string;
    };
    resolve_reason: string | null;
};

export type PagerDutyIncidentConferenceBridgeEventData = {
    incident: PagerDutyIncident;
    conference_numbers: Array<{
        label: string;
        number: string;
    }>;
    conference_url: string;
    type: "incident_conference_bridge";
};

export type PagerDutyIncidentFieldValuesEventData = {
    incident: PagerDutyIncident;
    custom_fields: Array<PagerDutyCustomField>;
    changed_custom_fields: Array<PagerDutyCustomField>;
    type: "incident_field_values";
};

export type PagerDutyIncidentNoteEventData = {
    incident: PagerDutyIncident;
    id: string;
    content: string;
    trimmed: boolean;
    type: "incident_note";
};

export type PagerDutyIncidentStatusUpdateEventData = {
    incident: PagerDutyIncident;
    id: string;
    message: string;
    trimmed: boolean;
    type: "incident_status_update";
};

export type PagerDutyIncidentResponderEventData = {
    incident: PagerDutyIncident;
    user: PagerDutyUser;
    escalation_policy: PagerDutyEscalationPolicy;
    message: string;
    state: string;
    type: "incident_responder";
};

export type PagerDutyIncidentWorkflowInstanceEventData = {
    id: string;
    type: "incident_workflow_instance";
    summary: string;
    incident_workflow: PagerDutyReference & {
        type: string;
    };
    workflow_trigger: Omit<PagerDutyReference, "html_url"> & {
        html_url: string | null;
        type: string;
    };
    incident: PagerDutyIncident;
    service: PagerDutyService;
};

export type PagerDutyServiceEventData = {
    html_url: string;
    id: string;
    self: string;
    summary: string;
    alert_creation: string;
    teams: Array<PagerDutyTeam>;
    type: "service";
};

export type PagerDutyServiceFieldValuesEventData = {
    service: PagerDutyService;
    custom_fields: Array<PagerDutyCustomField>;
    changed_custom_fields: Array<PagerDutyCustomField>;
    type: "service_field_values";
};

export type PagerDutyIncidentActionInvocationEventData = {
    id: string;
    self: string;
    html_url: string;
    incident: PagerDutyIncident;
    action: PagerDutyAction;
    state: string;
    type: "incident_action_invocation";
};

export type PagerDutyIncidentTaskEventData = {
    name: string;
    description: string | null;
    id: string;
    summary: string;
    type: "incident_task";
    status: string;
    assignees: Array<PagerDutyUser>;
    incident: PagerDutyIncident;
};

export type PagerDutyIncidentRoleAssignmentEventData = {
    type: "incident_role_assignment";
    incident_role_assignments: Array<{
        assignee: PagerDutyUser;
        id: string;
        incident: PagerDutyIncident;
        old_assignee: PagerDutyUser | null;
        role: PagerDutyRole;
        status: string;
        type: string;
    }>;
};

export type PagerDutyEventData =
    | PagerDutyIncidentEventData
    | PagerDutyIncidentConferenceBridgeEventData
    | PagerDutyIncidentFieldValuesEventData
    | PagerDutyIncidentNoteEventData
    | PagerDutyIncidentStatusUpdateEventData
    | PagerDutyIncidentResponderEventData
    | PagerDutyIncidentWorkflowInstanceEventData
    | PagerDutyServiceEventData
    | PagerDutyServiceFieldValuesEventData
    | PagerDutyIncidentActionInvocationEventData
    | PagerDutyIncidentTaskEventData
    | PagerDutyIncidentRoleAssignmentEventData;

export type PagerDutyEventDataType = PagerDutyEventData["type"];

export type PagerDutyEventPayload = {
    event: {
        id: string;
        occurred_at: string;
        agent: PagerDutyReference & {
            type: string;
        };
        client: {
            name: string;
        };
        // TODO event_type and resource_type are tied to the data.type. Consider refining this.
        event_type: string;
        resource_type: string;
        data: PagerDutyEventData;
    };
};
