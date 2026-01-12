import {getAgentUsageLocalResetTimeString} from "~/server/agents/internal/get_agent_usage_local_reset_time_string.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";

export function getAgentModelDowngradedMessage(
    resetTime: Date,
    currentTime: Date,
    timeZone: TimeZone,
): string {
    return (
        "*⚠️ To help extend your usage, I’m now using a less intelligent model. I’ll be back to " +
        `using the best available model ${getAgentUsageLocalResetTimeString(
            resetTime,
            currentTime,
            timeZone,
        )}. ` +
        "If you’d like to continue using the most intelligent models, purchase " +
        "[Alpine Lifetime access](https://www.alpine.inc#pricing).*"
    );
}
