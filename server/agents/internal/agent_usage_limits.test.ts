/* eslint-disable @typescript-eslint/unbound-method */
import {jest} from "@jest/globals";
import {
    AgentUsageWindowWithWindowLimitsAndUsedMillicents,
    agentUsageWindowLimits,
    getAgentUsageLimitWindows,
    isAgentUsageLimitExceeded,
    recordAgentUsage,
    shouldDowngradeModelForAgentUsageLimit,
} from "~/server/agents/internal/agent_usage_limits.js";
import {
    AgentUsageDatabase,
    AgentUsageDatabaseInterface,
} from "~/server/agents/internal/d1/agent_usage_database.js";
import {AgentUsageWindowType} from "~/server/agents/internal/d1/agent_usage_schema.js";
import {alpioneers, joshKnownAccountId} from "~/shared/accounts/known_account_ids.js";
import {UnknownError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const mockAgentUsageDatabase: jest.Mocked<AgentUsageDatabaseInterface> = {
    createAgentRequest: jest.fn(),
    getUsedMillicentsByAccountIdSinceTimestamp: jest.fn(),
    getWindowByAccountIdAndType: jest.fn(),
    setWindowByAccountIdAndType: jest.fn(),
    downgradeModelForWindow: jest.fn(),
};

const mockAgentUsageDatabaseClass = mockAgentUsageDatabase as unknown as AgentUsageDatabase;

const dynamicWindowLimit = agentUsageWindowLimits.find(limit => limit.type === "Dynamic")!;
const weeklyWindowLimit = agentUsageWindowLimits.find(limit => limit.type === "Weekly")!;

function intoUsageWindowWithWindowLimitsAndUsedMillicents(
    accountId: AccountId,
    windows: Array<{
        type: AgentUsageWindowType;
        startedTime: number;
        usedMillicents: number;
        wasModelDowngraded: boolean;
    }>,
): Array<AgentUsageWindowWithWindowLimitsAndUsedMillicents> {
    return windows.map(window => {
        const windowLimit = agentUsageWindowLimits.find(limit => limit.type === window.type)!;
        return {
            ...window,
            accountId,
            durationMs: windowLimit.durationMs,
            limitDollars: windowLimit.limitDollars,
        };
    });
}

describe("getAgentUsageLimitWindows", () => {
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

    test("returns windows with current usage for both window types", async () => {
        const currentTimestamp = Date.now();
        const accountId = "test_account" as AccountId;

        // Calculate the correct Sunday start time for the current week
        const currentDate = new Date(currentTimestamp);
        currentDate.setUTCHours(0, 0, 0, 0);
        currentDate.setUTCDate(currentDate.getUTCDate() - currentDate.getUTCDay());
        const weeklyStartTime = currentDate.getTime();

        const dynamicStartTime = currentTimestamp - 2 * 60 * 60 * 1000; // 2 hours ago

        // Mock existing windows
        mockAgentUsageDatabase.getWindowByAccountIdAndType
            .mockResolvedValueOnce({
                accountId,
                type: "Weekly",
                startedTime: weeklyStartTime,
                wasModelDowngraded: false,
            }) // weekly
            .mockResolvedValueOnce({
                accountId,
                type: "Dynamic",
                startedTime: dynamicStartTime,
                wasModelDowngraded: true,
            }); // dynamic

        // Mock usage amounts
        mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp
            .mockResolvedValueOnce(15000) // weekly usage
            .mockResolvedValueOnce(8000); // dynamic usage

        const result = await testTracer.withSpan("test", async span =>
            getAgentUsageLimitWindows(span, mockAgentUsageDatabaseClass, {
                accountId,
                currentTimestamp,
            }),
        );

        expect(result).toEqual(
            intoUsageWindowWithWindowLimitsAndUsedMillicents(accountId, [
                {
                    type: "Weekly",
                    startedTime: weeklyStartTime,
                    usedMillicents: 15000,
                    wasModelDowngraded: false,
                },
                {
                    type: "Dynamic",
                    startedTime: dynamicStartTime,
                    usedMillicents: 8000,
                    wasModelDowngraded: true,
                },
            ]),
        );
    });

    test("handles new windows with zero usage", async () => {
        const currentTimestamp = new Date("2025-12-30T12:00:00.000Z").getTime();
        const accountId = "test_account" as AccountId;

        // Mock no existing windows (new account)
        mockAgentUsageDatabase.getWindowByAccountIdAndType.mockResolvedValue(null);

        // Mock usage query - weekly window will query since it starts at Sunday, dynamic won't since it starts now
        mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(0);

        mockAgentUsageDatabase.setWindowByAccountIdAndType.mockResolvedValueOnce({
            accountId,
            type: "Weekly",
            startedTime: new Date("2025-12-28T00:00:00.000Z").getTime(),
            wasModelDowngraded: false,
        });
        mockAgentUsageDatabase.setWindowByAccountIdAndType.mockResolvedValueOnce({
            accountId,
            type: "Dynamic",
            startedTime: currentTimestamp,
            wasModelDowngraded: false,
        });

        const result = await testTracer.withSpan("test", async span =>
            getAgentUsageLimitWindows(span, mockAgentUsageDatabaseClass, {
                accountId,
                currentTimestamp,
            }),
        );

        expect(result).toEqual(
            intoUsageWindowWithWindowLimitsAndUsedMillicents(accountId, [
                {
                    type: "Weekly",
                    startedTime: new Date("2025-12-28T00:00:00.000Z").getTime(),
                    usedMillicents: 0,
                    wasModelDowngraded: false,
                },
                {
                    type: "Dynamic",
                    startedTime: currentTimestamp,
                    usedMillicents: 0,
                    wasModelDowngraded: false,
                },
            ]),
        );
    });

    describe("weekly window reset scenarios", () => {
        const testCases = [
            {
                description: "resets window when current week is different from stored week",
                currentTime: "2024-01-21T10:00:00.000Z", // Next Sunday
                storedWeekStart: new Date("2024-01-14T00:00:00.000Z").getTime(), // Previous Sunday
                expectedNewWeekStart: new Date("2024-01-21T00:00:00.000Z").getTime(),
                shouldReset: true,
            },
            {
                description: "preserves window when in same week",
                currentTime: "2024-01-19T15:00:00.000Z", // Friday same week
                storedWeekStart: new Date("2024-01-14T00:00:00.000Z").getTime(), // Current week Sunday
                expectedNewWeekStart: new Date("2024-01-14T00:00:00.000Z").getTime(),
                shouldReset: false,
            },
        ];

        testCases.forEach(
            ({description, currentTime, storedWeekStart, expectedNewWeekStart, shouldReset}) => {
                test(`weekly window reset: ${description}`, async () => {
                    const currentTimestamp = new Date(currentTime).getTime();
                    const accountId = "test_account" as AccountId;

                    // Mock existing weekly window with stored week start
                    mockAgentUsageDatabase.getWindowByAccountIdAndType
                        .mockResolvedValueOnce({
                            accountId,
                            type: "Weekly",
                            startedTime: storedWeekStart,
                            wasModelDowngraded: false,
                        })
                        .mockResolvedValueOnce(null); // dynamic (new)

                    mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
                        5000,
                    );

                    if (shouldReset) {
                        mockAgentUsageDatabase.setWindowByAccountIdAndType.mockResolvedValueOnce({
                            accountId,
                            type: "Weekly",
                            startedTime: expectedNewWeekStart,
                            wasModelDowngraded: false,
                        });
                    }

                    mockAgentUsageDatabase.setWindowByAccountIdAndType.mockResolvedValueOnce({
                        accountId,
                        type: "Dynamic",
                        startedTime: currentTimestamp,
                        wasModelDowngraded: false,
                    });

                    const result = await testTracer.withSpan("test", async span =>
                        getAgentUsageLimitWindows(span, mockAgentUsageDatabaseClass, {
                            accountId,
                            currentTimestamp,
                        }),
                    );
                    expect(result).toEqual(
                        intoUsageWindowWithWindowLimitsAndUsedMillicents(accountId, [
                            {
                                type: "Weekly",
                                startedTime: expectedNewWeekStart,
                                usedMillicents: 5000,
                                wasModelDowngraded: false,
                            },
                            {
                                type: "Dynamic",
                                startedTime: currentTimestamp,
                                usedMillicents: 0,
                                wasModelDowngraded: false,
                            },
                        ]),
                    );
                });
            },
        );
    });

    describe("dynamic window reset scenarios", () => {
        const testCases = [
            {
                description: "resets window when duration has passed",
                windowAge: dynamicWindowLimit.durationMs + 1000, // 1 second past 8 hours
                shouldReset: true,
            },
            {
                description: "preserves window when duration has not passed",
                windowAge: dynamicWindowLimit.durationMs - 1000, // 1 second before 8 hours
                shouldReset: false,
            },
            {
                description: "resets window when exactly at duration limit",
                windowAge: dynamicWindowLimit.durationMs,
                shouldReset: true,
            },
        ];

        testCases.forEach(({description, windowAge, shouldReset}) => {
            test(`dynamic window reset: ${description}`, async () => {
                const currentTimestamp = new Date("2025-12-30T12:00:00.000Z").getTime(); // Tuesday
                const weeklyStartTime = new Date("2025-12-28T00:00:00.000Z").getTime(); // Sunday
                const dynamicStartTime = currentTimestamp - windowAge;

                const accountId = "test_account" as AccountId;

                mockAgentUsageDatabase.getWindowByAccountIdAndType
                    .mockResolvedValueOnce({
                        startedTime: weeklyStartTime,
                        wasModelDowngraded: false,
                        accountId,
                        type: "Weekly",
                    })
                    .mockResolvedValueOnce({
                        startedTime: dynamicStartTime,
                        wasModelDowngraded: false,
                        accountId,
                        type: "Dynamic",
                    });

                mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
                    3000,
                );

                if (shouldReset) {
                    mockAgentUsageDatabase.setWindowByAccountIdAndType.mockResolvedValueOnce({
                        accountId,
                        type: "Dynamic",
                        startedTime: currentTimestamp,
                        wasModelDowngraded: false,
                    });
                }

                const result = await testTracer.withSpan("test", async span =>
                    getAgentUsageLimitWindows(span, mockAgentUsageDatabaseClass, {
                        accountId,
                        currentTimestamp,
                    }),
                );

                if (shouldReset) {
                    expect(result).toEqual(
                        intoUsageWindowWithWindowLimitsAndUsedMillicents(accountId, [
                            {
                                type: "Weekly",
                                startedTime: weeklyStartTime,
                                usedMillicents: 3000,
                                wasModelDowngraded: false,
                            },
                            {
                                type: "Dynamic",
                                startedTime: currentTimestamp,
                                usedMillicents: 0,
                                wasModelDowngraded: false,
                            },
                        ]),
                    );
                    expect(mockAgentUsageDatabase.setWindowByAccountIdAndType).toHaveBeenCalledWith(
                        accountId,
                        "Dynamic",
                        currentTimestamp,
                        false,
                    );
                } else {
                    expect(result).toEqual(
                        intoUsageWindowWithWindowLimitsAndUsedMillicents(accountId, [
                            {
                                type: "Weekly",
                                startedTime: weeklyStartTime,
                                usedMillicents: 3000,
                                wasModelDowngraded: false,
                            },
                            {
                                type: "Dynamic",
                                startedTime: dynamicStartTime,
                                usedMillicents: 3000,
                                wasModelDowngraded: false,
                            },
                        ]),
                    );
                    expect(
                        mockAgentUsageDatabase.setWindowByAccountIdAndType,
                    ).not.toHaveBeenCalled();
                }
            });
        });
    });

    test("handles database errors gracefully", async () => {
        const currentTimestamp = new Date("2025-12-30T12:00:00.000Z").getTime(); // Tuesday
        const weeklyStartTime = new Date("2025-12-28T00:00:00.000Z").getTime(); // Sunday

        const accountId = "test_account" as AccountId;

        // Mock first window call to succeed, second to fail
        mockAgentUsageDatabase.getWindowByAccountIdAndType
            .mockResolvedValueOnce({
                startedTime: weeklyStartTime,
                wasModelDowngraded: false,
                accountId,
                type: "Weekly",
            })
            .mockRejectedValueOnce(new UnknownError("Database error"));

        // Should not throw, but may have incomplete results
        await expect(
            testTracer.withSpan("test", async span =>
                getAgentUsageLimitWindows(span, mockAgentUsageDatabaseClass, {
                    accountId,
                    currentTimestamp,
                }),
            ),
        ).rejects.toThrow("Database error");
    });
});

