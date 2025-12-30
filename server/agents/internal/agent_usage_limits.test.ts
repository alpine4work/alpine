/* eslint-disable @typescript-eslint/unbound-method */
import {jest} from "@jest/globals";
import {
    agentUsageWindowLimit,
    checkAgentUsageLimit,
    recordAgentUsage,
} from "~/server/agents/internal/agent_usage_limits.js";
import {
    AgentUsageDatabase,
    AgentUsageDatabaseInterface,
} from "~/server/agents/internal/d1/agent_usage_database.js";
import {joshKnownAccountId} from "~/shared/accounts/known_account_ids.js";
import {UnknownError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const mockAgentUsageDatabase: jest.Mocked<AgentUsageDatabaseInterface> = {
    createAgentRequest: jest.fn(),
    getUsedMillicentsByAccountIdSinceTimestamp: jest.fn(),
    getWindowStartTimeByAccountId: jest.fn(),
    setWindowStartTimeByAccountId: jest.fn(),
};

const mockAgentUsageDatabaseClass = mockAgentUsageDatabase as unknown as AgentUsageDatabase;

/**
 * Helper function to assert that a timestamp matches an expected human-readable date string.
 * This just makes failing assertions much easier to read.
 */
function assertStringTimestampEqual(actualTimestamp: number, expectedDateString: string) {
    const actualDate = new Date(actualTimestamp);
    const formatter = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "UTC",
    });
    const actualDateString = formatter.format(actualDate).replace(" at ", " at ");
    expect(actualDateString).toBe(expectedDateString);
}

