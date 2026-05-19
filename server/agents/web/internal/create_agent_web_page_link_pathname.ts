import {
    AgentWebPageLink,
    printAgentWebPageLinkPathname,
} from "~/server/agents/web/agent_web_page_link.js";
import {printAgentWebPageLinkKey} from "~/server/agents/web/agent_web_page_link_key.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";

export function createAgentWebPageLinkPathname(
    storage: AgentWebSessionStorage,
    pageLink: AgentWebPageLink,
): Promise<string> {
    return storage.mutex.withLock(async () => {
        const pageLinkKey = printAgentWebPageLinkKey(pageLink);

        let dedupeNumber = 1;
        let pageLinkPathname = printAgentWebPageLinkPathname(pageLink, dedupeNumber);

        const [initialActualPageLink, latestPageLinkPathname] = await runAllPromises([
            storage.pageLinkByPathname.get(pageLinkPathname),
            storage.latestPageLinkPathnameByKey.get(pageLinkKey),
        ]);

        let actualPageLink = initialActualPageLink;

        while (
            actualPageLink !== undefined &&
            printAgentWebPageLinkKey(actualPageLink) !== pageLinkKey
        ) {
            dedupeNumber++;
            pageLinkPathname = printAgentWebPageLinkPathname(pageLink, dedupeNumber);
            actualPageLink = await storage.pageLinkByPathname.get(pageLinkPathname);
        }

        if (actualPageLink === undefined || !isDeepEqual(actualPageLink, pageLink)) {
            await storage.pageLinkByPathname.put(pageLinkPathname, pageLink);
        }

        // We write in sequence instead of in parallel because if we load
        // `pageLinkPathname` from `latestPageLinkPathnameByKey` and it doesn't exist in
        // `pageLinkByPathname` the agent is going to have a bad time. Since we'll throw a
        // redirection error followed by a not found error when the agent tries to read the
        // redirection.
        if (latestPageLinkPathname !== pageLinkPathname) {
            await storage.latestPageLinkPathnameByKey.put(pageLinkKey, pageLinkPathname);
        }

        return pageLinkPathname;
    });
}
