import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {
    deleteAgentScheduleEvent,
    getAgentScheduleEvents,
    getAgentScheduleEventsBeforeDate,
    getNextAgentScheduleEvent,
    putAgentScheduleEvent,
} from "~/server/agents/internal/agent_schedule_events_collection.js";

const storage = new DurableObjectStorage(new MemoryStorage());

afterEach(async () => {
    await storage.deleteAll();
});

describe("AgentDurableObjectEventScheduleCollection", () => {
    test("stores events in order", async () => {
        const now = new Date("2025-01-01T12:00:00Z");
        const later = new Date("2025-01-01T13:00:00Z");
        const earliest = new Date("2025-01-01T11:00:00Z");

        // Schedule events out of order
        const {id: id1} = await putAgentScheduleEvent(storage, {
            type: "ClearStorage",
            date: now,
        });
        const {id: id2} = await putAgentScheduleEvent(storage, {
            type: "ClearStorage",
            date: later,
        });
        const {id: id3} = await putAgentScheduleEvent(storage, {
            type: "ClearStorage",
            date: earliest,
        });

        const events = await getAgentScheduleEvents(storage);

        expect(events).toEqual([
            {id: id3, type: "ClearStorage", date: earliest},
            {id: id1, type: "ClearStorage", date: now},
            {id: id2, type: "ClearStorage", date: later},
        ]);
    });

    test("returns events before and equal to reference time", async () => {
        const date1 = new Date("2025-01-01T10:00:00Z");
        const date2 = new Date("2025-01-01T12:00:00Z");
        const date3 = new Date("2025-01-01T14:00:00Z");
        const referenceDate = new Date("2025-01-01T12:00:00Z");

        const {id: id1} = await putAgentScheduleEvent(storage, {
            type: "ClearStorage",
            date: date2,
        });
        const {id: id2} = await putAgentScheduleEvent(storage, {
            type: "ClearStorage",
            date: date1,
        });
        await putAgentScheduleEvent(storage, {
            type: "ClearStorage",
            date: date3,
        });

        const events = await getAgentScheduleEventsBeforeDate(storage, referenceDate);

        // Should return events at or before reference date
        expect(events).toEqual([
            {id: id2, type: "ClearStorage", date: date1},
            {id: id1, type: "ClearStorage", date: date2},
        ]);
    });

    test("returns the next scheduled event", async () => {
        const earliest = new Date("2025-01-01T10:00:00Z");
        const middle = new Date("2025-01-01T12:00:00Z");
        const latest = new Date("2025-01-01T14:00:00Z");

        await putAgentScheduleEvent(storage, {
            type: "ClearStorage",
            date: middle,
        });
        await putAgentScheduleEvent(storage, {
            type: "ClearStorage",
            date: latest,
        });
        const {id} = await putAgentScheduleEvent(storage, {
            type: "ClearStorage",
            date: earliest,
        });

        const nextEvent = await getNextAgentScheduleEvent(storage);

        expect(nextEvent).toEqual({id, type: "ClearStorage", date: earliest});
    });

    test("returns undefined when no events scheduled", async () => {
        const nextEvent = await getNextAgentScheduleEvent(storage);
        expect(nextEvent).toBeUndefined();
    });

    test("deletes an event", async () => {
        const date1 = new Date("2025-01-01T10:00:00Z");
        const date2 = new Date("2025-01-01T12:00:00Z");

        const event1 = await putAgentScheduleEvent(storage, {
            type: "ClearStorage",
            date: date1,
        });
        const event2 = await putAgentScheduleEvent(storage, {
            type: "ClearStorage",
            date: date2,
        });

        let events = await getAgentScheduleEvents(storage);
        expect(events).toHaveLength(2);

        await deleteAgentScheduleEvent(storage, event1.id);

        events = await getAgentScheduleEvents(storage);
        expect(events).toHaveLength(1);
        expect(events).toEqual([{id: event2.id, type: "ClearStorage", date: date2}]);
    });

    test("handles multiple events with same timestamp", async () => {
        const sameDate = new Date("2025-01-01T12:00:00Z");

        await putAgentScheduleEvent(storage, {
            type: "ClearStorage",
            date: sameDate,
        });
        await putAgentScheduleEvent(storage, {
            type: "ClearStorage",
            date: sameDate,
        });
        await putAgentScheduleEvent(storage, {
            type: "ClearStorage",
            date: sameDate,
        });

        const events = await getAgentScheduleEvents(storage);

        // All events should be stored with unique IDs
        expect(events).toHaveLength(3);
    });
});
