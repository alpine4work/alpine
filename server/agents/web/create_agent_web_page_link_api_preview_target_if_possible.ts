import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {ApiPreviewTargetResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export function createAgentWebPageLinkApiPreviewTargetIfPossible(
    link: AgentWebPageLink,
): ApiPreviewTargetResponse | null {
    switch (link.type) {
        case "Channel":
        case "Chat":
        case "Document":
        case "Post":
        case "Task":
        case "TaskCollection":
            return link;
        case "TaskMessageList":
            return link.task;
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
