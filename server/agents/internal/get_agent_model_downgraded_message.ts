import {getAgentUsageLocalResetTimeString} from "~/server/agents/internal/get_agent_usage_local_reset_time_string.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";

export function getAgentModelDowngradedMessage(
    resetTime: Date,
    currentTime: Date,
    timeZone: TimeZone,
): string {
    return (
        "*⚠️ To help extend your usage, your AI models have been downgraded temporarily. " +
        `This will reset ${getAgentUsageLocalResetTimeString(resetTime, currentTime, timeZone)}.*`
    );
}
