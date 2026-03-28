import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {AgentWebPageStoredLink} from "~/server/agents/web/agent_web_page_stored_link.js";
import {printAgentWebPageStoredLinkKey} from "~/server/agents/web/agent_web_page_stored_link_key.js";
import {
    AgentWebSessionStorage,
    normalizeAgentWebPageStoredLinkPathname,
} from "~/server/agents/web/agent_web_session_storage.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

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

    const pathnameParts = pathname.slice(1).split("/");

    switch (pathnameParts[0]) {
        case "document": {
            if (pathnameParts.length !== 4) break;
            if (pathnameParts[2] !== "comments") break;
            if (!/^(0|[1-9][0-9]*)$/.test(pathnameParts[3]!)) break;

            const threadNumber = parseInt(pathnameParts[3]!, 10);

            const result = await getAgentWebPageStoredLinkByPathname(
                storage,
                `/document/${pathnameParts[1]!}`,
            );
            if (result === null) return null;

            assert(result.pageLink.type === "Document");

            const threadId = await storage.documentCommentThreadIdByNumber.get(
                `${result.pageLink.id}-${threadNumber}`,
            );
            if (threadId === undefined) return null;

            assert(result.latestPathname.startsWith("/document/"));
            const latestPathname = `${result.latestPathname}/comments/${threadNumber}`;

            return {
                pageLink: {type: "DocumentThread", document: result.pageLink, threadId},
                latestPathname,
            };
        }
        case "task": {
            if (pathnameParts.length !== 3) break;
            if (pathnameParts[2] !== "comments") break;

            const result = await getAgentWebPageStoredLinkByPathname(
                storage,
                `/task/${pathnameParts[1]!}`,
            );
            if (result === null) return null;

            assert(result.pageLink.type === "Task");

            assert(result.latestPathname.startsWith("/task/"));
            const latestPathname = `${result.latestPathname}/comments`;

            return {
                pageLink: {type: "TaskMessageList", task: result.pageLink},
                latestPathname,
            };
        }
        default:
            break;
    }

    return await getAgentWebPageStoredLinkByPathname(storage, pathname);
}

/**
 * Get the `AgentWebPageStoredLink` for the given pathname if one exists.
 *
 * Returns `null` if no link is found for the given pathname.
 *
 * If there's a newer pathname for the underlying content (determined by
 * `AgentWebPageStoredLinkKey`) then we return it as `latestPathname`. If
 * `latestPathname` is different from `pathname` then treat it as a 302 HTTP
 * redirect.
 */
async function getAgentWebPageStoredLinkByPathname(
    storage: AgentWebSessionStorage,
    pathname: string,
): Promise<{pageLink: AgentWebPageStoredLink; latestPathname: string} | null> {
    let pageLink = await storage.pageStoredLinkByPathname.get(
        normalizeAgentWebPageStoredLinkPathname(pathname),
    );
    if (!pageLink) return null;

    const pageLinkKey = printAgentWebPageStoredLinkKey(pageLink);

    const latestPathname =
        (await storage.latestPageStoredLinkPathnameByKey.get(pageLinkKey)) ??
        // `latestPageStoredLinkPathnameForKey` may be undefined in certain race conditions
        // because it's written after we write to `pageStoredLinkByPathname`.
        pathname;

    // If a path change occurred, then "redirect" and use the latest pathname when
    // parsing the link. Instead of using a dead pathname. This also redirects an
    // account pathname with the wrong label (e.g. `/human/melvin` for a bot) to the
    // correctly labeled pathname (e.g. `/bot/melvin`).
    if (latestPathname !== pathname) {
        pageLink = assertExists(
            await storage.pageStoredLinkByPathname.get(
                normalizeAgentWebPageStoredLinkPathname(latestPathname),
            ),
        );
        return {pageLink, latestPathname};
    }

    return {pageLink, latestPathname};
}
