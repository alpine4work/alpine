import {AgentWebPageLinkKeyObject} from "~/server/agents/web/agent_web_page_link_key.open_source.js";
import {getAgentWebAlpineUrl} from "~/server/agents/web/get_agent_web_alpine_url.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * The product URL for a page link that addresses something narrower than a whole
 * entity — a single comment, a thread, or a task's subtasks.
 */
export function createAgentWebPageLinkUrl(
    pageLink: Extract<
        AgentWebPageLinkKeyObject,
        {
            readonly type:
                | "ChatMessage"
                | "DocumentThread"
                | "DocumentMessage"
                | "PostMessage"
                | "TaskMessage"
                | "TaskSubtasks";
        }
    >,
): string {
    const alpineUrl = getAgentWebAlpineUrl();

    switch (pageLink.type) {
        case "ChatMessage":
            return `${alpineUrl}/chat/${pageLink.id}?message=${pageLink.index}`;
        case "DocumentThread":
            return `${alpineUrl}/doc/${pageLink.document.id}?thread=${pageLink.id}`;
        case "DocumentMessage":
            return `${alpineUrl}/doc/${pageLink.document.id}?thread=${pageLink.id}&comment=${pageLink.index}`;
        case "PostMessage":
            return `${alpineUrl}/post/${pageLink.id}?comment=${pageLink.index}`;
        case "TaskMessage":
            return `${alpineUrl}/task/${pageLink.id}?comment=${pageLink.index}`;
        case "TaskSubtasks":
            return `${alpineUrl}/task/${pageLink.task.id}/subtasks`;
        default:
            throw exhaustive(pageLink);
    }
}
