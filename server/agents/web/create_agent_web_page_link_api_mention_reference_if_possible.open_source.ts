import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.open_source.js";
import {createAgentWebPageLinkUrl} from "~/server/agents/web/create_agent_web_page_link_url.open_source.js";
import {getAgentWebAlpineUrl} from "~/server/agents/web/get_agent_web_alpine_url.js";
import {ApiMentionReference} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

export function createAgentWebPageLinkApiMentionReferenceIfPossible(
    link: AgentWebPageLink,
    spaceId: SpaceId,
): {type: "MentionReference"; reference: ApiMentionReference} | {type: "Url"; url: string} {
    const productUrl = getAgentWebAlpineUrl();

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
        case "ChatMessage":
        case "DocumentThread":
        case "DocumentMessage":
        case "PostMessage":
        case "TaskMessage":
            return {type: "Url", url: createAgentWebPageLinkUrl(link)};
        case "File": {
            return {
                type: "Url",
                url: `${productUrl}/file/${link.id}`,
            };
        }
        case "TaskMessageList":
        case "TaskSubtasks": {
            return {type: "MentionReference", reference: link.task};
        }
        case "Inbox": {
            return {
                type: "Url",
                url: `${productUrl}/inbox/${spaceId}`,
            };
        }
        case "TaskView": {
            return {
                type: "Url",
                url: `${productUrl}/my-tasks/${spaceId}`,
            };
        }
        case "Space": {
            return {
                type: "Url",
                url: `${productUrl}/settings/${spaceId}/general`,
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
                url: `${productUrl}/settings/${spaceId}/bots`,
            };
        }
        default:
            throw exhaustive(link);
    }
}
