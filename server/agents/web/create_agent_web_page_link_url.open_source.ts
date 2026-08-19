import {AgentWebPageLinkKeyObject} from "~/server/agents/web/agent_web_page_link_key.open_source.js";
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
    // TODO(#agent-web): Make these links compatible with dev
    switch (pageLink.type) {
        case "ChatMessage":
            return `https://alpine.inc/chat/${pageLink.id}?message=${pageLink.index}`;
        case "DocumentThread":
            return `https://alpine.inc/doc/${pageLink.document.id}?thread=${pageLink.id}`;
        case "DocumentMessage":
            return `https://alpine.inc/doc/${pageLink.document.id}?thread=${pageLink.id}&comment=${pageLink.index}`;
        case "PostMessage":
            return `https://alpine.inc/post/${pageLink.id}?comment=${pageLink.index}`;
        case "TaskMessage":
            return `https://alpine.inc/task/${pageLink.id}?comment=${pageLink.index}`;
        case "TaskSubtasks":
            return `https://alpine.inc/task/${pageLink.task.id}/subtasks`;
        default:
            throw exhaustive(pageLink);
    }
}
