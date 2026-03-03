import {RootContent} from "mdast";
import {AgentConversationState} from "~/server/agents/internal/conversation/agent_conversation_store.js";
import {AgentLinkPaginationType} from "~/server/agents/internal/link_references/agent_link.js";
import {AgentMessage} from "~/server/agents/internal/messages/agent_message.js";
import {printAgentMessagesIntoMarkdownTree} from "~/server/agents/internal/messages/print_agent_messages_log.js";

export async function printMessagesListContentToMarkdownRoot({
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
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
}): Promise<Array<RootContent>> {
    const content: Array<RootContent> = [];

    if (previousPageLinkString) {
        content.push({
            type: "paragraph",
            children: [
                {
                    type: "link",
                    url: previousPageLinkString,
                    children: [{type: "text", value: `« Previous ${paginationType}`}],
                },
            ],
        });
    }

    // There shouldn't be a conversation timezone context for the messages returned by
    // a read link tool call.
    const messagesContent = printAgentMessagesIntoMarkdownTree(pageMessages, {
        time: conversationState.startTime,
        timeZone: conversationState.timeZone,
    });

    for (const element of messagesContent) {
        content.push(element);
    }

    if (nextPageLinkString) {
        content.push({
            type: "paragraph",
            children: [
                {
                    type: "link",
                    url: nextPageLinkString,
                    children: [{type: "text", value: `Next ${paginationType} »`}],
                },
            ],
        });
    }

    return content;
}
