import {AgentWebPageRoutedLink} from "~/server/agents/web/agent_web_page_routed_link.open_source.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export async function createAgentWebPageRoutedLinkPathname(
    storage: AgentWebSessionStorage,
    pageLink: AgentWebPageRoutedLink,
): Promise<string> {
    switch (pageLink.type) {
        case "Skill": {
            return `/skill/${pageLink.path}`;
        }
        case "DocumentThread": {
            const pathname = await createAgentWebPageStoredLinkPathname(storage, pageLink.document);
            assert(pathname.startsWith("/document/"));

            // Get the number for the comment thread. If there's not currently a number for
            // this thread then we'll generate the next number in the sequence.
            const threadNumber = await storage.mutex.withLock(async () => {
                const key = [pageLink.document.id, pageLink.id] as const;

                let number = await storage.documentCommentThreadNumberById.get(key);

                // Make a `list()` call to figure out the total number of comment threads we've
                // seen and use a comment thread number that's one more than that.
                if (number === undefined) {
                    const threads = await storage.documentCommentThreadNumberById.list(
                        pageLink.document.id,
                    );

                    number = threads.size + 1;

                    await storage.documentCommentThreadNumberById.put(key, number);
                    await storage.documentCommentThreadIdByNumber.put(
                        [pageLink.document.id, `${number}`],
                        pageLink.id,
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
        case "TaskSubtasks": {
            const pathname = await createAgentWebPageStoredLinkPathname(storage, pageLink.task);
            assert(pathname.startsWith("/task/"));
            return `${pathname}/subtasks`;
        }
        case "Inbox": {
            const pathname = await createAgentWebPageStoredLinkPathname(storage, pageLink.account);
            // Bots never have an inbox, so an inbox link is always for a human.
            assert(pathname.startsWith("/human/"));
            return `${pathname}/inbox`;
        }
        case "MyAccount": {
            return "/bot/me";
        }
        default:
            throw exhaustive(pageLink);
    }
}
