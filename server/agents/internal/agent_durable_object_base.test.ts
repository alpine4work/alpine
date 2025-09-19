import {addDays} from "date-fns";
import {
    agentDeleteAllStorageAlarmDays,
    shouldResetAgentDeleteAllStorageAlarm,
} from "~/server/agents/internal/agent_durable_object_base.js";

describe("`shouldResetAgentDeleteAllStorageAlarm()`", () => {
    test("shouldn’t reset storage alarm immediately after it’s been set", () => {
        expect(
            addDays(new Date("2025-08-29T22:14:00.000Z"), agentDeleteAllStorageAlarmDays),
        ).toEqual(new Date("2025-09-28T22:14:00.000Z"));

        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-29T22:14:00.000Z"),
                alarmTime: new Date("2025-09-28T22:14:00.000Z"),
            }),
        ).toEqual(false);
    });

    test("shouldn’t reset storage alarm an hour after it’s been set", () => {
        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-29T23:14:00.000Z"),
                alarmTime: new Date("2025-09-28T22:14:00.000Z"),
            }),
        ).toEqual(false);
    });

    test("shouldn’t reset storage alarm two hours after it’s been set", () => {
        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-30T01:14:00.000Z"),
                alarmTime: new Date("2025-09-28T22:14:00.000Z"),
            }),
        ).toEqual(false);
    });

    test("shouldn’t reset storage alarm eight hours after it’s been set", () => {
        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-30T07:14:00.000Z"),
                alarmTime: new Date("2025-09-28T22:14:00.000Z"),
            }),
        ).toEqual(false);
    });

    test("shouldn’t reset storage alarm 23 hours after it’s been set", () => {
        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-30T21:14:00.000Z"),
                alarmTime: new Date("2025-09-28T22:14:00.000Z"),
            }),
        ).toEqual(false);
    });

    test("shouldn’t reset storage alarm 23 hours (and 30 minutes) after it’s been set", () => {
        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-30T21:44:00.000Z"),
                alarmTime: new Date("2025-09-28T22:14:00.000Z"),
            }),
        ).toEqual(false);
    });

    test("shouldn’t reset storage alarm 24 hours after it’s been set", () => {
        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-30T22:14:00.000Z"),
                alarmTime: new Date("2025-09-28T22:14:00.000Z"),
            }),
        ).toEqual(false);
    });

    test("should reset storage alarm 24 hours (and one minute) after it’s been set", () => {
        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-30T22:15:00.000Z"),
                alarmTime: new Date("2025-09-28T22:14:00.000Z"),
            }),
        ).toEqual(true);
    });

    test("should reset storage alarm 25 hours after it’s been set", () => {
        expect(
            shouldResetAgentDeleteAllStorageAlarm({
                currentTime: new Date("2025-08-30T23:14:00.000Z"),
                alarmTime: new Date("2025-09-28T22:14:00.000Z"),
            }),
        ).toEqual(true);
    });
});
