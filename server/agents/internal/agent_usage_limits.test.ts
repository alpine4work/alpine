/* eslint-disable @typescript-eslint/unbound-method */
import {jest} from "@jest/globals";
import {
    checkAgentUsageLimit,
    dynamicAgentUsageWindowLimit,
    recordAgentUsage,
} from "~/server/agents/internal/agent_usage_limits.js";
import {
    AgentUsageDatabase,
    AgentUsageDatabaseInterface,
} from "~/server/agents/internal/d1/agent_usage_database.js";
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

describe("checkAgentUsageLimit", () => {
    let currentTime: number;

    beforeEach(() => {
        currentTime = Date.now();
        jest.clearAllMocks();
    });

    test("allows requests when no window exists (returns current timestamp)", async () => {
        const accountId = "test_account" as AccountId;
        // Mock returns null since no window exists
        mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(null);

        const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
            accountId,
            currentTimestamp: currentTime,
        });

        expect(result.ok).toBe(true);
        expect(mockAgentUsageDatabase.getWindowStartTimeByAccountId).toHaveBeenCalledWith(
            accountId,
        );
    });

    test("allows requests under limit when window exists", async () => {
        const accountId = "test_account" as AccountId;
        const windowStartTime = currentTime - 1000;

        // Mock existing window
        mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(windowStartTime);

        // Mock current usage under limit
        const limit = dynamicAgentUsageWindowLimit.limitDollars * 100 * 1000; // in millicents
        mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
            BigInt(limit - 1000),
        );

        const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
            accountId,
            currentTimestamp: currentTime,
        });

        expect(result.ok).toBe(true);
        expect(
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp,
        ).toHaveBeenCalledWith(accountId, windowStartTime);
    });

    test("calculates maximumWindowUsagePercent correctly", async () => {
        const accountId = "test_account" as AccountId;
        const windowStartTime = currentTime - 1000;
        const limit = dynamicAgentUsageWindowLimit.limitDollars * 100 * 1000; // in millicents
        const usedAmount = limit / 2; // 50% usage

        // Mock existing window
        mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(windowStartTime);

        // Mock current usage at 50% of limit
        mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
            BigInt(usedAmount),
        );

        const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
            accountId,
            currentTimestamp: currentTime,
        });

        assert(result.ok);
        expect(result.maximumWindowUsagePercent).toBe(0.5);
    });

    test("blocks requests over limit", async () => {
        const accountId = "test_account" as AccountId;
        const windowStartTime = currentTime - 1000;
        const limit = dynamicAgentUsageWindowLimit.limitDollars * 100 * 1000; // in millicents

        // Mock existing window
        mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(windowStartTime);

        // Mock current usage over limit
        mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
            BigInt(limit + 1000),
        );

        const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
            accountId,
            currentTimestamp: currentTime,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.message).toBe("You’ve asked a lot! Please ask again in 8 hours.");
        }
    });

    test("resets window after 8 hours", async () => {
        const accountId = "test_account" as AccountId;

        // Mock window that's older than 8 hours
        const oldWindowStart = currentTime - (dynamicAgentUsageWindowLimit.durationMs + 1000);
        mockAgentUsageDatabase.getWindowStartTimeByAccountId.mockResolvedValue(oldWindowStart);

        const result = await checkAgentUsageLimit(testTracer, mockAgentUsageDatabaseClass, {
            accountId,
            currentTimestamp: currentTime,
        });

        expect(result.ok).toBe(true);
        expect(mockAgentUsageDatabase.setWindowStartTimeByAccountId).toHaveBeenCalledWith(
            accountId,
            currentTime,
        );
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
