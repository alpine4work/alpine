import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {ApiMentionTargetResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export function createAgentWebPageLinkApiMentionTargetIfPossible(
    spaceId: SpaceId,
    link: AgentWebPageLink,
): {type: "MentionTarget"; target: ApiMentionTargetResponse} | {type: "Url"; url: string} {
    switch (link.type) {
        case "Account":
        case "Channel":
        case "Chat":
        case "Document":
        case "Post":
        case "Task":
        case "TaskCollection": {
            return {type: "MentionTarget", target: link};
        }
        case "ChatMessage": {
            return {
                type: "Url",
                url: `https://alpine.inc/s/${spaceId}/chat/${link.id}?message=${link.index}`,
            };
        }
        case "DocumentMessage": {
            return {
                type: "Url",
                url: `https://alpine.inc/s/${spaceId}/documents/${link.id}?comments=${link.threadId}&comment=${link.index}`,
            };
        }
        case "PostMessage": {
            return {
                type: "Url",
                url: `https://alpine.inc/s/${spaceId}/posts/${link.id}?comment=${link.index}`,
            };
        }
        case "TaskMessage": {
            return {
                type: "Url",
                url: `https://alpine.inc/s/${spaceId}/tasks/${link.id}?comment=${link.index}`,
            };
        }
        case "File": {
            return {
                type: "Url",
                url: `https://alpine.inc/s/${spaceId}/files/${link.id}`,
            };
        }
        case "TaskMessageList": {
            return {type: "MentionTarget", target: link.task};
        }
        default:
            throw exhaustive(link);
    }
}
