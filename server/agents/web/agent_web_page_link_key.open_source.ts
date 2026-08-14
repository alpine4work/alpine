import {
    AgentWebPageRoutedLinkKey,
    AgentWebPageRoutedLinkKeyObject,
    parseAgentWebPageRoutedLinkKey,
    printAgentWebPageRoutedLinkKey,
} from "~/server/agents/web/agent_web_page_routed_link_key.open_source.js";
import {
    AgentWebPageStoredLinkKey,
    AgentWebPageStoredLinkKeyObject,
    parseAgentWebPageStoredLinkKey,
    printAgentWebPageStoredLinkKey,
} from "~/server/agents/web/agent_web_page_stored_link_key.open_source.js";

export type AgentWebPageLinkKey = AgentWebPageStoredLinkKey | AgentWebPageRoutedLinkKey;

export type AgentWebPageLinkKeyObject =
    | AgentWebPageStoredLinkKeyObject
    | AgentWebPageRoutedLinkKeyObject;

export function printAgentWebPageLinkKey(key: AgentWebPageLinkKeyObject): AgentWebPageLinkKey {
    switch (key.type) {
        case "Skill":
        case "DocumentThread":
        case "TaskMessageList":
        case "TaskSubtasks":
        case "Inbox":
        case "MyAccount":
            return printAgentWebPageRoutedLinkKey(key);
        default:
            return printAgentWebPageStoredLinkKey(key);
    }
}

export function parseAgentWebPageLinkKey(key: AgentWebPageLinkKey): AgentWebPageLinkKeyObject {
    const [type = ""] = key.split(":", 2);

    switch (type) {
        case "Skill":
        case "DocumentThread":
        case "TaskMessageList":
        case "TaskSubtasks":
        case "Inbox":
            return parseAgentWebPageRoutedLinkKey(key as AgentWebPageRoutedLinkKey);
        default:
            return parseAgentWebPageStoredLinkKey(key as AgentWebPageStoredLinkKey);
    }
}
