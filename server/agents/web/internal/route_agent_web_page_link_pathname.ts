import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {getAgentWebPageStoredLinkByPathname} from "~/server/agents/web/internal/get_agent_web_page_stored_link_by_pathname.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Routes a URL pathname to the appropriate `AgentWebPageLink`. Whether that's a
 * stored page link or routed pagel link. This function actually implements the
 * routing functionality for `AgentWebPageRoutedLink`.
 */
export async function routeAgentWebPageLinkPathname(
    storage: AgentWebSessionStorage,
    pathname: string,
): Promise<{pageLink: AgentWebPageLink; latestPathname: string} | null> {
    // We assume `normalizeAgentWebPath()` has already been called for this `pathname`.
    assert(pathname.startsWith("/"));

    const [pathnameType = "", pathnameRest = ""] = pathname.slice(1).split("/", 2);

    switch (pathnameType) {
        case "task-comments": {
            const result = await getAgentWebPageStoredLinkByPathname(
                storage,
                `/task/${pathnameRest}`,
            );
            if (result === null) return null;

            assert(result.pageLink.type === "Task");

            assert(result.latestPathname.startsWith("/task/"));
            const latestPathname = `/task-comments/${result.latestPathname.slice("/task/".length)}`;

            return {
                pageLink: {type: "TaskMessageList", task: result.pageLink},
                latestPathname,
            };
        }
        default: {
            return await getAgentWebPageStoredLinkByPathname(storage, pathname);
        }
    }
}
