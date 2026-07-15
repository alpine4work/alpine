import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {ApiMentionReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export function createAgentWebPageLinkApiMentionReferenceIfPossible(
    link: AgentWebPageLink,
): {type: "MentionReference"; reference: ApiMentionReferenceResponse} | {type: "Url"; url: string} {
    switch (link.type) {
        case "Account":
        case "Channel":
        case "Chat":
        case "Document":
        case "Post":
        case "Task":
        case "TaskCollection":
        case "Site": {
            return {type: "MentionReference", reference: link};
        }
        case "ChatMessage": {
            return {
                type: "Url",
                url: `https://alpine.inc/chat/${link.id}?message=${link.index}`,
            };
        }
        case "DocumentThread": {
            return {
                type: "Url",
                url: `https://alpine.inc/doc/${link.document.id}?thread=${link.threadId}`,
            };
        }
        case "DocumentMessage": {
            return {
                type: "Url",
                url: `https://alpine.inc/doc/${link.id}?thread=${link.threadId}&comment=${link.index}`,
            };
        }
        case "PostMessage": {
            return {
                type: "Url",
                url: `https://alpine.inc/post/${link.id}?comment=${link.index}`,
            };
        }
        case "TaskMessage": {
            return {
                type: "Url",
                url: `https://alpine.inc/task/${link.id}?comment=${link.index}`,
            };
        }
        case "File": {
            return {
                type: "Url",
                url: `https://alpine.inc/file/${link.id}`,
            };
        }
        case "TaskMessageList":
        case "TaskSubtasks": {
            return {type: "MentionReference", reference: link.task};
        }
        default:
            throw exhaustive(link);
    }
}
