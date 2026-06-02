import {AgentWebPageStoredLink} from "~/server/agents/web/agent_web_page_stored_link.js";
import {printAgentWebPageStoredLinkKey} from "~/server/agents/web/agent_web_page_stored_link_key.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export async function getAgentWebPageStoredLinkByPathname(
    storage: AgentWebSessionStorage,
    pathname: string,
): Promise<{pageLink: AgentWebPageStoredLink; latestPathname: string} | null> {
    let pageLink = await storage.pageStoredLinkByPathname.get(pathname);
    if (!pageLink) return null;

    const pageLinkKey = printAgentWebPageStoredLinkKey(pageLink);

    const latestPathname =
        (await storage.latestPageStoredLinkPathnameByKey.get(pageLinkKey)) ??
        // `latestPageStoredLinkPathnameForKey` may be undefined in certain race conditions
        // because it's written after we write to `pageStoredLinkByPathname`.
        pathname;

    // If a path change occurred, then "redirect" and use the latest pathname when
    // parsing the link. Instead of using a dead pathname.
    if (latestPathname !== pathname) {
        pageLink = assertExists(await storage.pageStoredLinkByPathname.get(latestPathname));
        return {pageLink, latestPathname};
    }

    return {pageLink, latestPathname};
}
