import {AgentConversationState} from "~/server/agents/internal/conversation/agent_conversation_store.js";
import {getAgentUsageLocalResetTimeString} from "~/server/agents/internal/get_agent_usage_local_reset_time_string.js";

export function getAgentTokenLimitExceededMessage(
    resetTime: Date,
    currentTime: Date,
    // TODO(ifitzsimmons, #ai): This date uses the conversation's time zone, which may not
    // actually reflect the time that the user's window will reset. To ensure accuracy,
    // we actually add the timezone abbreviation to the date string in the message.
    // However, if the timezone doesn't match their expected timezone (e.g. the user has
    // changed timezones since the conversation has started), this may feel surprising to them.
    // We should fix this by just using the timezone from the latest message.
    //
    // It probably makes sense to just send the timezoe directly to the ApiBotWebhookEvent
    // since we include it in messages now anyway.
    //
    // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/v234e2hgaz7zzny85kj4j68qxm
    {timeZone}: Pick<AgentConversationState, "timeZone">,
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
