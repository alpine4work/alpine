import {Root} from "mdast";
import {AgentConversationState} from "~/server/agents/internal/conversation/agent_conversation_store.js";
import {AgentLinkPaginationType} from "~/server/agents/internal/link_references/agent_link.js";
import {AgentMessage} from "~/server/agents/internal/messages/agent_message.js";
import {printAgentMessagesLog} from "~/server/agents/internal/messages/print_agent_messages_log.js";

export async function parseMessagesListContentToMarkdownRoot({
    previousPageLinkString,
    nextPageLinkString,
    paginationType,
    pageMessages,
    conversationState,
}: {
    previousPageLinkString: string | null;
    nextPageLinkString: string | null;
    paginationType: AgentLinkPaginationType;
    pageMessages: Array<AgentMessage>;
    conversationState: AgentConversationState;
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

    // There shouldn't be a conversation timezone context for the messages returned
    // by a read link tool call.
    const messagesText = printAgentMessagesLog(pageMessages, {
        time: conversationState.startTime,
        timeZone: conversationState.timeZone,
    });
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
