import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.open_source.js";
import {ApiPreviewReference} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export function createAgentWebPageLinkApiPreviewReferenceIfPossible(
    link: AgentWebPageLink,
): ApiPreviewReference | null {
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
        case "TaskView":
        case "File":
        case "Inbox":
        case "Space":
        case "Skill":
        case "MyAccount":
            return null;
        default:
            throw exhaustive(link);
    }
}
