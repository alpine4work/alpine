import {getAgentUsageLocalResetTimeString} from "~/server/agents/internal/get_agent_usage_local_reset_time_string.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.js";

describe("getAgentUsageLocalResetTimeString", () => {
    describe("today scenarios", () => {
        test("returns ‘today at’ when reset is later same day in UTC", () => {
            const currentTime = new Date("2025-01-15T10:00:00.000Z");
            const resetTime = new Date("2025-01-15T18:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("UTC"),
            );

            expect(result).toBe("today at 6:00pm UTC");
        });

        test("returns ‘today at’ when reset is later same day in America/New_York", () => {
            const currentTime = new Date("2025-01-15T15:00:00.000Z"); // 10am EST
            const resetTime = new Date("2025-01-15T23:00:00.000Z"); // 6pm EST

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("today at 6:00pm EST");
        });

        test("returns ‘tomorrow at’ when reset is at midnight (start of next day)", () => {
            const currentTime = new Date("2025-01-15T04:00:00.000Z"); // 11pm EST Jan 14
            const resetTime = new Date("2025-01-15T05:00:00.000Z"); // 12am EST Jan 15

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 12:00am EST");
        });

        test("returns ‘today at’ when reset is just before midnight same day", () => {
            const currentTime = new Date("2025-01-15T10:00:00.000Z");
            const resetTime = new Date("2025-01-16T04:59:00.000Z"); // 11:59pm EST

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("today at 11:59pm EST");
        });

        test("returns ‘today at’ for same instant", () => {
            const time = new Date("2025-01-15T12:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(time, time, assertTimeZone("UTC"));

            expect(result).toBe("today at 12:00pm UTC");
        });

        test("returns ‘today at’ in Asia/Tokyo timezone", () => {
            const currentTime = new Date("2025-01-15T01:00:00.000Z"); // 10am JST
            const resetTime = new Date("2025-01-15T09:00:00.000Z"); // 6pm JST

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("Asia/Tokyo"),
            );

            expect(result).toBe("today at 6:00pm JST");
        });
    });

    describe("tomorrow scenarios", () => {
        test("returns ‘tomorrow at’ when reset is next calendar day in UTC", () => {
            const currentTime = new Date("2025-01-15T10:00:00.000Z");
            const resetTime = new Date("2025-01-16T10:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("UTC"),
            );

            expect(result).toBe("tomorrow at 10:00am UTC");
        });

        test("returns ‘tomorrow at’ when reset is next day in America/New_York", () => {
            const currentTime = new Date("2025-01-15T15:00:00.000Z"); // 10am EST
            const resetTime = new Date("2025-01-16T15:00:00.000Z"); // 10am EST next day

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 10:00am EST");
        });

        test("returns ‘tomorrow at’ when reset is at midnight of next day", () => {
            const currentTime = new Date("2025-01-15T15:00:00.000Z"); // 10am EST
            const resetTime = new Date("2025-01-16T05:00:00.000Z"); // 12am EST next day

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 12:00am EST");
        });

        test("returns ‘tomorrow at’ when current time is late evening", () => {
            const currentTime = new Date("2025-01-15T23:30:00.000Z"); // 6:30pm EST
            const resetTime = new Date("2025-01-16T15:00:00.000Z"); // 10am EST next day

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 10:00am EST");
        });

        test("returns ‘tomorrow at’ in Asia/Tokyo timezone", () => {
            const currentTime = new Date("2025-01-15T01:00:00.000Z"); // 10am JST
            const resetTime = new Date("2025-01-16T01:00:00.000Z"); // 10am JST next day

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("Asia/Tokyo"),
            );

            expect(result).toBe("tomorrow at 10:00am JST");
        });

        test("returns ‘tomorrow at’ crossing month boundary", () => {
            const currentTime = new Date("2025-01-31T15:00:00.000Z"); // Jan 31, 10am EST
            const resetTime = new Date("2025-02-01T15:00:00.000Z"); // Feb 1, 10am EST

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 10:00am EST");
        });

        test("returns ‘tomorrow at’ crossing year boundary", () => {
            const currentTime = new Date("2025-12-31T15:00:00.000Z"); // Dec 31, 10am EST
            const resetTime = new Date("2026-01-01T15:00:00.000Z"); // Jan 1, 10am EST

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 10:00am EST");
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

            expect(result).toBe("on Jan 17th at 10:00am UTC");
        });

        test("returns formatted date when reset is 7 days away", () => {
            const currentTime = new Date("2025-01-15T15:00:00.000Z");
            const resetTime = new Date("2025-01-22T15:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("on Jan 22nd at 10:00am EST");
        });

        test("returns formatted date when reset is 30 days away", () => {
            const currentTime = new Date("2025-01-15T10:00:00.000Z");
            const resetTime = new Date("2025-02-14T10:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("UTC"),
            );

            expect(result).toBe("on Feb 14th at 10:00am UTC");
        });

        test("returns formatted date crossing month boundary", () => {
            const currentTime = new Date("2025-01-30T15:00:00.000Z");
            const resetTime = new Date("2025-02-05T15:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("on Feb 5th at 10:00am EST");
        });

        test("returns formatted date crossing year boundary", () => {
            const currentTime = new Date("2025-12-20T10:00:00.000Z");
            const resetTime = new Date("2026-01-05T10:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("UTC"),
            );

            expect(result).toBe("on Jan 5th at 10:00am UTC");
        });

        test("returns formatted date in Asia/Tokyo timezone", () => {
            const currentTime = new Date("2025-01-15T01:00:00.000Z");
            const resetTime = new Date("2025-01-20T01:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("Asia/Tokyo"),
            );

            expect(result).toBe("on Jan 20th at 10:00am JST");
        });
    });

    describe("DST transition scenarios", () => {
        test("handles spring DST transition (EST to EDT)", () => {
            // March 9, 2025 is when DST starts
            const currentTime = new Date("2025-03-09T15:00:00.000Z"); // March 9
            const resetTime = new Date("2025-03-10T14:00:00.000Z"); // March 10 (after DST)

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 10:00am EDT");
        });

        test("handles fall DST transition (EDT to EST)", () => {
            // November 2, 2025 is when DST ends
            const currentTime = new Date("2025-11-02T14:00:00.000Z"); // November 2
            const resetTime = new Date("2025-11-03T15:00:00.000Z"); // November 3 (after DST)

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 10:00am EST");
        });

        test("handles PDT timezone in summer", () => {
            const currentTime = new Date("2025-07-15T17:00:00.000Z");
            const resetTime = new Date("2025-07-16T17:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/Los_Angeles"),
            );

            expect(result).toBe("tomorrow at 10:00am PDT");
        });

        test("handles PST timezone in winter", () => {
            const currentTime = new Date("2025-01-15T18:00:00.000Z");
            const resetTime = new Date("2025-01-16T18:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/Los_Angeles"),
            );

            expect(result).toBe("tomorrow at 10:00am PST");
        });
    });

    describe("timezone edge cases", () => {
        test("handles timezone causing different calendar days (UTC vs Tokyo)", () => {
            // 11pm UTC Jan 15 = 8am JST Jan 16
            const currentTime = new Date("2025-01-15T23:00:00.000Z");
            const resetTime = new Date("2025-01-16T01:00:00.000Z"); // 10am JST Jan 16

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("Asia/Tokyo"),
            );

            expect(result).toBe("today at 10:00am JST");
        });

        test("handles Europe/London GMT timezone", () => {
            const currentTime = new Date("2025-01-15T10:00:00.000Z");
            const resetTime = new Date("2025-01-16T10:00:00.000Z");

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("Europe/London"),
            );

            expect(result).toBe("tomorrow at 10:00am GMT");
        });

        test("handles Australia/Sydney AEDT timezone", () => {
            const currentTime = new Date("2025-01-14T23:00:00.000Z"); // 10am AEDT Jan 15
            const resetTime = new Date("2025-01-15T23:00:00.000Z"); // 10am AEDT Jan 16

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("Australia/Sydney"),
            );

            expect(result).toBe("tomorrow at 10:00am AEDT");
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

            expect(result).toBe("today at 12:00pm EST");
        });

        test("handles midnight (12:00am)", () => {
            const currentTime = new Date("2025-01-15T10:00:00.000Z");
            const resetTime = new Date("2025-01-16T05:00:00.000Z"); // 12am EST

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("tomorrow at 12:00am EST");
        });

        test("handles 11:59pm edge case", () => {
            const currentTime = new Date("2025-01-15T10:00:00.000Z");
            const resetTime = new Date("2025-01-16T04:59:00.000Z"); // 11:59pm EST

            const result = getAgentUsageLocalResetTimeString(
                resetTime,
                currentTime,
                assertTimeZone("America/New_York"),
            );

            expect(result).toBe("today at 11:59pm EST");
        });
    });
});
