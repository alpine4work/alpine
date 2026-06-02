import {AgentWebPageStoredLink} from "~/server/agents/web/agent_web_page_stored_link.js";
import {ApiPreviewTargetResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

// NOCOMMIT: How does this interact with stored links vs other kinds of links?
export function createAgentWebPageLinkApiPreviewTargetIfPossible(
    link: AgentWebPageStoredLink,
): ApiPreviewTargetResponse | null {
    switch (link.type) {
        case "Channel":
        case "Chat":
        case "Document":
        case "Post":
        case "Task":
        case "TaskCollection":
            return link;
        case "Account":
        case "ChatMessage":
        case "DocumentMessage":
        case "PostMessage":
        case "TaskMessage":
        case "File":
            return null;
        default:
            throw exhaustive(link);
    }
}
