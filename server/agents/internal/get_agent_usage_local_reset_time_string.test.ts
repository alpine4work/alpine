import {getAgentUsageLocalResetTimeString} from "~/server/agents/internal/get_agent_usage_local_reset_time_string.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.js";

describe("getAgentUsageLocalResetTimeString", () => {
    describe("today scenarios", () => {
        test("returns ‘today at’ when reset is later same day in", () => {
            const currentTime = new Date("2025-01-15T10:00:00.000Z");
            const resetTime = new Date("2025-01-15T18:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("UTC"),
            );

            expect(result).toBe("today at 6:00pm");
        });

        test("returns ‘today at’ when reset is later same day in America/New_York", () => {
            const currentTime = new Date("2025-01-15T15:00:00.000Z"); // 10am EST
            const resetTime = new Date("2025-01-15T23:00:00.000Z"); // 6pm EST

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("today at 6:00pm");
        });

        test("returns ‘tomorrow at’ when reset is at midnight (start of next day)", () => {
            const currentTime = new Date("2025-01-15T04:00:00.000Z"); // 11pm EST Jan 14
            const resetTime = new Date("2025-01-15T05:00:00.000Z"); // 12am EST Jan 15

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 12:00am");
        });

        test("returns ‘today at’ when reset is just before midnight same day", () => {
            const currentTime = new Date("2025-01-15T10:00:00.000Z");
            const resetTime = new Date("2025-01-16T04:59:00.000Z"); // 11:59pm EST

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("today at 11:59pm");
        });

        test("returns ‘today at’ for same instant", () => {
            const time = new Date("2025-01-15T12:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(time, time, assertTimeZone("UTC"));

            expect(result).toBe("today at 12:00pm");
        });

        test("returns ‘today at’ in Asia/Tokyo timezone", () => {
            const currentTime = new Date("2025-01-15T01:00:00.000Z"); // 10am JST
            const resetTime = new Date("2025-01-15T09:00:00.000Z"); // 6pm JST

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("Asia/Tokyo"),
            );

            expect(result).toBe("today at 6:00pm");
        });
    });

    describe("tomorrow scenarios", () => {
        test("returns ‘tomorrow at’ when reset is next calendar day in", () => {
            const currentTime = new Date("2025-01-15T10:00:00.000Z");
            const resetTime = new Date("2025-01-16T10:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("UTC"),
            );

            expect(result).toBe("tomorrow at 10:00am");
        });

        test("returns ‘tomorrow at’ when reset is next day in America/New_York", () => {
            const currentTime = new Date("2025-01-15T15:00:00.000Z"); // 10am EST
            const resetTime = new Date("2025-01-16T15:00:00.000Z"); // 10am EST next day

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 10:00am");
        });

        test("returns ‘tomorrow at’ when reset is at midnight of next day", () => {
            const currentTime = new Date("2025-01-15T15:00:00.000Z"); // 10am EST
            const resetTime = new Date("2025-01-16T05:00:00.000Z"); // 12am EST next day

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 12:00am");
        });

        test("returns ‘tomorrow at’ when current time is late evening", () => {
            const currentTime = new Date("2025-01-15T23:30:00.000Z"); // 6:30pm EST
            const resetTime = new Date("2025-01-16T15:00:00.000Z"); // 10am EST next day

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 10:00am");
        });

        test("returns ‘tomorrow at’ in Asia/Tokyo timezone", () => {
            const currentTime = new Date("2025-01-15T01:00:00.000Z"); // 10am JST
            const resetTime = new Date("2025-01-16T01:00:00.000Z"); // 10am JST next day

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("Asia/Tokyo"),
            );

            expect(result).toBe("tomorrow at 10:00am");
        });

        test("returns ‘tomorrow at’ crossing month boundary", () => {
            const currentTime = new Date("2025-01-31T15:00:00.000Z"); // Jan 31, 10am EST
            const resetTime = new Date("2025-02-01T15:00:00.000Z"); // Feb 1, 10am EST

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 10:00am");
        });

        test("returns ‘tomorrow at’ crossing year boundary", () => {
            const currentTime = new Date("2025-12-31T15:00:00.000Z"); // Dec 31, 10am EST
            const resetTime = new Date("2026-01-01T15:00:00.000Z"); // Jan 1, 10am EST

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 10:00am");
        });
    });

    describe("future date scenarios", () => {
        test("returns formatted date when reset is 2 days away", () => {
            const currentTime = new Date("2025-01-15T10:00:00.000Z");
            const resetTime = new Date("2025-01-17T10:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("UTC"),
            );

            expect(result).toBe("on Jan 17th at 10:00am");
        });

        test("returns formatted date when reset is 7 days away", () => {
            const currentTime = new Date("2025-01-15T15:00:00.000Z");
            const resetTime = new Date("2025-01-22T15:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("on Jan 22nd at 10:00am");
        });

        test("returns formatted date when reset is 30 days away", () => {
            const currentTime = new Date("2025-01-15T10:00:00.000Z");
            const resetTime = new Date("2025-02-14T10:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("UTC"),
            );

            expect(result).toBe("on Feb 14th at 10:00am");
        });

        test("returns formatted date crossing month boundary", () => {
            const currentTime = new Date("2025-01-30T15:00:00.000Z");
            const resetTime = new Date("2025-02-05T15:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("on Feb 5th at 10:00am");
        });

        test("returns formatted date crossing year boundary", () => {
            const currentTime = new Date("2025-12-20T10:00:00.000Z");
            const resetTime = new Date("2026-01-05T10:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("UTC"),
            );

            expect(result).toBe("on Jan 5th at 10:00am");
        });

        test("returns formatted date in Asia/Tokyo timezone", () => {
            const currentTime = new Date("2025-01-15T01:00:00.000Z");
            const resetTime = new Date("2025-01-20T01:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("Asia/Tokyo"),
            );

            expect(result).toBe("on Jan 20th at 10:00am");
        });
    });

    describe("noon and midnight edge cases", () => {
        test("handles noon (12:00pm)", () => {
            const currentTime = new Date("2025-01-15T10:00:00.000Z");
            const resetTime = new Date("2025-01-15T17:00:00.000Z"); // 12pm EST

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("today at 12:00pm");
        });

        test("handles midnight (12:00am)", () => {
            const currentTime = new Date("2025-01-15T10:00:00.000Z");
            const resetTime = new Date("2025-01-16T05:00:00.000Z"); // 12am EST

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 12:00am");
        });

        test("handles 11:59pm edge case", () => {
            const currentTime = new Date("2025-01-15T10:00:00.000Z");
            const resetTime = new Date("2025-01-16T04:59:00.000Z"); // 11:59pm EST

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("today at 11:59pm");
        });
    });
});
