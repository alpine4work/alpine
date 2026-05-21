import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {printAgentWebPageLinkKey} from "~/server/agents/web/agent_web_page_link_key.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export async function getAgentWebPageLinkByPathname(
    storage: AgentWebSessionStorage,
    pathname: string,
): Promise<{pageLink: AgentWebPageLink; latestPathname: string} | null> {
    let pageLink = await storage.pageLinkByPathname.get(pathname);
    if (!pageLink) return null;

    const pageLinkKey = printAgentWebPageLinkKey(pageLink);

    const latestPathname =
        (await storage.latestPageLinkPathnameByKey.get(pageLinkKey)) ??
        // `latestPageLinkPathnameForKey` may be undefined in certain race conditions
        // because it's written after we write to `pageLinkByPathname`.
        pathname;

    // If a path change occurred, then "redirect" and use the latest pathname when
    // parsing the link. Instead of using a dead pathname.
    if (latestPathname !== pathname) {
        pageLink = assertExists(await storage.pageLinkByPathname.get(latestPathname));
        return {pageLink, latestPathname};
    }

    return {pageLink, latestPathname};
}
