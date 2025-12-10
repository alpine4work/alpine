import {
    DurableObjectStorageCollection,
    DurableObjectStorageInterface,
} from "~/server/agents/internal/durable_object_storage_collection.js";
import {ApiBotWebhookRequestBody} from "~/shared/api/types/api_specification_convenience_types.js";
import {ChronologicalId, generateChronologicalIdWithTime} from "~/shared/id/chronological_id.js";
import {TracerSpanPropagationContext} from "~/shared/tracer/tracer_span.js";

type AgentDurableObjectScheduleEventRequestBase = {
    /** Date when the task should execute */
    readonly date: Date;

    readonly tracerPropagationContext?: TracerSpanPropagationContext;
};

type AgentDurableObjectClearStorageScheduleEventRequest =
    AgentDurableObjectScheduleEventRequestBase & {
        readonly type: "ClearStorage";
    };

type AgentDurableObjectProcessWebhookScheduleEventRequest =
    AgentDurableObjectScheduleEventRequestBase & {
        readonly type: "ProcessWebhook";
        readonly payload: ApiBotWebhookRequestBody;
    };

export type AgentDurableObjectScheduleEventRequest =
    | AgentDurableObjectClearStorageScheduleEventRequest
    | AgentDurableObjectProcessWebhookScheduleEventRequest;

/**
 * Represents a scheduled task within an Agent
 */
export type AgentDurableObjectScheduleEvent = {
    /** Unique identifier for the schedule */
    readonly id: ChronologicalId;
} & AgentDurableObjectScheduleEventRequest;

/**
 * Collection of scheduled tasks for an Agent sorted by date (earliest event is first).
 */
const ScheduleCollection = new DurableObjectStorageCollection<
    ChronologicalId,
    AgentDurableObjectScheduleEvent
>("a6");

export async function putAgentDurableObjectScheduleEvent<
    T extends AgentDurableObjectScheduleEventRequest,
>(
    storage: DurableObjectStorageInterface,
    event: T,
): Promise<AgentDurableObjectScheduleEvent & {type: T["type"]}> {
    const eventId = generateChronologicalIdWithTime(event.date.getTime());

    const scheduledEvent = {
        id: eventId,
        ...event,
    };
    await ScheduleCollection.put(storage, eventId, scheduledEvent);

    return scheduledEvent;
}

export async function getAgentDurableObjectScheduleEvents(storage: DurableObjectStorageInterface) {
    return listScheduledEvents(storage);
}

export async function getAgentDurableObjectScheduleEventsBeforeDate(
    storage: DurableObjectStorageInterface,
    date: Date,
): Promise<Array<AgentDurableObjectScheduleEvent>> {
    const schedules = await ScheduleCollection.list(storage);

    // TODO(ifitzsimons): This is not efficient. We *should* be able to use `end` in the
    // DurableObjectListOptions (provided in call to `list()` above), but I could not
    // get that working.
    // This is fine for now as the number of events should be really small.
    return Array.from(schedules.values()).filter(schedule => schedule.date <= date);
}

export async function getNextAgentDurableObjectScheduleEvent(
    storage: DurableObjectStorageInterface,
): Promise<AgentDurableObjectScheduleEvent | undefined> {
    const scheduledEvents = await listScheduledEvents(storage, {limit: 1});
    return scheduledEvents[0];
}

export async function deleteAgentDurableObjectScheduleEvent(
    storage: DurableObjectStorageInterface,
    eventId: ChronologicalId,
): Promise<void> {
    await ScheduleCollection.delete(storage, eventId);
}

async function listScheduledEvents(
    storage: DurableObjectStorageInterface,
    options: DurableObjectListOptions = {},
): Promise<Array<AgentDurableObjectScheduleEvent>> {
    const events = await storage.list<AgentDurableObjectScheduleEvent>({
        ...options,
        prefix: ScheduleCollection.prefix,
        allowConcurrency: true,
    });
    return Array.from(events.values());
}