describe("isAgentUsageLimitExceeded", () => {
    const accountId = "test_account" as AccountId;
    const alpioneerAccountId = joshKnownAccountId;

    beforeAll(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2024-01-17T12:00:00.000Z").getTime());
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    const twoHoursAfterDynamicWindowStart = new Date("2025-12-30T12:00:00.000Z").getTime(); // Tuesday
    const weeklyStartTime = new Date("2025-12-28T00:00:00.000Z").getTime(); // Sunday
    const nextWeekWeeklyStartTime = new Date("2026-01-04T00:00:00.000Z").getTime(); // Next Sunday
    const dynamicStartTime = twoHoursAfterDynamicWindowStart - 2 * 60 * 60 * 1000; // 2 hours ago

    const createWindows = (params: {
        weekly: {usage: number; wasModelDowngraded?: boolean};
        dynamic: {usage: number; wasModelDowngraded?: boolean};
    }): Array<AgentUsageWindowWithWindowLimitsAndUsedMillicents> => [
        {
            accountId,
            type: "Weekly",
            startedTime: weeklyStartTime,
            usedMillicents: params.weekly.usage,
            wasModelDowngraded: params.weekly.wasModelDowngraded ?? false,
            durationMs: weeklyWindowLimit.durationMs,
            limitDollars: weeklyWindowLimit.limitDollars,
        },
        {
            accountId,
            type: "Dynamic",
            startedTime: dynamicStartTime,
            usedMillicents: params.dynamic.usage,
            wasModelDowngraded: params.dynamic.wasModelDowngraded ?? false,
            durationMs: dynamicWindowLimit.durationMs,
            limitDollars: dynamicWindowLimit.limitDollars,
        },
    ];

    describe("limit not exceeded scenarios", () => {
        const testCases = [
            {
                description: "both windows under limits",
                weeklyUsage: weeklyWindowLimit.limitDollars * 100 * 1000 - 1000,
                dynamicUsage: dynamicWindowLimit.limitDollars * 100 * 1000 - 500,
            },
            {
                description: "both windows at zero usage",
                weeklyUsage: 0,
                dynamicUsage: 0,
            },
            {
                description: "one window at exact limit (not exceeded)",
                weeklyUsage: weeklyWindowLimit.limitDollars * 100 * 1000,
                dynamicUsage: dynamicWindowLimit.limitDollars * 100 * 1000 - 500,
            },
        ];

        testCases.forEach(({description, weeklyUsage, dynamicUsage}) => {
            test(`limit not exceeded: ${description}`, () => {
                const windows = createWindows({
                    weekly: {usage: weeklyUsage},
                    dynamic: {usage: dynamicUsage},
                });
                const result = isAgentUsageLimitExceeded(accountId, windows);
                expect(result).toEqual({exceeded: false});
            });
        });
    });

    describe("limit exceeded scenarios", () => {
        test("weekly window exceeds limit", () => {
            const weeklyLimit = weeklyWindowLimit.limitDollars * 100 * 1000;
            const dynamicLimit = dynamicWindowLimit.limitDollars * 100 * 1000;
            const windows = createWindows({
                weekly: {usage: weeklyLimit + 1000},
                dynamic: {usage: dynamicLimit - 500},
            });

            const result = isAgentUsageLimitExceeded(accountId, windows);

            expect(result).toEqual({
                exceeded: true,
                type: "Weekly",
                resetTime: new Date(nextWeekWeeklyStartTime),
            });
        });

        test("dynamic window exceeds limit", () => {
            const weeklyLimit = weeklyWindowLimit.limitDollars * 100 * 1000;
            const dynamicLimit = dynamicWindowLimit.limitDollars * 100 * 1000;
            const windows = createWindows({
                weekly: {usage: weeklyLimit - 500},
                dynamic: {usage: dynamicLimit + 1000},
            });

            const result = isAgentUsageLimitExceeded(accountId, windows);

            expect(result).toEqual({
                exceeded: true,
                type: "Dynamic",
                // 8 hours from start of window
                resetTime: new Date(dynamicStartTime + dynamicWindowLimit.durationMs),
            });
        });

        test("both windows exceed limits - returns window with furthest reset time", () => {
            const weeklyLimit = weeklyWindowLimit.limitDollars * 100 * 1000;
            const dynamicLimit = dynamicWindowLimit.limitDollars * 100 * 1000;
            const windows = createWindows({
                weekly: {usage: weeklyLimit + 1000},
                dynamic: {usage: dynamicLimit + 1000},
            });

            const result = isAgentUsageLimitExceeded(accountId, windows);

            // Weekly window lasts 7 days, dynamic lasts 8 hours, so weekly should be returned
            expect(result).toEqual({
                exceeded: true,
                type: "Weekly",
                resetTime: new Date(nextWeekWeeklyStartTime),
            });
        });

        test("both windows exceed limits but dynamic resets later than weekly end", () => {
            const weeklyLimit = weeklyWindowLimit.limitDollars * 100 * 1000;
            const dynamicLimit = dynamicWindowLimit.limitDollars * 100 * 1000;

            // Create scenario where dynamic window was started later and will reset after weekly ends
            const dynamicStartTime = nextWeekWeeklyStartTime - 6 * 60 * 60 * 1000; // 6 hours ago
            const windows: Array<AgentUsageWindowWithWindowLimitsAndUsedMillicents> = [
                {
                    accountId,
                    type: "Weekly",
                    startedTime: weeklyStartTime, // Started 6 days ago, ends in 1 day
                    usedMillicents: weeklyLimit + 1000,
                    wasModelDowngraded: false,
                    durationMs: weeklyWindowLimit.durationMs,
                    limitDollars: weeklyWindowLimit.limitDollars,
                },
                {
                    accountId,
                    type: "Dynamic",
                    startedTime: dynamicStartTime, // Started 2 hours ago before weekly window ends
                    usedMillicents: dynamicLimit + 1000,
                    wasModelDowngraded: false,
                    durationMs: dynamicWindowLimit.durationMs,
                    limitDollars: dynamicWindowLimit.limitDollars,
                },
            ];

            const result = isAgentUsageLimitExceeded(accountId, windows);

            expect(result).toEqual({
                exceeded: true,
                type: "Dynamic",
                resetTime: new Date(dynamicStartTime + dynamicWindowLimit.durationMs),
            });
        });
    });

    describe("alpioneer account behavior", () => {
        test("never exceeds limits for alpioneer accounts", () => {
            const weeklyLimit = weeklyWindowLimit.limitDollars * 100 * 1000;
            const dynamicLimit = dynamicWindowLimit.limitDollars * 100 * 1000;
            const windows = createWindows({
                weekly: {usage: weeklyLimit * 10}, // Way over limits
                dynamic: {usage: dynamicLimit * 10},
            });

            const result = isAgentUsageLimitExceeded(alpioneerAccountId, windows);

            expect(result).toEqual({exceeded: false});
        });

        test("works with any alpioneer account", () => {
            const anotherAlpioneer = Object.keys(alpioneers)[1] as AccountId;
            const weeklyLimit = weeklyWindowLimit.limitDollars * 100 * 1000;
            const dynamicLimit = dynamicWindowLimit.limitDollars * 100 * 1000;
            const windows = createWindows({
                weekly: {usage: weeklyLimit * 5},
                dynamic: {usage: dynamicLimit * 5},
            });

            const result = isAgentUsageLimitExceeded(anotherAlpioneer, windows);

            expect(result).toEqual({exceeded: false});
        });
    });
});

describe("shouldDowngradeModelForAgentUsageLimit", () => {
    const accountId = generateId<AccountId>();

    beforeAll(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2024-01-17T12:00:00.000Z").getTime());
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    const twoHoursAfterDynamicWindowStart = new Date("2025-12-30T12:00:00.000Z").getTime(); // Tuesday
    const weeklyStartTime = new Date("2025-12-28T00:00:00.000Z").getTime(); // Sunday
    const dynamicStartTime = twoHoursAfterDynamicWindowStart - 2 * 60 * 60 * 1000; // 2 hours ago

    const createWindows = (params: {
        weekly: {usage: number; wasModelDowngraded?: boolean};
        dynamic: {usage: number; wasModelDowngraded?: boolean};
    }): Array<AgentUsageWindowWithWindowLimitsAndUsedMillicents> => [
        {
            accountId,
            type: "Weekly",
            startedTime: weeklyStartTime,
            usedMillicents: params.weekly.usage,
            wasModelDowngraded: params.weekly.wasModelDowngraded ?? false,
            durationMs: weeklyWindowLimit.durationMs,
            limitDollars: weeklyWindowLimit.limitDollars,
        },
        {
            accountId,
            type: "Dynamic",
            startedTime: dynamicStartTime,
            usedMillicents: params.dynamic.usage,
            wasModelDowngraded: params.dynamic.wasModelDowngraded ?? false,
            durationMs: dynamicWindowLimit.durationMs,
            limitDollars: dynamicWindowLimit.limitDollars,
        },
    ];

    describe("no downgrade scenarios", () => {
        const testCases = [
            {
                description: "both windows under downgrade threshold",
                weeklyPercent: 0.5, // 50%
                dynamicPercent: 0.6, // 60%
                downgradeThreshold: 0.75,
            },
            {
                description: "one window just below threshold",
                weeklyPercent: 0.74, // Just below threshold
                dynamicPercent: 0.5,
                downgradeThreshold: 0.75,
            },
            {
                description: "zero usage",
                weeklyPercent: 0,
                dynamicPercent: 0,
                downgradeThreshold: 0.5,
            },
        ];

        testCases.forEach(({description, weeklyPercent, dynamicPercent, downgradeThreshold}) => {
            test(`no downgrade: ${description}`, async () => {
                const weeklyLimit = weeklyWindowLimit.limitDollars * 100 * 1000;
                const dynamicLimit = dynamicWindowLimit.limitDollars * 100 * 1000;
                const windows = createWindows({
                    weekly: {usage: weeklyLimit * weeklyPercent},
                    dynamic: {usage: dynamicLimit * dynamicPercent},
                });

                const result = await shouldDowngradeModelForAgentUsageLimit(
                    mockAgentUsageDatabaseClass,
                    windows,
                    downgradeThreshold,
                );

                expect(result).toEqual({shouldDowngrade: false});
            });
        });
    });

    describe("downgrade scenarios", () => {
        test("weekly window exceeds threshold - first time downgrade", async () => {
            const weeklyLimit = weeklyWindowLimit.limitDollars * 100 * 1000;
            const dynamicLimit = dynamicWindowLimit.limitDollars * 100 * 1000;
            const windows = createWindows({
                weekly: {usage: weeklyLimit * 0.8, wasModelDowngraded: false}, // Above 75%, not previously downgraded
                dynamic: {usage: dynamicLimit * 0.5}, // Below 75%
            });

            const result = await shouldDowngradeModelForAgentUsageLimit(
                mockAgentUsageDatabaseClass,
                windows,
                0.75,
            );

            expect(result).toEqual({
                shouldDowngrade: true,
                shouldAlertUser: true,
                resetTime: new Date(weeklyStartTime + weeklyWindowLimit.durationMs),
            });
            expect(mockAgentUsageDatabase.downgradeModelForWindow).toHaveBeenCalledWith(
                accountId,
                "Weekly",
            );
        });

        test("dynamic window exceeds threshold - first time downgrade", async () => {
            const weeklyLimit = weeklyWindowLimit.limitDollars * 100 * 1000;
            const dynamicLimit = dynamicWindowLimit.limitDollars * 100 * 1000;
            const windows = createWindows({
                weekly: {usage: weeklyLimit * 0.5}, // Below 75%
                dynamic: {usage: dynamicLimit * 0.9, wasModelDowngraded: false}, // Above 75%, not previously downgraded
            });

            const result = await shouldDowngradeModelForAgentUsageLimit(
                mockAgentUsageDatabaseClass,
                windows,
                0.75,
            );

            expect(result).toEqual({
                shouldDowngrade: true,
                shouldAlertUser: true,
                resetTime: new Date(dynamicStartTime + dynamicWindowLimit.durationMs),
            });
            expect(mockAgentUsageDatabase.downgradeModelForWindow).toHaveBeenCalledWith(
                accountId,
                "Dynamic",
            );
        });

        test("both windows exceed threshold - first time downgrade", async () => {
            const weeklyLimit = weeklyWindowLimit.limitDollars * 100 * 1000;
            const dynamicLimit = dynamicWindowLimit.limitDollars * 100 * 1000;
            const windows = createWindows({
                weekly: {usage: weeklyLimit * 0.8, wasModelDowngraded: false}, // Above 75%, not previously downgraded
                dynamic: {usage: dynamicLimit * 0.85, wasModelDowngraded: false}, // Above 75%, not previously downgraded
            });

            const result = await shouldDowngradeModelForAgentUsageLimit(
                mockAgentUsageDatabaseClass,
                windows,
                0.75,
            );

            expect(result).toEqual({
                shouldDowngrade: true,
                shouldAlertUser: true,
                resetTime: new Date(weeklyStartTime + weeklyWindowLimit.durationMs),
            });
            expect(mockAgentUsageDatabase.downgradeModelForWindow).toHaveBeenCalledWith(
                accountId,
                "Weekly",
            );
            expect(mockAgentUsageDatabase.downgradeModelForWindow).toHaveBeenCalledWith(
                accountId,
                "Dynamic",
            );
        });

        test("already downgraded window exceeds threshold - no alert", async () => {
            const weeklyLimit = weeklyWindowLimit.limitDollars * 100 * 1000;
            const dynamicLimit = dynamicWindowLimit.limitDollars * 100 * 1000;
            const windows = createWindows({
                weekly: {usage: weeklyLimit * 0.8, wasModelDowngraded: true}, // Above 75%, already downgraded
                dynamic: {usage: dynamicLimit * 0.5}, // Below 75%
            });

            const result = await shouldDowngradeModelForAgentUsageLimit(
                mockAgentUsageDatabaseClass,
                windows,
                0.75,
            );

            expect(result).toEqual({
                shouldDowngrade: true,
                shouldAlertUser: false,
            });
            expect(mockAgentUsageDatabase.downgradeModelForWindow).not.toHaveBeenCalled();
        });

        test("mixed downgrade states - alert only for new downgrades", async () => {
            const weeklyLimit = weeklyWindowLimit.limitDollars * 100 * 1000;
            const dynamicLimit = dynamicWindowLimit.limitDollars * 100 * 1000;
            const windows = createWindows({
                weekly: {usage: weeklyLimit * 0.8, wasModelDowngraded: true}, // Above 75%, already downgraded
                dynamic: {usage: dynamicLimit * 0.85, wasModelDowngraded: false}, // Above 75%, not previously downgraded
            });

            const result = await shouldDowngradeModelForAgentUsageLimit(
                mockAgentUsageDatabaseClass,
                windows,
                0.75,
            );

            expect(result).toEqual({
                shouldDowngrade: true,
                shouldAlertUser: true, // Because dynamic needs first-time alert
                resetTime: new Date(weeklyStartTime + weeklyWindowLimit.durationMs),
            });
            expect(mockAgentUsageDatabase.downgradeModelForWindow).toHaveBeenCalledTimes(1);
            expect(mockAgentUsageDatabase.downgradeModelForWindow).toHaveBeenCalledWith(
                accountId,
                "Dynamic",
            );
        });

        test("both already downgraded - no alert", async () => {
            const weeklyLimit = weeklyWindowLimit.limitDollars * 100 * 1000;
            const dynamicLimit = dynamicWindowLimit.limitDollars * 100 * 1000;
            const windows = createWindows({
                weekly: {usage: weeklyLimit * 0.8, wasModelDowngraded: true}, // Above 75%, already downgraded
                dynamic: {usage: dynamicLimit * 0.85, wasModelDowngraded: true}, // Above 75%, already downgraded
            });

            const result = await shouldDowngradeModelForAgentUsageLimit(
                mockAgentUsageDatabaseClass,
                windows,
                0.75,
            );

            expect(result).toEqual({
                shouldDowngrade: true,
                shouldAlertUser: false,
            });
            expect(mockAgentUsageDatabase.downgradeModelForWindow).not.toHaveBeenCalled();
        });
    });

    describe("downgrade threshold edge cases", () => {
        const testCases = [
            {
                description: "exactly at threshold triggers downgrade",
                usagePercent: 0.75,
                threshold: 0.75,
                shouldDowngrade: true,
            },
            {
                description: "just below threshold does not trigger",
                usagePercent: 0.7499,
                threshold: 0.75,
                shouldDowngrade: false,
            },
            {
                description: "100% usage with 90% threshold",
                usagePercent: 1.0,
                threshold: 0.9,
                shouldDowngrade: true,
            },
            {
                description: "very low threshold",
                usagePercent: 0.1,
                threshold: 0.05,
                shouldDowngrade: true,
            },
        ];

        testCases.forEach(({description, usagePercent, threshold, shouldDowngrade}) => {
            test(`downgrade threshold edge case: ${description}`, async () => {
                const weeklyLimit = weeklyWindowLimit.limitDollars * 100 * 1000;
                const windows = createWindows({
                    weekly: {usage: weeklyLimit * usagePercent},
                    dynamic: {usage: 0},
                });

                const result = await shouldDowngradeModelForAgentUsageLimit(
                    mockAgentUsageDatabaseClass,
                    windows,
                    threshold,
                );

                expect(result.shouldDowngrade).toEqual(shouldDowngrade);
            });
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

    describe("successful recording", () => {
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

        test("handles zero usage", async () => {
            const accountId = "test_account" as AccountId;

            await recordAgentUsage(testTracer, mockAgentUsageDatabaseClass, {
                accountId,
                spaceId,
                requestUsedMillicents: 0,
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
                usedMillicents: 0,
            });
        });

        test("handles large usage amounts", async () => {
            const accountId = "test_account" as AccountId;
            const largeAmount = 999999.99;

            await recordAgentUsage(testTracer, mockAgentUsageDatabaseClass, {
                accountId,
                spaceId,
                requestUsedMillicents: largeAmount,
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
                usedMillicents: 999999, // Floored
            });
        });
    });

    describe("error handling", () => {
        test("continues without throwing when database fails", async () => {
            const accountId = "test_account" as AccountId;
            const error = new UnknownError("Database insert failed");

            mockAgentUsageDatabase.createAgentRequest.mockRejectedValue(error);

            // Should not throw - graceful degradation
            await expect(
                recordAgentUsage(testTracer, mockAgentUsageDatabaseClass, {
                    accountId,
                    spaceId,
                    requestUsedMillicents: 500,
                    currentTimestamp: currentTime,
                    provider,
                    model,
                }),
            ).resolves.toBeUndefined();

            expect(mockAgentUsageDatabase.createAgentRequest).toHaveBeenCalled();
        });
    });
});