describe("checkAgentUsageLimit", () => {
    beforeAll(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2024-01-17T12:00:00.000Z").getTime());
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("allows requests when no window exists (returns current timestamp)", async () => {
        const currentTimestamp = Date.now();
        const accountId = "test_account" as AccountId;

        // Mock returns null since no window exists
        mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(null);
        mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
            BigInt(0),
        );

        const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
            accountId,
            currentTimestamp,
        });

        expect(result.ok).toBe(true);
        expect(mockAgentUsageDatabase.getWindowStartTimeByAccountId).toHaveBeenCalledWith(
            accountId,
        );
    });

    test("allows requests under both weekly and dynamic limits", async () => {
        const currentTimestamp = Date.now();
        const accountId = "test_account" as AccountId;
        const windowStartTime = currentTimestamp - 1000;

        // Mock existing window
        mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(windowStartTime);

        // Mock current usage under both limits
        const dynamicLimit = agentUsageWindowLimit.dynamic.limitDollars * 100 * 1000; // in millicents
        const weeklyLimit = agentUsageWindowLimit.weekly.limitDollars * 100 * 1000; // in millicents
        const usageAmount = Math.min(dynamicLimit, weeklyLimit) - 1000;

        mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
            BigInt(usageAmount),
        );

        const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
            accountId,
            currentTimestamp,
        });

        expect(result.ok).toBe(true);
        // Should check both weekly window (from Sunday) and dynamic window
        expect(
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp,
        ).toHaveBeenCalledTimes(2);
    });

    [
        {
            dynamicPercent: 0,
            weeklyPercent: 0,
            expectedMaximumWindowUsagePercent: 0,
        },
        {
            dynamicPercent: 0,
            weeklyPercent: 0.5,
            expectedMaximumWindowUsagePercent: 0.5,
        },
        {
            dynamicPercent: 0.5,
            weeklyPercent: 0,
            expectedMaximumWindowUsagePercent: 0.5,
        },
        {
            dynamicPercent: 0.3,
            weeklyPercent: 0.5,
            expectedMaximumWindowUsagePercent: 0.5,
        },
        {
            dynamicPercent: 0.5,
            weeklyPercent: 0.3,
            expectedMaximumWindowUsagePercent: 0.5,
        },
        {
            dynamicPercent: 1,
            weeklyPercent: 0.3,
            expectedMaximumWindowUsagePercent: 1,
        },
        {
            dynamicPercent: 0.99999,
            weeklyPercent: 0.99999,
            expectedMaximumWindowUsagePercent: 0.99999,
        },
    ].forEach(({dynamicPercent, weeklyPercent, expectedMaximumWindowUsagePercent}) => {
        test(`calculates maximumWindowUsagePercent correctly with dynamic: ${
            dynamicPercent * 100
        }% and weekly: ${weeklyPercent * 100}%`, async () => {
            const currentTimestamp = Date.now();
            const accountId = "test_account" as AccountId;
            const windowStartTime = currentTimestamp - 1000;
            const dynamicLimit = agentUsageWindowLimit.dynamic.limitDollars * 100 * 1000; // in millicents
            const weeklyLimit = agentUsageWindowLimit.weekly.limitDollars * 100 * 1000; // in millicents

            // Set dynamic window to 30% usage and weekly window to 60% usage
            const dynamicUsage = dynamicLimit * dynamicPercent;
            const weeklyUsage = weeklyLimit * weeklyPercent;

            // Mock existing window
            mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(windowStartTime);

            // Mock different usage amounts for each call
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp
                .mockResolvedValueOnce(BigInt(weeklyUsage)) // Weekly window check (first call)
                .mockResolvedValueOnce(BigInt(dynamicUsage)); // Dynamic window check (second call)

            const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
                accountId,
                currentTimestamp,
            });

            assert(result.ok);
            expect(result.maximumWindowUsagePercent).toBe(expectedMaximumWindowUsagePercent);
        });
    });

    [
        {
            description: "6 days until reset",
            mockTime: "2024-01-15T00:00:00.000Z", // Monday
            expectedMessage: "You’ve asked a lot! Please ask again in 6 days.",
        },
        {
            description: "3 days until reset",
            mockTime: "2024-01-18T00:00:00.000Z", // Thursday
            expectedMessage: "You’ve asked a lot! Please ask again in 3 days.",
        },
        {
            description: "1 day until reset",
            mockTime: "2024-01-20T00:00:00.000Z", // Saturday
            expectedMessage: "You’ve asked a lot! Please ask again in 1 day.",
        },
        {
            description: "20 hours until reset",
            mockTime: "2024-01-20T04:00:00.000Z", // Saturday 4 AM
            expectedMessage: "You’ve asked a lot! Please ask again in 20 hours.",
        },
        {
            description: "1 hour until reset",
            mockTime: "2024-01-20T23:00:00.000Z", // Saturday 11 PM
            expectedMessage: "You’ve asked a lot! Please ask again in 1 hour.",
        },
    ].forEach(({description, mockTime, expectedMessage}) => {
        test(`blocks requests when weekly limit is exceeded (${description})`, async () => {
            jest.setSystemTime(new Date(mockTime).getTime());

            const currentTimestamp = Date.now();
            const accountId = "test_account" as AccountId;
            const windowStartTime = currentTimestamp - 1000;
            const weeklyLimit = agentUsageWindowLimit.weekly.limitDollars * 100 * 1000; // in millicents

            // Mock existing window
            mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(windowStartTime);

            // Mock weekly usage over limit (should block immediately without checking dynamic)
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
                BigInt(weeklyLimit + 1000),
            );

            const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
                accountId,
                currentTimestamp,
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.message).toBe(expectedMessage);
            }

            // Should only check weekly limit, not dynamic (since weekly failed first)
            expect(
                mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp,
            ).toHaveBeenCalledTimes(1);
        });
    });

    [
        {
            description: "7 hours until reset",
            windowStartTimeDelta: -1 * 60 * 60 * 1000, // Window started 1 hour ago, 7 hours left in 8-hour window
            expectedMessage: "You’ve asked a lot! Please ask again in 7 hours.",
        },
        {
            description: "1 hour until reset",
            windowStartTimeDelta: -7 * 60 * 60 * 1000, // Window started 7 hours ago, 1 hour left in 8-hour window
            expectedMessage: "You’ve asked a lot! Please ask again in 1 hour.",
        },
        {
            description: "30 minutes until reset",
            windowStartTimeDelta: -(7 * 60 + 30) * 60 * 1000, // Window started 7.5 hours ago, 30 minutes left
            expectedMessage: "You’ve asked a lot! Please ask again in 30 minutes.",
        },
        {
            description: "1 minute until reset",
            windowStartTimeDelta: -(7 * 60 + 59) * 60 * 1000, // Window started 7 hours 59 minutes ago, 1 minute left
            expectedMessage: "You’ve asked a lot! Please ask again in 1 minute.",
        },
    ].forEach(({description, windowStartTimeDelta, expectedMessage}) => {
        test(`blocks requests when dynamic limit is exceeded (${description})`, async () => {
            const currentTimestamp = Date.now();
            const windowStartTime = currentTimestamp + windowStartTimeDelta;

            const accountId = "test_account" as AccountId;
            const dynamicLimit = agentUsageWindowLimit.dynamic.limitDollars * 100 * 1000; // in millicents
            const weeklyLimit = agentUsageWindowLimit.weekly.limitDollars * 100 * 1000; // in millicents

            // Mock existing window
            mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(windowStartTime);

            // Mock weekly under limit, dynamic over limit
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp
                .mockResolvedValueOnce(BigInt(weeklyLimit - 1000)) // Weekly under limit
                .mockResolvedValueOnce(BigInt(dynamicLimit + 1000)); // Dynamic over limit

            const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
                accountId,
                currentTimestamp,
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.message).toBe(expectedMessage);
            }

            // Should check both limits
            expect(
                mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp,
            ).toHaveBeenCalledTimes(2);
        });
    });

    test("resets dynamic window after 8 hours", async () => {
        const currentTimestamp = Date.now();
        const accountId = "test_account" as AccountId;

        // Mock window that's older than 8 hours
        const oldWindowStart = currentTimestamp - (agentUsageWindowLimit.dynamic.durationMs + 1000);
        mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(oldWindowStart);
        mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
            BigInt(0),
        );

        const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
            accountId,
            currentTimestamp,
        });

        expect(result.ok).toBe(true);
        expect(mockAgentUsageDatabase.setWindowStartTimeByAccountId).toHaveBeenCalledWith(
            accountId,
            currentTimestamp,
        );
    });

    test("weekly window is calculated from Sunday 00:00 UTC", async () => {
        const currentTimestamp = Date.now();
        const accountId = "test_account" as AccountId;

        // Mock no existing dynamic window (returns null for dynamic)
        mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(null);

        // Mock setting the new dynamic window start time
        mockAgentUsageDatabase.setWindowStartTimeByAccountId.mockResolvedValue();

        // Mock usage result - only one call for weekly window
        // (dynamic window will skip the DB call since it's a new window with currentTimestamp)
        mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValueOnce(
            BigInt(0),
        ); // Weekly window usage

        const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
            accountId,
            currentTimestamp,
        });

        expect(result.ok).toBe(true);

        // Should call getUsedMillicentsByAccountIdSinceTimestamp once for weekly window
        // (Dynamic window skips DB call since startedAt === currentTimestamp for new windows)
        expect(
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp,
        ).toHaveBeenCalledTimes(1);

        // The call should be for weekly window with a timestamp that's aligned to Sunday
        const weeklyCall =
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mock.calls[0];
        const weeklyStartTime = weeklyCall![1];

        assertStringTimestampEqual(weeklyStartTime, "Sunday, January 14, 2024 at 00:00:00");

        // Should set the dynamic window start time for the new window
        expect(mockAgentUsageDatabase.setWindowStartTimeByAccountId).toHaveBeenCalledWith(
            accountId,
            currentTimestamp,
        );
    });

    describe("alpioneer account behavior", () => {
        test("allows weekly window requests for alpioneer accounts even when over limit", async () => {
            const currentTimestamp = Date.now();
            const accountId = joshKnownAccountId;
            const windowStartTime = currentTimestamp - 1000;
            const weeklyLimit = agentUsageWindowLimit.weekly.limitDollars * 100 * 1000; // in millicents

            // Mock existing window
            mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(windowStartTime);

            // Mock weekly usage OVER limit for alpioneer account
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
                BigInt(weeklyLimit + 1000),
            );

            const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
                accountId,
                currentTimestamp,
            });

            // Should not be blocked even though over limit
            expect(result.ok).toBe(true);
            if (result.ok) {
                // Should still return accurate usage percentage (over 100%)
                expect(result.maximumWindowUsagePercent).toBeGreaterThan(1);
            }

            // Should only check weekly limit, then dynamic (both pass for alpioneers)
            expect(
                mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp,
            ).toHaveBeenCalledTimes(2);
        });

        test("allows dynamic window requests for alpioneer accounts even when over limit", async () => {
            const currentTimestamp = Date.now();
            const accountId = joshKnownAccountId;
            const windowStartTime = currentTimestamp - 1000;
            const dynamicLimit = agentUsageWindowLimit.dynamic.limitDollars * 100 * 1000; // in millicents
            const weeklyLimit = agentUsageWindowLimit.weekly.limitDollars * 100 * 1000; // in millicents

            // Mock existing window
            mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(windowStartTime);

            // Mock weekly under limit, dynamic OVER limit for alpioneer account
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp
                .mockResolvedValueOnce(BigInt(weeklyLimit - 1000)) // Weekly under limit
                .mockResolvedValueOnce(BigInt(dynamicLimit + 1000)); // Dynamic over limit

            const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
                accountId,
                currentTimestamp,
            });

            // Should not be blocked even though dynamic window is over limit
            expect(result.ok).toBe(true);
            if (result.ok) {
                // Should return the higher of the two usage percentages (dynamic is over 100%)
                const weeklyPercent = (weeklyLimit - 1000) / weeklyLimit;
                const dynamicPercent = (dynamicLimit + 1000) / dynamicLimit;
                const expectedMaxPercent = Math.max(weeklyPercent, dynamicPercent);
                expect(result.maximumWindowUsagePercent).toBe(expectedMaxPercent);
                expect(result.maximumWindowUsagePercent).toBeGreaterThan(1);
            }

            // Should check both limits
            expect(
                mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp,
            ).toHaveBeenCalledTimes(2);
        });

        test("allows requests for alpioneer accounts even when both windows are over limit", async () => {
            const currentTimestamp = Date.now();
            const accountId = joshKnownAccountId;
            const windowStartTime = currentTimestamp - 1000;
            const dynamicLimit = agentUsageWindowLimit.dynamic.limitDollars * 100 * 1000; // in millicents
            const weeklyLimit = agentUsageWindowLimit.weekly.limitDollars * 100 * 1000; // in millicents

            // Mock existing window
            mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(windowStartTime);

            // Mock BOTH weekly and dynamic over limit for alpioneer account
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp
                .mockResolvedValueOnce(BigInt(weeklyLimit + 2000)) // Weekly over limit
                .mockResolvedValueOnce(BigInt(dynamicLimit + 3000)); // Dynamic over limit

            const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
                accountId,
                currentTimestamp,
            });

            // Should not be blocked even though both windows are over limit
            expect(result.ok).toBe(true);
            if (result.ok) {
                // Should return the higher of the two usage percentages
                const weeklyPercent = (weeklyLimit + 2000) / weeklyLimit;
                const dynamicPercent = (dynamicLimit + 3000) / dynamicLimit;
                const expectedMaxPercent = Math.max(weeklyPercent, dynamicPercent);
                expect(result.maximumWindowUsagePercent).toBe(expectedMaxPercent);
                expect(result.maximumWindowUsagePercent).toBeGreaterThan(1);
            }

            // Should check both limits
            expect(
                mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp,
            ).toHaveBeenCalledTimes(2);
        });
    });

    test("allows requests when database errors occur (graceful degradation)", async () => {
        const currentTimestamp = Date.now();
        const accountId = "test_account" as AccountId;

        // Mock getWindowStartTimeByAccountId to succeed (returns null for new window)
        mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(null);

        // Mock setWindowStartTimeByAccountId to succeed
        mockAgentUsageDatabase.setWindowStartTimeByAccountId.mockResolvedValue();

        // Mock getUsedMillicentsByAccountIdSinceTimestamp to throw an error
        mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockRejectedValue(
            new UnknownError("Database connection failed"),
        );

        const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
            accountId,
            currentTimestamp,
        });

        // Should allow the request to proceed despite database error
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.maximumWindowUsagePercent).toBe(0);
        }

        // Should have attempted to check usage
        expect(
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp,
        ).toHaveBeenCalled();
    });

    describe("windows reset properly", () => {
        test("weekly window resets after Sunday 00:00 UTC", async () => {
            const accountId = "test_account" as AccountId;
            const weeklyLimit = agentUsageWindowLimit.weekly.limitDollars * 100 * 1000; // in millicents

            // Set time to Saturday 11 PM
            jest.setSystemTime(new Date("2024-01-20T23:00:00.000Z").getTime());

            const initialTimestamp = Date.now();
            const windowStartTime = initialTimestamp - 1000;

            // Mock existing window
            mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(windowStartTime);

            // Mock weekly usage over limit
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
                BigInt(weeklyLimit + 1000),
            );

            // First request should fail
            const failResult = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
                accountId,
                currentTimestamp: initialTimestamp,
            });

            expect(failResult.ok).toBe(false);

            // Advance time to Sunday 1 AM (2 hours later)
            jest.setSystemTime(new Date("2024-01-21T01:00:00.000Z").getTime());

            const resetTimestamp = Date.now();

            // Reset mocks for second call
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
                BigInt(0),
            );

            // Second request should pass after reset
            const passResult = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
                accountId,
                currentTimestamp: resetTimestamp,
            });

            // Our weekly window was reset!
            expect(passResult.ok).toBe(true);

            // Verify the calls to getUsedMillicentsByAccountIdSinceTimestamp
            const calls =
                mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mock.calls;

            // First call should be for weekly window (from previous Sunday)
            expect(calls[0]![0]).toBe(accountId);
            const firstCallTimestamp = calls[0]![1];
            assertStringTimestampEqual(firstCallTimestamp, "Sunday, January 14, 2024 at 00:00:00");

            // Second call should be for weekly window after reset (from Sunday 00:00)
            expect(calls[1]![0]).toBe(accountId);
            const secondCallTimestamp = calls[1]![1];
            assertStringTimestampEqual(secondCallTimestamp, "Sunday, January 21, 2024 at 00:00:00");
        });

        test("dynamic window resets after 8 hours", async () => {
            const accountId = "test_account" as AccountId;
            const dynamicLimit = agentUsageWindowLimit.dynamic.limitDollars * 100 * 1000; // in millicents
            const weeklyLimit = agentUsageWindowLimit.weekly.limitDollars * 100 * 1000; // in millicents

            // Set initial time
            const initialTime = Date.now();
            const windowStartTime = initialTime - 7 * 60 * 60 * 1000; // Window started 7 hours ago

            // Mock existing window
            mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(windowStartTime);

            // Mock weekly under limit, dynamic over limit
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp
                .mockResolvedValueOnce(BigInt(weeklyLimit - 1000)) // Weekly under limit
                .mockResolvedValueOnce(BigInt(dynamicLimit + 1000)); // Dynamic over limit

            // First request should fail
            const failResult = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
                accountId,
                currentTimestamp: initialTime,
            });

            expect(failResult.ok).toBe(false);

            // Advance time by 2 hours (total 9 hours since window start, should trigger reset)
            jest.advanceTimersByTime(2 * 60 * 60 * 1000);

            const resetTimestamp = Date.now();

            // Reset mocks for second call - window should reset
            mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(windowStartTime);
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
                BigInt(0),
            );

            // Second request should pass after reset
            const passResult = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
                accountId,
                currentTimestamp: resetTimestamp,
            });

            expect(passResult.ok).toBe(true);

            // Should have called setWindowStartTimeByAccountId to reset the window
            expect(mockAgentUsageDatabase.setWindowStartTimeByAccountId).toHaveBeenCalledWith(
                accountId,
                resetTimestamp,
            );

            // Verify the calls to getUsedMillicentsByAccountIdSinceTimestamp
            const calls =
                mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mock.calls;

            // First request makes 2 calls: weekly window, then dynamic window
            expect(calls[0]![0]).toBe(accountId);
            const firstWeeklyCallTimestamp = calls[0]![1];
            assertStringTimestampEqual(
                firstWeeklyCallTimestamp,
                "Sunday, January 21, 2024 at 00:00:00",
            );

            expect(calls[1]![0]).toBe(accountId);
            expect(calls[1]![1]).toBe(windowStartTime); // Dynamic window from 7 hours ago

            // Second request makes 1 call: only weekly window (dynamic window skipped since it's new)
            expect(calls[2]![0]).toBe(accountId);
            const secondWeeklyCallTimestamp = calls[2]![1];
            assertStringTimestampEqual(
                secondWeeklyCallTimestamp,
                "Sunday, January 21, 2024 at 00:00:00",
            );
        });
    });
});

