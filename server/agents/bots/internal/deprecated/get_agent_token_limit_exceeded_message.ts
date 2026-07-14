import {getAgentUsageLocalResetTimeString} from "~/server/agents/bots/internal/deprecated/get_agent_usage_local_reset_time_string.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";

export function getAgentTokenLimitExceededMessage(
    resetTime: Date,
    currentTime: Date,
    timeZone: TimeZone,
    shouldUpsell: boolean,
): string {
    let message =
        "You\u2019ve reached your agent usage limit. " +
        `Your limit will reset ${getAgentUsageLocalResetTimeString(
            resetTime,
            currentTime,
            timeZone,
        )}.`;

    // NOTE(ifitzsimmons, 2026-01-12): We only add the upsell link if the user can be
    // upselled. If the user can't be upselled (they already have the max token usage),
    // we shouldn't add the upsell link. There's nothing they can do.
    if (shouldUpsell) {
        message +=
            " You can get higher usage limits by purchasing [Alpine lifetime access](https://www.alpine.inc#pricing).";
    }

    return message;
}
