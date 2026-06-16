import {AgentWebPageRoutedLink} from "~/server/agents/web/agent_web_page_routed_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";

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

            // Get the number for the comment thread. If there's not currently a number for
            // this thread then we'll generate the next number in the sequence.
            const threadNumber = await storage.mutex.withLock(async () => {
                const id: `${DocumentId}-${DocumentCommentThreadId}` = `${pageLink.document.id}-${pageLink.threadId}`;

                let number = await storage.documentCommentThreadNumberById.get(id);

                // Make a `list()` call to figure out the total number of comment threads we've
                // seen and use a comment thread number that's one more than that.
                if (number === undefined) {
                    const threads = await storage.documentCommentThreadNumberById.list({
                        prefix: `${pageLink.document.id}-`,
                    });

                    number = threads.size + 1;

                    await storage.documentCommentThreadNumberById.put(id, number);
                    await storage.documentCommentThreadIdByNumber.put(
                        `${pageLink.document.id}-${number}`,
                        pageLink.threadId,
                    );
                }

                return number;
            });

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
