import {AgentUsageDatabase} from "~/server/agents/internal/d1/agent_usage_database.js";
import {
    AgentUsageWindow,
    AgentUsageWindowType,
    agentUsageWindowTypes,
} from "~/server/agents/internal/d1/agent_usage_schema.js";
import {
    SupportedAgentModels,
    SupportedAgentProviders,
} from "~/server/agents/internal/supported_agent_models.js";
import {alpioneers} from "~/shared/accounts/known_account_ids.js";
import {DataLossError} from "~/shared/error/error.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

type AgentUsageWindowLimit = {
    type: AgentUsageWindowType;
    durationMs: number;
    limitDollarsByEntitlement: {
        default: number;
        withLifetimeAccess: number;
    };
};

/**
 * Defines the dynamic agent usage window duration and limit in dollars.
 * This is the window that starts when a user sends their first request,
 * or surpasses their previous window duration. After this duration, the
 * window resets and usage is reset.
 */
export const agentUsageWindowLimits: Array<AgentUsageWindowLimit> = [
    // Weekly windows are fixed windows that start at the beginning of the week (Sunday 00:00 UTC)
    // and last for 7 days. They do not start at the time of the first request (like dynamic).
    {
        type: "Weekly",
        durationMs: 7 * 24 * 60 * 60 * 1000, // 7 days
        limitDollarsByEntitlement: {
            default: 2,
            withLifetimeAccess: 4,
        },
    },
    // The dynamic window is a rolling 8 hour window. If a user hasn't sent a request in 10 hours,
    // on their next request, a new window will start with an 8 hour timer.
    {
        type: "Dynamic",
        durationMs: 8 * 60 * 60 * 1000, // 8 hours
        limitDollarsByEntitlement: {
            default: 1,
            withLifetimeAccess: 2,
        },
    },
];

// Make sure each window type is represented in limits exactly once.
assert(
    isDeepEqual(
        agentUsageWindowLimits.map(limit => limit.type),
        agentUsageWindowTypes,
    ),
);

export type AgentUsageWindowWithWindowLimitsAndUsedMillicents = AgentUsageWindow & {
    durationMs: number;
    limitDollars: number;
    usedMillicents: number;
};

/**
 * For a given account ID and type, get the current agent usage window.
 * This function will create or reset the window as needed.
 */
async function getOrCreateAgentUsageWindow(
    span: TracerSpan,
    agentUsageDatabase: AgentUsageDatabase,
    {
        windowLimit,
        accountId,
        currentTimestamp,
    }: {
        windowLimit: AgentUsageWindowLimit;
        accountId: AccountId;
        currentTimestamp: number;
    },
): Promise<AgentUsageWindow> {
    switch (windowLimit.type) {
        case "Weekly": {
            const date = new Date(currentTimestamp);

            // Go to 00:00:00.000 UTC of the same day and then back up to Sunday
            date.setUTCHours(0, 0, 0, 0);
            date.setUTCDate(date.getUTCDate() - date.getUTCDay());

            const weekStart = date.getTime();

            // Get or create weekly window
            const existingWindow = await agentUsageDatabase.getWindowByAccountIdAndType(
                accountId,
                windowLimit.type,
            );

            if (existingWindow && existingWindow.startedTime === weekStart) return existingWindow;

            // Create or reset weekly window for this week
            return agentUsageDatabase.setWindowByAccountIdAndType(
                accountId,
                windowLimit.type,
                weekStart,
                false,
            );
        }
        case "Dynamic": {
            const existingWindow = await agentUsageDatabase.getWindowByAccountIdAndType(
                accountId,
                windowLimit.type,
            );

            if (
                existingWindow &&
                currentTimestamp < existingWindow.startedTime + windowLimit.durationMs
            ) {
                return existingWindow;
            }

            // Current time is past the end of the window, so it's time to reset the window
            if (existingWindow) {
                span.addData({
                    agents: {
                        request: {
                            usageWindow: {
                                previousStartedTime: serializeDateString(
                                    new Date(existingWindow.startedTime),
                                ),
                                reset: true,
                            },
                        },
                    },
                });
            }

            // Window needs reset - set new start time and reset downgrade status
            return agentUsageDatabase.setWindowByAccountIdAndType(
                accountId,
                windowLimit.type,
                currentTimestamp,
                false,
            );
        }
        default: {
            throw exhaustive(windowLimit.type);
        }
    }
}

