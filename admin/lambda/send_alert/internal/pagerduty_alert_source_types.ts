// https://developer.pagerduty.com/docs/webhooks-overview#webhook-payload
// https://support.pagerduty.com/main/docs/webhooks#send-a-test-event
// https://support.pagerduty.com/main/docs/webhooks#supported-resources-and-event-types

/**
 * Reference object categories used in PagerDuty webhook payloads.
 */
export type PagerDutyReferenceType =
    | "incident_reference"
    | "service_reference"
    | "user_reference"
    | "escalation_policy_reference"
    | "team_reference"
    | "action_reference"
    | "priority_reference";

export type PagerDutyReference<T extends PagerDutyReferenceType = PagerDutyReferenceType> = {
    /**
     * Browser URL for the referenced PagerDuty object.
     */
    html_url: string;

    /**
     * PagerDuty identifier for the referenced object.
     */
    id: string;

    /**
     * REST API URL for the referenced object.
     */
    self: string;

    /**
     * Human-readable summary for the referenced object.
     */
    summary: string | null;

    /**
     * PagerDuty reference type discriminator.
     */
    type: T;
};

/**
 * Reference to the incident that generated the event.
 */
export type PagerDutyIncident = PagerDutyReference<"incident_reference">;

/**
 * Reference to a PagerDuty service.
 */
export type PagerDutyService = PagerDutyReference<"service_reference">;

/**
 * Reference to a PagerDuty account.
 */
export type PagerDutyUser = PagerDutyReference<"user_reference">;

/**
 * Reference to a PagerDuty escalation policy.
 */
export type PagerDutyEscalationPolicy = PagerDutyReference<"escalation_policy_reference">;

/**
 * Reference to a PagerDuty team.
 */
export type PagerDutyTeam = PagerDutyReference<"team_reference">;

/**
 * Reference to a PagerDuty action.
 */
export type PagerDutyAction = PagerDutyReference<"action_reference">;

type PagerDutyTypedReference = PagerDutyReference & {
    /**
     * PagerDuty object type discriminator for references whose exact reference type
     * varies by event.
     */
    type: string;
};

type PagerDutyIncidentType = {
    /**
     * Human-readable incident type name.
     */
    name: string;
};

type PagerDutyConferenceBridge = {
    /**
     * Conference dial-in number.
     */
    conference_number: string;

    /**
     * Conference URL.
     */
    conference_url: string;
};

type PagerDutyConferenceNumber = {
    /**
     * Label for this conference number.
     */
    label: string;

    /**
     * Dial-in number.
     */
    number: string;
};

type PagerDutyWorkflowTriggerReference = Omit<PagerDutyReference, "html_url"> & {
    /**
     * Browser URL for the workflow trigger, when available.
     */
    html_url: string | null;

    /**
     * PagerDuty object type for the workflow trigger.
     */
    type: string;
};

export type PagerDutyCustomField = {
    /**
     * Data type for the custom field value.
     */
    data_type: string;

    /**
     * Custom field presentation type configured in PagerDuty.
     */
    field_type: string;

    /**
     * PagerDuty identifier for the custom field.
     */
    id: string;

    /**
     * Display name for the custom field.
     */
    name: string;

    /**
     * Optional namespace for the custom field.
     */
    namespace?: string;

    /**
     * PagerDuty object type for the custom field.
     */
    type: string;

    /**
     * Current custom field value.
     */
    value: string | Array<string>;
};

export type PagerDutyRole = {
    /**
     * PagerDuty identifier for the role.
     */
    id: string;

    /**
     * Human-readable role name.
     */
    summary: string;

    /**
     * PagerDuty object type for the role.
     */
    type: string;
};

type PagerDutyIncidentRoleAssignment = {
    /**
     * Current assignee for the incident role.
     */
    assignee: PagerDutyUser;

    /**
     * PagerDuty identifier for the role assignment.
     */
    id: string;

    /**
     * Incident associated with the role assignment.
     */
    incident: PagerDutyIncident;

    /**
     * Previous assignee for the incident role.
     */
    old_assignee: PagerDutyUser | null;

    /**
     * Role assigned on the incident.
     */
    role: PagerDutyRole;

    /**
     * Current role assignment status.
     */
    status: string;

    /**
     * PagerDuty object type for the role assignment.
     */
    type: string;
};

