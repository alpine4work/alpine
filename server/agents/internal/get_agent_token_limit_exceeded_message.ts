import {getAgentUsageLocalResetTimeString} from "~/server/agents/internal/get_agent_usage_local_reset_time_string.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";

export function getAgentTokenLimitExceededMessage(
    resetTime: Date,
    currentTime: Date,
    timeZone: TimeZone,
): string {
    return (
        "You’ve reached your agent usage limit. " +
        `Your limit will reset ${getAgentUsageLocalResetTimeString(
            resetTime,
            currentTime,
            timeZone,
        )}. ` +
        "You can get higher usage limits by [buying lifetime Alpine access](https://alpine.inc#pricing)."
    );
}
