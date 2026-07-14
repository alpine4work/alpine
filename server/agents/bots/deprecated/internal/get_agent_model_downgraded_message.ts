import {getAgentUsageLocalResetTimeString} from "~/server/agents/bots/deprecated/internal/get_agent_usage_local_reset_time_string.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";

export function getAgentModelDowngradedMessage(
    resetTime: Date,
    currentTime: Date,
    timeZone: TimeZone,
): string {
    return (
        "\n\n(To help extend your usage, I\u2019m now using a less intelligent model. I\u2019ll be back to " +
        `using the best available model ${getAgentUsageLocalResetTimeString(
            resetTime,
            currentTime,
            timeZone,
        )}. ` +
        "If you\u2019d like to continue using the most intelligent models, purchase " +
        "[Alpine lifetime access](https://www.alpine.inc#pricing).)"
    );
}