export type PagerDutyIncidentEventData = {
    /**
     * PagerDuty incident identifier.
     */
    id: string;

    /**
     * Discriminator for incident data payloads.
     */
    type: "incident";

    /**
     * REST API URL for the incident.
     */
    self: string;

    /**
     * Browser URL for the incident.
     */
    html_url: string;

    /**
     * Account-local incident number.
     */
    number: number;

    /**
     * Current incident status.
     */
    status: string;

    /**
     * Incident deduplication key.
     */
    incident_key: string;

    /**
     * Timestamp when the incident was created.
     */
    created_at: string;

    /**
     * Timestamp when the incident was reopened, if applicable.
     */
    reopened_at: string | null;

    /**
     * Incident title.
     */
    title: string;

    /**
     * Incident type metadata when incident types are enabled.
     */
    incident_type: PagerDutyIncidentType | null;

    /**
     * Service associated with the incident.
     */
    service: PagerDutyService | null;

    /**
     * Accounts currently assigned to the incident.
     */
    assignees: Array<PagerDutyUser>;

    /**
     * Escalation policy associated with the incident.
     */
    escalation_policy: PagerDutyEscalationPolicy;

    /**
     * Teams associated with the incident.
     */
    teams: Array<PagerDutyTeam>;

    /**
     * Incident priority reference, if a priority is assigned.
     */
    priority: PagerDutyTypedReference | null;

    /**
     * Incident urgency.
     */
    urgency: string;

    /**
     * Conference bridge details for the incident.
     */
    conference_bridge: PagerDutyConferenceBridge;

    /**
     * Resolution reason, if PagerDuty supplied one.
     */
    resolve_reason: string | null;
};

export type PagerDutyIncidentConferenceBridgeEventData = {
    /**
     * Incident whose conference bridge changed.
     */
    incident: PagerDutyIncident;

    /**
     * Dial-in numbers configured on the incident conference bridge.
     */
    conference_numbers: Array<PagerDutyConferenceNumber>;

    /**
     * Conference URL configured on the incident.
     */
    conference_url: string;

    /**
     * Discriminator for incident conference bridge payloads.
     */
    type: "incident_conference_bridge";
};

export type PagerDutyIncidentFieldValuesEventData = {
    /**
     * Incident whose custom field values changed.
     */
    incident: PagerDutyIncident;

    /**
     * Full set of custom field values after the change.
     */
    custom_fields: Array<PagerDutyCustomField>;

    /**
     * Custom field values changed by this event.
     */
    changed_custom_fields: Array<PagerDutyCustomField>;

    /**
     * Discriminator for incident custom field value payloads.
     */
    type: "incident_field_values";
};

export type PagerDutyIncidentNoteEventData = {
    /**
     * Incident that received the note.
     */
    incident: PagerDutyIncident;

    /**
     * PagerDuty identifier for the note.
     */
    id: string;

    /**
     * Note content.
     */
    content: string;

    /**
     * Whether PagerDuty trimmed the content in the webhook payload.
     */
    trimmed: boolean;

    /**
     * Discriminator for incident note payloads.
     */
    type: "incident_note";
};

export type PagerDutyIncidentStatusUpdateEventData = {
    /**
     * Incident that received the status update.
     */
    incident: PagerDutyIncident;

    /**
     * PagerDuty identifier for the status update.
     */
    id: string;

    /**
     * Status update message.
     */
    message: string;

    /**
     * Whether PagerDuty trimmed the message in the webhook payload.
     */
    trimmed: boolean;

    /**
     * Discriminator for incident status update payloads.
     */
    type: "incident_status_update";
};

export type PagerDutyIncidentResponderEventData = {
    /**
     * Incident associated with the responder event.
     */
    incident: PagerDutyIncident;

    /**
     * Responder account.
     */
    user: PagerDutyUser;

    /**
     * Escalation policy involved in the responder request.
     */
    escalation_policy: PagerDutyEscalationPolicy;

    /**
     * Responder request or reply message.
     */
    message: string;

    /**
     * Responder request state.
     */
    state: string;

    /**
     * Discriminator for incident responder payloads.
     */
    type: "incident_responder";
};