/**
 * Get all agent usage limit windows for an account and current usage.
 * Always returns the windows, creating them if they don't currently exist.
 */
export async function getAgentUsageLimitWindows(
    parentSpan: TracerSpan,
    agentUsageDatabase: AgentUsageDatabase,
    params: {
        accountId: AccountId;
        currentTimestamp: number;
    },
): Promise<Array<AgentUsageWindowWithWindowLimitsAndUsedMillicents>> {
    const {accountId, currentTimestamp} = params;

    const accountEntitlements = await agentUsageDatabase.getAccountEntitlements(accountId);
    const withLifetimeAccess = accountEntitlements?.plan === "LifetimeAccess";

    // NOTE(ifitzsimmons, #ai): We use `Promise.all` here instead of `runAllPromises`
    // because we want to ensure that the windows are created in the correct order.
    return Promise.all(
        agentUsageWindowLimits.map(async windowLimit => {
            const {type} = windowLimit;

            return parentSpan.withSpan(`Get ${type} agent usage limit window`, async span => {
                const window = await getOrCreateAgentUsageWindow(span, agentUsageDatabase, {
                    windowLimit,
                    accountId,
                    currentTimestamp,
                });

                const usedMillicents =
                    window.startedTime === currentTimestamp
                        ? 0
                        : await agentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp(
                              accountId,
                              window.startedTime,
                          );

                span.addData({
                    agents: {
                        request: {
                            usageWindow: {
                                windowType: type,
                                usedMillicents,
                                ageMs: currentTimestamp - window.startedTime,
                                startedTime: serializeDateString(new Date(window.startedTime)),
                            },
                        },
                    },
                });

                return {
                    usedMillicents: usedMillicents,
                    durationMs: windowLimit.durationMs,
                    limitDollars: withLifetimeAccess
                        ? windowLimit.limitDollarsByEntitlement.withLifetimeAccess
                        : windowLimit.limitDollarsByEntitlement.default,
                    ...window,
                };
            });
        }),
    );
}

export function isAgentUsageLimitExceeded(
    accountId: AccountId,
    windows: Array<AgentUsageWindowWithWindowLimitsAndUsedMillicents>,
): {exceeded: false} | {exceeded: true; type: AgentUsageWindowType; resetTime: Date} {
    // Do not enforce hard limits for alpioneers
    if (accountId in alpioneers) {
        return {exceeded: false};
    }

    const exceededWindows: Array<
        AgentUsageWindowWithWindowLimitsAndUsedMillicents & {resetTime: number}
    > = [];

    for (const window of windows) {
        // Get the limit in millicents
        const limitMillicents = window.limitDollars * 100 * 1000;

        if (window.usedMillicents > limitMillicents) {
            exceededWindows.push({
                ...window,
                resetTime: window.startedTime + window.durationMs,
            });
        }
    }

    if (exceededWindows.length === 0) return {exceeded: false};

    // Find the window that triggered this limit and will last the longest
    // For example, if both weekly and dynamic windows triggered the limit,
    // but the dynamic window actually resets after the end of the week, we want
    // to inform the user of the dynamic window reset time.
    const resetWindowData: {
        type: AgentUsageWindowType;
        resetTime: number;
    } | null = exceededWindows.reduce(
        (acc, curr): {type: AgentUsageWindowType; resetTime: number} => {
            if (acc === null) return curr;
            if (curr.resetTime > acc.resetTime) return curr;

            return acc;
        },
        null,
    );
    assert(resetWindowData);

    return {
        exceeded: true,
        resetTime: new Date(resetWindowData.resetTime),
        type: resetWindowData.type,
    };
}

