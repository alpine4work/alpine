import {addHours} from "date-fns";
import {
    agentDeleteAllStorageAlarmHours,
    shouldResetAgentDeleteAllStorageAlarm,
} from "~/server/agents/internal/agent_durable_object_base.js";

describe("`shouldResetAgentDeleteAllStorageAlarm()`", () => {
    test("shouldn’t reset storage alarm immediately after it’s been set", () => {
        expect(
            addHours(new Date("2025-08-29T22:14:00.000Z"), agentDeleteAllStorageAlarmHours),
        ).toEqual(new Date("2025-08-30T04:14:00.000Z"));

        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-29T22:14:00.000Z"),
                alarmTime: new Date("2025-08-30T04:14:00.000Z"),
            }),
        ).toEqual(false);
    });

    test("shouldn’t reset storage alarm a minute after it’s been set", () => {
        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-29T22:15:00.000Z"),
                alarmTime: new Date("2025-08-30T04:14:00.000Z"),
            }),
        ).toEqual(false);
    });

    test("shouldn’t reset storage alarm two minutes after it’s been set", () => {
        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-29T22:16:00.000Z"),
                alarmTime: new Date("2025-08-30T04:14:00.000Z"),
            }),
        ).toEqual(false);
    });

    test("shouldn’t reset storage alarm thirty minutes after it’s been set", () => {
        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-29T22:44:00.000Z"),
                alarmTime: new Date("2025-08-30T04:14:00.000Z"),
            }),
        ).toEqual(false);
    });

    test("shouldn’t reset storage alarm 59 minutes after it’s been set", () => {
        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-29T23:13:00.000Z"),
                alarmTime: new Date("2025-08-30T04:14:00.000Z"),
            }),
        ).toEqual(false);
    });

    test("shouldn’t reset storage alarm 60 minutes after it’s been set", () => {
        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-29T23:14:00.000Z"),
                alarmTime: new Date("2025-08-30T04:14:00.000Z"),
            }),
        ).toEqual(false);
    });

    test("should reset storage alarm 61 minutes after it’s been set", () => {
        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-29T23:15:00.000Z"),
                alarmTime: new Date("2025-08-30T04:14:00.000Z"),
            }),
        ).toEqual(true);
    });

    test("should reset storage alarm 2 hours after it’s been set", () => {
        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-31T00:14:00.000Z"),
                alarmTime: new Date("2025-08-30T04:14:00.000Z"),
            }),
        ).toEqual(true);
    });
});