export type PagerDutyIncidentWorkflowInstanceEventData = {
    /**
     * PagerDuty identifier for the incident workflow instance.
     */
    id: string;

    /**
     * Discriminator for incident workflow instance payloads.
     */
    type: "incident_workflow_instance";

    /**
     * Human-readable workflow instance summary.
     */
    summary: string;

    /**
     * Incident workflow that ran.
     */
    incident_workflow: PagerDutyTypedReference;

    /**
     * Trigger that started the incident workflow.
     */
    workflow_trigger: PagerDutyWorkflowTriggerReference;

    /**
     * Incident associated with the workflow instance.
     */
    incident: PagerDutyIncident;

    /**
     * Service associated with the workflow instance.
     */
    service: PagerDutyService;
};

export type PagerDutyServiceEventData = {
    /**
     * Browser URL for the service.
     */
    html_url: string;

    /**
     * PagerDuty service identifier.
     */
    id: string;

    /**
     * REST API URL for the service.
     */
    self: string;

    /**
     * Human-readable service summary.
     */
    summary: string;

    /**
     * Service alert creation setting.
     */
    alert_creation: string;

    /**
     * Teams associated with the service.
     */
    teams: Array<PagerDutyTeam>;

    /**
     * Discriminator for service payloads.
     */
    type: "service";
};

export type PagerDutyServiceFieldValuesEventData = {
    /**
     * Service whose custom field values changed.
     */
    service: PagerDutyService;

    /**
     * Full set of custom field values after the change.
     */
    custom_fields: Array<PagerDutyCustomField>;

    /**
     * Custom field values changed by this event.
     */
    changed_custom_fields: Array<PagerDutyCustomField>;

    /**
     * Discriminator for service custom field value payloads.
     */
    type: "service_field_values";
};

export type PagerDutyIncidentActionInvocationEventData = {
    /**
     * PagerDuty identifier for the action invocation.
     */
    id: string;

    /**
     * REST API URL for the action invocation.
     */
    self: string;

    /**
     * Browser URL for the action invocation.
     */
    html_url: string;

    /**
     * Incident associated with the action invocation.
     */
    incident: PagerDutyIncident;

    /**
     * Action that was invoked.
     */
    action: PagerDutyAction;

    /**
     * Current action invocation state.
     */
    state: string;

    /**
     * Discriminator for incident action invocation payloads.
     */
    type: "incident_action_invocation";
};

export type PagerDutyIncidentTaskEventData = {
    /**
     * Incident task name.
     */
    name: string;

    /**
     * Incident task description.
     */
    description: string | null;

    /**
     * PagerDuty identifier for the incident task.
     */
    id: string;

    /**
     * Human-readable incident task summary.
     */
    summary: string;

    /**
     * Discriminator for incident task payloads.
     */
    type: "incident_task";

    /**
     * Current incident task status.
     */
    status: string;

    /**
     * Accounts assigned to the incident task.
     */
    assignees: Array<PagerDutyUser>;

    /**
     * Incident associated with the task.
     */
    incident: PagerDutyIncident;
};

export type PagerDutyIncidentRoleAssignmentEventData = {
    /**
     * Discriminator for incident role assignment payloads.
     */
    type: "incident_role_assignment";

    /**
     * Incident role assignments affected by this event.
     */
    incident_role_assignments: Array<PagerDutyIncidentRoleAssignment>;
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

type PagerDutyWebhookEventClient = {
    /**
     * Client application name.
     */
    name: string;
};

type PagerDutyWebhookEvent = {
    /**
     * Unique identifier for this webhook event.
     */
    id: string;

    /**
     * Timestamp when PagerDuty generated the event.
     */
    occurred_at: string;

    /**
     * PagerDuty account, service, integration, or automation that triggered the event.
     */
    agent: PagerDutyTypedReference | null;

    /**
     * Client application on which the event occurred, when supplied.
     */
    client: PagerDutyWebhookEventClient | null;

    // TODO event_type and resource_type are tied to the data.type. Consider refining
    // this.
    /**
     * Full PagerDuty V3 event name, such as `incident.triggered`.
     */
    event_type: string;

    /**
     * Resource category for the event, such as `incident` or `service`.
     */
    resource_type: string;

    /**
     * Resource-specific payload for the event.
     */
    data: PagerDutyEventData;
};

export type PagerDutyEventPayload = {
    /**
     * PagerDuty V3 webhook event wrapper.
     */
    event: PagerDutyWebhookEvent;
};
