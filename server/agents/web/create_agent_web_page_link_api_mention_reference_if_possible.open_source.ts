import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.open_source.js";
import {ApiMentionReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

export function createAgentWebPageLinkApiMentionReferenceIfPossible(
    link: AgentWebPageLink,
    spaceId: SpaceId,
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
                url: `https://alpine.inc/doc/${link.document.id}?thread=${link.id}`,
            };
        }
        case "DocumentMessage": {
            return {
                type: "Url",
                url: `https://alpine.inc/doc/${link.document.id}?thread=${link.id}&comment=${link.index}`,
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
        case "Inbox": {
            return {
                type: "Url",
                url: `https://alpine.inc/inbox/${spaceId}`,
            };
        }
        case "TaskView": {
            return {
                type: "Url",
                url: `https://alpine.inc/my-tasks/${spaceId}`,
            };
        }
        case "Space": {
            return {
                type: "Url",
                url: `https://alpine.inc/settings/${spaceId}/general`,
            };
        }
        case "Skill": {
            // If the agent writes a skill link then output that as a URL to the skill file in
            // our open source mirror so the user can go open that file and see what the agent
            // was talking about.
            return {
                type: "Url",
                url: `https://github.com/alpine4work/alpine/blob/main/skills/alpine/${link.path}.md`,
            };
        }
        case "MyAccount": {
            // If a bot writes `/bot/me` in its Markdown, this isn't a great URL but oh well.
            // It's actually quite hard to plumb down the `BotId` we need down here. Since we
            // think this is a rare case we accept the generic URL for now.
            return {
                type: "Url",
                url: `https://alpine.inc/settings/${spaceId}/bots`,
            };
        }
        default:
            throw exhaustive(link);
    }
}
