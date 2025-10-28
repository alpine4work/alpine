import {Root} from "mdast";
import {AgentLinkPaginationType} from "~/server/agents/internal/link_references/agent_link.js";
import {AgentMessage} from "~/server/agents/internal/messages/agent_message.js";
import {printAgentMessagesLog} from "~/server/agents/internal/messages/print_agent_messages_log.js";

export async function parseMessagesListContentToMarkdownRoot({
    previousPageLinkString,
    nextPageLinkString,
    paginationType,
    pageMessages,
}: {
    previousPageLinkString: string | null;
    nextPageLinkString: string | null;
    paginationType: AgentLinkPaginationType;
    pageMessages: Array<AgentMessage>;
}): Promise<Root> {
    const children: Root["children"] = [];

    if (previousPageLinkString) {
        children.push({
            type: "paragraph",
            children: [
                {
                    type: "link",
                    url: previousPageLinkString,
                    children: [{type: "text", value: `« Previous ${paginationType}`}],
                },
                // Create an empty line between the previous page link and the messages
                {type: "break"},
                {type: "break"},
            ],
        });
    }
    const messagesText = printAgentMessagesLog(pageMessages);
    if (messagesText) {
        children.push({
            type: "paragraph",
            children: [{type: "text", value: messagesText}],
        });
    }

    if (nextPageLinkString) {
        children.push({
            type: "paragraph",
            children: [
                {type: "break"},
                {
                    type: "link",
                    url: nextPageLinkString,
                    children: [{type: "text", value: `Next ${paginationType} »`}],
                },
            ],
        });
    }

    return {
        type: "root",
        children,
    };
}
