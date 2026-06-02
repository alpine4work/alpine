import {
    AgentWebPageStoredLink,
    printAgentWebPageStoredLinkPathname,
} from "~/server/agents/web/agent_web_page_stored_link.js";
import {printAgentWebPageStoredLinkKey} from "~/server/agents/web/agent_web_page_stored_link_key.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";

export function createAgentWebPageStoredLinkPathname(
    storage: AgentWebSessionStorage,
    pageLink: AgentWebPageStoredLink,
): Promise<string> {
    return storage.mutex.withLock(async () => {
        const pageLinkKey = printAgentWebPageStoredLinkKey(pageLink);

        let dedupeNumber = 1;
        let pageLinkPathname = printAgentWebPageStoredLinkPathname(pageLink, dedupeNumber);

        const [initialActualPageLink, latestPageLinkPathname] = await runAllPromises([
            storage.pageStoredLinkByPathname.get(pageLinkPathname),
            storage.latestPageStoredLinkPathnameByKey.get(pageLinkKey),
        ]);

        let actualPageLink = initialActualPageLink;

        while (
            actualPageLink !== undefined &&
            printAgentWebPageStoredLinkKey(actualPageLink) !== pageLinkKey
        ) {
            dedupeNumber++;
            pageLinkPathname = printAgentWebPageStoredLinkPathname(pageLink, dedupeNumber);
            actualPageLink = await storage.pageStoredLinkByPathname.get(pageLinkPathname);
        }

        if (actualPageLink === undefined || !isDeepEqual(actualPageLink, pageLink)) {
            await storage.pageStoredLinkByPathname.put(pageLinkPathname, pageLink);
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
