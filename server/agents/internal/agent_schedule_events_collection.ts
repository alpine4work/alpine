import {
    DurableObjectStorageCollection,
    DurableObjectStorageInterface,
} from "~/server/agents/internal/durable_object_storage_collection.js";
import {ApiBotWebhookRequestBody} from "~/shared/api/types/api_specification_convenience_types.js";
import {ChronologicalId, generateChronologicalIdWithTime} from "~/shared/id/chronological_id.js";
import {TracerSpanPropagationContext} from "~/shared/tracer/tracer_span.js";

type AgentScheduleEventRequestBase = {
    /** Date when the task should execute */
    readonly date: Date;

    readonly tracerPropagationContext?: TracerSpanPropagationContext;
};

type AgentClearStorageScheduleEventRequest = AgentScheduleEventRequestBase & {
    readonly type: "ClearStorage";
};

type AgentProcessWebhookScheduleEventRequest = AgentScheduleEventRequestBase & {
    readonly type: "ProcessWebhook";
    readonly payload: ApiBotWebhookRequestBody;
};

export type AgentScheduleEventRequest =
    | AgentClearStorageScheduleEventRequest
    | AgentProcessWebhookScheduleEventRequest;

/**
 * Represents a scheduled task within an Agent
 */
export type AgentScheduleEvent = {
    /** Unique identifier for the schedule */
    readonly id: ChronologicalId;
} & AgentScheduleEventRequest;

/**
 * Collection of scheduled tasks for an Agent sorted by date (earliest event is first).
 */
const ScheduleCollection = new DurableObjectStorageCollection<ChronologicalId, AgentScheduleEvent>(
    "a6",
);

export async function putAgentScheduleEvent<T extends AgentScheduleEventRequest>(
    storage: DurableObjectStorageInterface,
    event: T,
): Promise<AgentScheduleEvent & {type: T["type"]}> {
    const eventId = generateChronologicalIdWithTime(event.date.getTime());

    const scheduledEvent = {
        id: eventId,
        ...event,
    };
    await ScheduleCollection.put(storage, eventId, scheduledEvent);

    return scheduledEvent;
}

export async function getAgentScheduleEvents(storage: DurableObjectStorageInterface) {
    return listScheduledEvents(storage);
}

export async function getAgentScheduleEventsBeforeDate(
    storage: DurableObjectStorageInterface,
    date: Date,
): Promise<Array<AgentScheduleEvent>> {
    const schedules = await ScheduleCollection.list(storage);

    // TODO(ifitzsimons): This is not efficient. We *should* be able to use `end` in the
    // DurableObjectListOptions (provided in call to `list()` above), but I could not
    // get that working.
    // This is fine for now as the number of events should be really small.
    return Array.from(schedules.values()).filter(schedule => schedule.date <= date);
}

export async function getNextAgentScheduleEvent(
    storage: DurableObjectStorageInterface,
): Promise<AgentScheduleEvent | undefined> {
    const scheduledEvents = await listScheduledEvents(storage, {limit: 1});
    return scheduledEvents[0];
}

export async function deleteAgentScheduleEvent(
    storage: DurableObjectStorageInterface,
    eventId: ChronologicalId,
): Promise<void> {
    await ScheduleCollection.delete(storage, eventId);
}

async function listScheduledEvents(
    storage: DurableObjectStorageInterface,
    options: DurableObjectListOptions = {},
): Promise<Array<AgentScheduleEvent>> {
    const events = await storage.list<AgentScheduleEvent>({
        ...options,
        prefix: ScheduleCollection.prefix,
        allowConcurrency: true,
    });
    return Array.from(events.values());
}
