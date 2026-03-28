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
        case "Document":
        case "Task":
        case "TaskCollection": {
            return {type: "MentionTarget", target: link};
        }
        case "ChatMessages": {
            switch (link.preview.type) {
                case "Title": {
                    return {
                        type: "MentionTarget",
                        target: {type: "Chat", id: link.id, title: link.preview.title},
                    };
                }
                case "Message": {
                    return {
                        type: "Url",
                        url: `https://alpine.inc/s/${spaceId}/chat/${link.id}?message=${link.preview.index}`,
                    };
                }
                default:
                    throw exhaustive(link.preview);
            }
        }
        case "DocumentMessages": {
            return {
                type: "Url",
                url: `https://alpine.inc/s/${spaceId}/documents/${link.id}?comments=${link.threadId}&comment=${link.preview.index}`,
            };
        }
        case "PostMessages": {
            switch (link.preview.type) {
                case "Title": {
                    return {
                        type: "MentionTarget",
                        target: {type: "Post", id: link.id, title: link.preview.title},
                    };
                }
                case "Message": {
                    return {
                        type: "Url",
                        url: `https://alpine.inc/s/${spaceId}/posts/${link.id}?comment=${link.preview.index}`,
                    };
                }
                default:
                    throw exhaustive(link.preview);
            }
        }
        case "TaskMessages": {
            return {
                type: "Url",
                url: `https://alpine.inc/s/${spaceId}/tasks/${link.id}?comment=${link.preview.index}`,
            };
        }
    }
}
