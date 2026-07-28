import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {ApiPreviewReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export function createAgentWebPageLinkApiPreviewReferenceIfPossible(
    link: AgentWebPageLink,
): ApiPreviewReferenceResponse | null {
    switch (link.type) {
        case "Channel":
        case "Chat":
        case "Document":
        case "Post":
        case "Task":
        case "TaskCollection":
        case "Site":
            return link;
        case "TaskMessageList":
        case "TaskSubtasks":
            return link.task;
        case "Account":
        case "ChatMessage":
        case "DocumentThread":
        case "DocumentMessage":
        case "PostMessage":
        case "TaskMessage":
        case "File":
        case "Skill":
            return null;
        default:
            throw exhaustive(link);
    }
}
