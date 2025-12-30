import {AgentUsageDatabase} from "~/server/agents/internal/d1/agent_usage_database.js";
import {
    SupportedAgentModels,
    SupportedAgentProviders,
} from "~/server/agents/internal/supported_agent_models.js";
import {alpioneers} from "~/shared/accounts/known_account_ids.js";
import {DataLossError} from "~/shared/error/error.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * Defines the dynamic agent usage window duration and limit in dollars.
 * This is the window that starts when a user sends their first request,
 * or surpasses their previous window duration. After this duration, the
 * window resets and usage is reset.
 */
export const dynamicAgentUsageWindowLimit = {
    durationMs: 8 * 60 * 60 * 1000, // 8 hours
    limitDollars: 1,
};

/**
 * Determines if the usage window should be reset based on its start time and the current timestamp.
 */
function shouldResetWindow(startedAt: number, currentTimestamp: number): boolean {
    const windowDurationMs = dynamicAgentUsageWindowLimit.durationMs;
    return currentTimestamp >= startedAt + windowDurationMs;
}

/**
 * Calculates the time shown to the user of when their agent usage limit will reset.
 */
function calculateVisualTimeUntilReset(windowStart: number, currentTimestamp: number): string {
    const windowEnd = windowStart + dynamicAgentUsageWindowLimit.durationMs;
    const msUntilReset = Math.max(0, windowEnd - currentTimestamp);

    const totalMinutes = msUntilReset / (60 * 1000);
    const hours = totalMinutes / 60;

    if (hours >= 1) {
        const roundedHours = Math.ceil(hours);
        return roundedHours === 1 ? "1 hour" : `${roundedHours} hours`;
    } else {
        const roundedMinutes = Math.max(1, Math.ceil(totalMinutes));
        return roundedMinutes === 1 ? "1 minute" : `${roundedMinutes} minutes`;
    }
}

type CheckAgentLimitResult =
    | {
          ok: true;
          /**
           * The maximum percentage of any usage window that has been used (0.0 - 1.0).
           * For example, if the dynamic window is at 50%, but weekly is at 80%, this will be 0.8.
           */
          maximumWindowUsagePercent: number;
      }
    | {
          ok: false;
          message: string;
      };

/**
 * Verify if an account can make a request based on their agent usage limits.
 */
export async function checkAgentUsageLimit(
    tracer: TracerBase,
    agentUsageDatabase: AgentUsageDatabase,
    params: {
        accountId: AccountId;
        currentTimestamp: number;
    },
): Promise<CheckAgentLimitResult> {
    const {accountId, currentTimestamp} = params;
    return tracer.withSpan(`Check agent limit`, async span => {
        // Place account ID first so we get this data even if an error occurs later
        span.addData({
            agents: {
                request: {
                    accountId,
                },
            },
        });

        const agentWindowLimit = dynamicAgentUsageWindowLimit.limitDollars * 100 * 1000;

        // Get the current window start time (returns currentTimestamp if no window exists)
        const windowStartedAt = await agentUsageDatabase.getWindowStartTimeByAccountId(accountId);

        let currentUsed = BigInt(0);
        let actualWindowStart: number;

        if (!windowStartedAt || shouldResetWindow(windowStartedAt, currentTimestamp)) {
            // Window needs reset - set new start time
            await agentUsageDatabase.setWindowStartTimeByAccountId(accountId, currentTimestamp);

            actualWindowStart = currentTimestamp;

            if (windowStartedAt) {
                span.addData({
                    agents: {
                        request: {
                            usageWindow: {
                                previousStartTime: serializeDateString(new Date(windowStartedAt)),
                                reset: true,
                            },
                        },
                    },
                });
            }
        } else {
            actualWindowStart = windowStartedAt;

            // Window is still active - get current usage by summing agent requests
            currentUsed = await agentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp(
                accountId,
                windowStartedAt,
            );
        }

        span.addData({
            agents: {
                request: {
                    usageWindow: {
                        limitMillicents: agentWindowLimit,
                        usedMillicents: Number(currentUsed),
                        ageMs: currentTimestamp - actualWindowStart,
                        startTime: serializeDateString(new Date(actualWindowStart)),
                    },
                },
            },
        });

        // Check if current usage exceeds limit
        // If we're an alpioneer, we never enforce limits, but still return usage for downgrades
        if (currentUsed > agentWindowLimit && !(accountId in alpioneers)) {
            const timeUntilReset = calculateVisualTimeUntilReset(
                actualWindowStart,
                currentTimestamp,
            );

            span.addData({
                agents: {
                    request: {
                        usageWindow: {
                            exceededLimit: true,
                        },
                    },
                },
            });

            // TODO: finalize messaging and format
            //   https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/18hyw8ssg62c6az1a04sb82gpc
            return {
                ok: false,
                message: `You’ve asked a lot! Please ask again in ${timeUntilReset}.`,
            };
        }

        // TODO(imjoshin): check weekly and monthly limits here
        const maximumWindowUsagePercent = Number(currentUsed) / agentWindowLimit;

        return {ok: true, maximumWindowUsagePercent};
    });
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
