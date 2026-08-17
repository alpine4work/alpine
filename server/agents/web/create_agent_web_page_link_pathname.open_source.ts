import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.open_source.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {createAgentWebPageRoutedLinkPathname} from "~/server/agents/web/create_agent_web_page_routed_link_pathname.open_source.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export async function createAgentWebPageLinkPathname(
    storage: AgentWebSessionStorage,
    pageLink: AgentWebPageLink,
) {
    switch (pageLink.type) {
        case "Account":
        case "Channel":
        case "Chat":
        case "ChatMessage":
        case "Document":
        case "DocumentMessage":
        case "Post":
        case "PostMessage":
        case "Task":
        case "TaskMessage":
        case "TaskCollection":
        case "Site":
        case "File":
            return await createAgentWebPageStoredLinkPathname(storage, pageLink);
        case "Skill":
        case "DocumentThread":
        case "TaskMessageList":
        case "TaskSubtasks":
        case "TaskView":
        case "Inbox":
        case "Space":
        case "MyAccount":
            return await createAgentWebPageRoutedLinkPathname(storage, pageLink);
        default:
            throw exhaustive(pageLink);
    }
}
