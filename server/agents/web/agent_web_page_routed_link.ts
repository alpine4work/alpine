import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/internal/create_agent_web_page_stored_link_pathname.js";
import {ApiTaskTargetResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * A link with some routing logic to determine what `AgentWebPage` to respond to a
 * `read` tool call with. See the detailed documentation comment on
 * `AgentWebPageLink` for more information.
 *
 * The actual routing logic lives in `routeAgentWebPageLinkPathname()`.
 */
export type AgentWebPageRoutedLink = {
    readonly type: "TaskMessageList";
    readonly task: ApiTaskTargetResponse;
};

export async function createAgentWebPageTaskMessageListRoutedLinkPathname(
    storage: AgentWebSessionStorage,
    pageLink: Extract<AgentWebPageRoutedLink, {type: "TaskMessageList"}>,
): Promise<string> {
    const pathname = await createAgentWebPageStoredLinkPathname(storage, pageLink.task);
    assert(pathname.startsWith("/task/"));
    return `/task-comments/${pathname.slice("/task/".length)}`;
}