describe("recordAgentUsage", () => {
    let currentTime: number;
    const spaceId = "test_space" as SpaceId;
    const provider = "openai";
    const model = "gpt-5.1";

    beforeEach(() => {
        currentTime = Date.now();
        jest.clearAllMocks();
    });

    test("records usage by creating agent request record", async () => {
        const accountId = "test_account" as AccountId;

        await recordAgentUsage(testTracer, mockAgentUsageDatabaseClass, {
            accountId,
            spaceId,
            requestUsedMillicents: 500,
            currentTimestamp: currentTime,
            provider,
            model,
        });

        expect(mockAgentUsageDatabase.createAgentRequest).toHaveBeenCalledWith({
            accountId,
            spaceId,
            traceId: expect.any(String),
            spanId: expect.any(String),
            createdTime: currentTime,
            provider,
            model,
            usedMillicents: 500,
        });
    });

    test("handles fractional millicents by flooring", async () => {
        const accountId = "test_account" as AccountId;

        await recordAgentUsage(testTracer, mockAgentUsageDatabaseClass, {
            accountId,
            spaceId,
            requestUsedMillicents: 500.7,
            currentTimestamp: currentTime,
            provider,
            model,
        });

        expect(mockAgentUsageDatabase.createAgentRequest).toHaveBeenCalledWith({
            accountId,
            spaceId,
            traceId: expect.any(String),
            spanId: expect.any(String),
            createdTime: currentTime,
            provider,
            model,
            usedMillicents: 500, // Should be floored
        });
    });
});
