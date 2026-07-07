import {
    AgentWebPageStoredLink,
    printAgentWebPageStoredLinkPathname,
} from "~/server/agents/web/agent_web_page_stored_link.js";
import {printAgentWebPageStoredLinkKey} from "~/server/agents/web/agent_web_page_stored_link_key.js";
import {
    AgentWebSessionStorage,
    normalizeAgentWebPageStoredLinkPathname,
} from "~/server/agents/web/agent_web_session_storage.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";

/**
 * Create the URL pathname for a `AgentWebPageStoredLink`. Return this pathname in
 * agent web Markdown and the agent can use the pathname with the `read` tool to
 * retrieve the page content.
 *
 * If:
 *
 * - We already called with exactly the same `AgentWebPageStoredLink` then we
 *   return the URL pathname we already created.
 *
 * - We called with a `AgentWebPageStoredLink` referencing the same underlying
 *   content (same `AgentWebPageStoredLinkKey`) then we create a new URL pathname
 *   (if the URL pathname has changed, e.g. document has been renamed) and mark the
 *   returned URL pathname as latest.
 *
 * - We called with a `AgentWebPageStoredLink` referencing different underlying
 *   content (different `AgentWebPageStoredLinkKey`) but they happen to have the
 *   same pathname according to `printAgentWebPageStoredLinkPathname()` then we add
 *   a dedupe number to the pathname to avoid collisions.
 */
export function createAgentWebPageStoredLinkPathname(
    storage: AgentWebSessionStorage,
    pageLink: AgentWebPageStoredLink,
): Promise<string> {
    return storage.mutex.withLock(async () => {
        const pageLinkKey = printAgentWebPageStoredLinkKey(pageLink);

        let dedupeNumber = 1;
        let pageLinkPathname = printAgentWebPageStoredLinkPathname(pageLink, dedupeNumber);

        // We check pathname collisions against the normalized storage key so account
        // pathnames with different labels still collide: if `/human/caleb` exists then a
        // bot named "Caleb" dedupes to `/bot/caleb-2` since both normalize to
        // `/account/caleb`.
        const [initialActualPageLink, latestPageLinkPathname] = await runAllPromises([
            storage.pageStoredLinkByPathname.get(
                normalizeAgentWebPageStoredLinkPathname(pageLinkPathname),
            ),
            storage.latestPageStoredLinkPathnameByKey.get(pageLinkKey),
        ]);

        let actualPageLink = initialActualPageLink;

        while (
            actualPageLink !== undefined &&
            printAgentWebPageStoredLinkKey(actualPageLink) !== pageLinkKey
        ) {
            dedupeNumber++;
            pageLinkPathname = printAgentWebPageStoredLinkPathname(pageLink, dedupeNumber);
            actualPageLink = await storage.pageStoredLinkByPathname.get(
                normalizeAgentWebPageStoredLinkPathname(pageLinkPathname),
            );
        }

        if (actualPageLink === undefined || !isDeepEqual(actualPageLink, pageLink)) {
            await storage.pageStoredLinkByPathname.put(
                normalizeAgentWebPageStoredLinkPathname(pageLinkPathname),
                pageLink,
            );
        }

        // We write in sequence instead of in parallel because if we load
        // `pageStoredLinkPathname` from `latestPageStoredLinkPathnameByKey` and it doesn't
        // exist in `pageStoredLinkByPathname` the agent is going to have a bad time. Since
        // we'll throw a redirection error followed by a not found error when the agent
        // tries to read the redirection.
        if (latestPageLinkPathname !== pageLinkPathname) {
            await storage.latestPageStoredLinkPathnameByKey.put(pageLinkKey, pageLinkPathname);
        }

        return pageLinkPathname;
    });
}
