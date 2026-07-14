import {AgentWebhookRequest} from "~/server/agents/bots/internal/agent_durable_object_base.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";

/**
 * The time zone to use when processing a bot webhook request. Approval-decision
 * events don't carry a time zone, so they fall back to the default.
 */
export function getTimezoneFromBotWebhookRequest(request: AgentWebhookRequest): TimeZone {
    switch (request.event.type) {
        case "CreatedMessage":
        case "CreatedPost":
            return request.event.createdTimeZone;
        case "UpdatedMessageStreamExperimentalApprovalsPart":
            return defaultTimeZone;
        default:
            throw exhaustive(request.event);
    }
}