type DowngradeModelForAgentUsageLimitResult =
    | {
          shouldDowngrade: false;
      }
    | ({
          shouldDowngrade: true;
      } & ({shouldAlertUser: false} | {shouldAlertUser: true; resetTime: Date}));

export async function shouldDowngradeModelForAgentUsageLimit(
    agentUsageDatabase: AgentUsageDatabase,
    windows: Array<AgentUsageWindowWithWindowLimitsAndUsedMillicents>,
    downgradeModelAtPercent: number,
): Promise<DowngradeModelForAgentUsageLimitResult> {
    const triggeredByWindows: Array<AgentUsageWindow & {resetTime: number}> = [];

    for (const window of windows) {
        // Get the limit in millicents
        const limitMillicents = window.limitDollars * 100 * 1000;

        if (window.usedMillicents / limitMillicents >= downgradeModelAtPercent) {
            triggeredByWindows.push({
                ...window,
                resetTime: window.startedTime + window.durationMs,
            });
        }
    }

    if (triggeredByWindows.length === 0) return {shouldDowngrade: false};

    // If the window wasn't previously marked as downgraded in the DB, mark it as such now.
    await runAllPromises(
        filterMapArray(triggeredByWindows, async window => {
            if (window.wasModelDowngraded) return null;

            return agentUsageDatabase.downgradeModelForWindow(window.accountId, window.type);
        }),
    );

    // NOTE(ifitzsimmons, #ai): If the user has already been downgraded for this window,
    // we do not continue to alert them that they've been downgraded. We only alert them
    // the first time that they exceed the downgrade threshold.
    const shouldAlertUser = triggeredByWindows.some(window => !window.wasModelDowngraded);

    if (!shouldAlertUser) {
        return {
            shouldDowngrade: true,
            shouldAlertUser: false,
        };
    }

    return {
        shouldDowngrade: true,
        shouldAlertUser: true,
        // Find the window that triggered this downgrade and will last the longest
        // For example, if both weekly and dynamic windows triggered the downgrade,
        // but the dynamic window actually resets after the end of the week, we want
        // to inform the user of the dynamic window reset time.
        resetTime: new Date(Math.max(...triggeredByWindows.map(window => window.resetTime))),
    };
}

/**
 * Record actual usage after successful agent request completion.
 */
export async function recordAgentUsage<SupportedAgentProvider extends SupportedAgentProviders>(
    tracer: TracerBase,
    agentUsageDatabase: AgentUsageDatabase,
    params: {
        accountId: AccountId;
        spaceId: SpaceId;
        requestUsedMillicents: number;
        currentTimestamp: number;
        provider: SupportedAgentProvider;
        model: SupportedAgentModels[SupportedAgentProvider];
    },
): Promise<void> {
    const {accountId, spaceId, requestUsedMillicents, currentTimestamp, provider, model} = params;
    return tracer.withSpan(`Record agent usage`, async span => {
        span.addData({
            agents: {
                request: {
                    accountId,
                    usedMillicents: Math.floor(requestUsedMillicents),
                },
            },
        });

        try {
            // Create agent request record - this is the only storage we need
            await agentUsageDatabase.createAgentRequest({
                accountId,
                spaceId,
                traceId: span.traceId,
                spanId: span._getSpanId(),
                createdTime: currentTimestamp,
                provider,
                model,
                usedMillicents: Math.floor(requestUsedMillicents),
            });
        } catch (error) {
            // We've already allowed the agent request to proceed at this point
            // so we might as well follow through and just log the error.
            span.addException(new DataLossError("Failed to record agent usage", {cause: error}));
        }
    });
}
