import {AgentUsageDatabase} from "~/server/agents/internal/d1/agent_usage_database.js";
import {
    SupportedAgentModels,
    SupportedAgentProviders,
} from "~/server/agents/internal/supported_agent_models.js";
import {alpioneers} from "~/shared/accounts/known_account_ids.js";
import {DataLossError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Defines the dynamic agent usage window duration and limit in dollars.
 * This is the window that starts when a user sends their first request,
 * or surpasses their previous window duration. After this duration, the
 * window resets and usage is reset.
 */
export const agentUsageWindowLimit = {
    // The dynamic window is a rolling 8 hour window. If a user hasn't sent a request in 10 hours,
    // on their next request, a new window will start with an 8 hour timer.
    dynamic: {
        durationMs: 8 * 60 * 60 * 1000, // 8 hours
        limitDollars: 1,
    },
    // Weekly windows are fixed windows that start at the beginning of the week (Sunday 00:00 UTC)
    // and last for 7 days. They do not start at the time of the first request (like dynamic).
    weekly: {
        durationMs: 7 * 24 * 60 * 60 * 1000, // 7 days
        limitDollars: 2,
    },
};

type AgentUsageWindowType = keyof typeof agentUsageWindowLimit;

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
 * Determines if the usage window should be reset based on its start time and the current timestamp.
 */
function shouldResetWindow(
    type: AgentUsageWindowType,
    windowStartedAt: number,
    currentTimestamp: number,
): boolean {
    const windowDurationMs = agentUsageWindowLimit[type].durationMs;
    return currentTimestamp >= windowStartedAt + windowDurationMs;
}

/**
 * Calculates the time shown to the user of when their agent usage limit will reset.
 */
function calculateVisualTimeUntilReset(
    type: AgentUsageWindowType,
    windowStartedAt: number,
    currentTimestamp: number,
): string {
    const windowEnd = windowStartedAt + agentUsageWindowLimit[type].durationMs;
    const msUntilReset = Math.max(0, windowEnd - currentTimestamp);

    const totalMinutes = msUntilReset / (60 * 1000);
    const hours = totalMinutes / 60;
    const days = hours / 24;

    if (days >= 1) {
        const roundedDays = Math.ceil(days);
        return printPrettyNumber(defaultLocale, roundedDays, "day");
    } else if (hours >= 1) {
        const roundedHours = Math.ceil(hours);
        return printPrettyNumber(defaultLocale, roundedHours, "hour");
    } else {
        const roundedMinutes = Math.max(1, Math.ceil(totalMinutes));
        return printPrettyNumber(defaultLocale, roundedMinutes, "minute");
    }
}

async function getAgentUsageWindowStartedAt(
    span: TracerSpan,
    agentUsageDatabase: AgentUsageDatabase,
    {
        type,
        accountId,
        currentTimestamp,
    }: {type: AgentUsageWindowType; accountId: AccountId; currentTimestamp: number},
): Promise<number> {
    switch (type) {
        case "weekly": {
            const date = new Date(currentTimestamp);

            // Go to 00:00:00.000 UTC of the same day
            date.setUTCHours(0, 0, 0, 0);

            // Back up to Sunday
            date.setUTCDate(date.getUTCDate() - date.getUTCDay());

            return date.getTime();
        }
        case "dynamic": {
            const windowStartedAt = await agentUsageDatabase.getWindowStartTimeByAccountId(
                accountId,
            );

            if (
                !windowStartedAt ||
                shouldResetWindow("dynamic", windowStartedAt, currentTimestamp)
            ) {
                if (windowStartedAt) {
                    span.addData({
                        agents: {
                            request: {
                                usageWindow: {
                                    previousStartTime: serializeDateString(
                                        new Date(windowStartedAt),
                                    ),
                                    reset: true,
                                },
                            },
                        },
                    });
                }

                // Window needs reset - set new start time
                await agentUsageDatabase.setWindowStartTimeByAccountId(accountId, currentTimestamp);
                return currentTimestamp;
            }

            return windowStartedAt;
        }
        default: {
            throw exhaustive(type);
        }
    }
}

async function checkAgentUsageLimitForWindow(
    parentSpan: TracerSpan,
    agentUsageDatabase: AgentUsageDatabase,
    {
        type,
        currentTimestamp,
        accountId,
    }: {
        type: AgentUsageWindowType;
        currentTimestamp: number;
        accountId: AccountId;
    },
): Promise<CheckAgentLimitResult> {
    return parentSpan.withSpan(`Check ${type} window`, async span => {
        // Get the limit in millicents
        const limit = agentUsageWindowLimit[type].limitDollars * 100 * 1000;

        const startedAt = await getAgentUsageWindowStartedAt(span, agentUsageDatabase, {
            type,
            accountId,
            currentTimestamp,
        });

        const currentUsed =
            startedAt === currentTimestamp
                ? BigInt(0)
                : await agentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp(
                      accountId,
                      startedAt,
                  );

        span.addData({
            agents: {
                request: {
                    usageWindow: {
                        windowType: type,
                        limitMillicents: limit,
                        usedMillicents: Number(currentUsed),
                        ageMs: currentTimestamp - startedAt,
                        startTime: serializeDateString(new Date(startedAt)),
                    },
                },
            },
        });

        // Check if current usage exceeds limit
        // If we're an alpioneer, we never enforce limits, but still return usage for downgrades
        if (currentUsed > limit && !(accountId in alpioneers)) {
            const timeUntilReset = calculateVisualTimeUntilReset(type, startedAt, currentTimestamp);

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

        const maximumWindowUsagePercent = Number(currentUsed) / limit;

        return {ok: true, maximumWindowUsagePercent};
    });
}

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
    return tracer.withSpan(`Check agent limits`, async span => {
        // Place account ID first so we get this data even if an error occurs later
        span.addData({
            agents: {
                request: {
                    accountId,
                },
            },
        });

        let maximumWindowUsagePercent = 0;

        try {
            // We purposefully check the longest window first. If they hit a weekly limit,
            // there's no need to check the dynamic limit, and we want to return the longest
            // blocked period to the user.
            for (const type of ["weekly", "dynamic"] as const) {
                const result = await checkAgentUsageLimitForWindow(span, agentUsageDatabase, {
                    type,
                    accountId,
                    currentTimestamp,
                });

                // As soon as we encounter a limit breach, return immediately
                if (!result.ok) {
                    return result;
                } else {
                    maximumWindowUsagePercent = Math.max(
                        maximumWindowUsagePercent,
                        result.maximumWindowUsagePercent,
                    );
                }
            }
        } catch (error) {
            // In case of errors checking limits, allow the request to proceed.
            // We don't want to block users due to transient errors.
            span.addException(
                new DataLossError("Failed to check agent usage limits", {cause: error}),
            );
            return {ok: true, maximumWindowUsagePercent: 0};
        }

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
