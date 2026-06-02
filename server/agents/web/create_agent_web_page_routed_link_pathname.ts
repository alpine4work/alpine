import {AgentWebPageRoutedLink} from "~/server/agents/web/agent_web_page_routed_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";

export async function createAgentWebPageRoutedLinkPathname(
    storage: AgentWebSessionStorage,
    pageLink: AgentWebPageRoutedLink,
): Promise<string> {
    // Once we add a variant to the union, TypeScript will error here and we should use
    // that signal to switch from a `cast()` to a `switch`.
    cast<"TaskMessageList">(pageLink.type);

    const pathname = await createAgentWebPageStoredLinkPathname(storage, pageLink.task);
    assert(pathname.startsWith("/task/"));
    return `/task-comments/${pathname.slice("/task/".length)}`;
}
