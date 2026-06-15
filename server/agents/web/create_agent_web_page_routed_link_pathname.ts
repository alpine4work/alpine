import {AgentWebPageRoutedLink} from "~/server/agents/web/agent_web_page_routed_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export async function createAgentWebPageRoutedLinkPathname(
    storage: AgentWebSessionStorage,
    pageLink: AgentWebPageRoutedLink,
): Promise<string> {
    switch (pageLink.type) {
        // NOCOMMIT: Integration test at some point searching for a document comment in a
        // resolved comment thread. This won't have been present in the underlying document
        // so we'll need to generate a comment thread ID.
        case "DocumentThread": {
            const pathname = await createAgentWebPageStoredLinkPathname(storage, pageLink.document);
            assert(pathname.startsWith("/document/"));

            const threadNumber = assertExists(
                await storage.documentCommentThreadNumberById.get(
                    `${pageLink.document.id}-${pageLink.threadId}`,
                ),
            );

            return `${pathname}/comments/${threadNumber}`;
        }
        case "TaskMessageList": {
            const pathname = await createAgentWebPageStoredLinkPathname(storage, pageLink.task);
            assert(pathname.startsWith("/task/"));
            return `${pathname}/comments`;
        }
        default:
            throw exhaustive(pageLink);
    }
}
