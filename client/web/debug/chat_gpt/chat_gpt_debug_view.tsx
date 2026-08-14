import OpenAi from "openai";
import {useMemo} from "react";
import {AgentConversationDebugView} from "~/client/web/debug/shared/agent_conversation_debug_view.js";
import {ChatGptConversationItem} from "~/shared/debug/chat_gpt/chat_gpt_conversation_item.js";
import {
    AgentConversationDebugItem,
    AgentConversationDebugItemLabel,
} from "~/shared/debug/shared/agent_conversation_debug_item.js";

export function ChatGptDebugView({items}: {items: ReadonlyArray<ChatGptConversationItem>}) {
    const conversationItems = useMemo(
        () => items.map(item => getAgentConversationDebugItemForChatGptItem(item, items)),
        [items],
    );

    return (
        <AgentConversationDebugView
            items={conversationItems}
            emptyText={
                "No ChatGPT conversation history. Start chatting with ChatGPT then reload this " +
                "page to see the internal conversation format."
            }
        />
    );
}

function getAgentConversationDebugItemForChatGptItem(
    item: ChatGptConversationItem,
    items: ReadonlyArray<ChatGptConversationItem>,
): AgentConversationDebugItem {
    return {
        // Only `message` items may omit their type (see `ResponseInputItem.Message`).
        type: item.type ?? "message",
        label: getAgentConversationDebugItemLabelForChatGptItem(item, items),
        tokenCount: item.tokenCount ?? null,
        callId: "call_id" in item ? item.call_id : null,
        contentHtml: item.contentHtml ?? null,
    };
}

function getAgentConversationDebugItemLabelForChatGptItem(
    item: ChatGptConversationItem,
    items: ReadonlyArray<ChatGptConversationItem>,
): AgentConversationDebugItemLabel | null {
    if (item.type === "message") {
        return {
            text: item.role,
            kind: (
                {
                    user: "human",
                    developer: "system",
                    system: "system",
                    assistant: "agent",
                } as const
            )[item.role],
        };
    }

    // A function call is labeled with the function it calls, and its output with the
    // function it came from — which we only know from the call that produced it.
    if (item.type === "function_call") {
        return {text: item.name, kind: "tool"};
    }

    if (item.type === "function_call_output") {
        const functionCall = items.find(
            (otherItem): otherItem is OpenAi.Responses.ResponseFunctionToolCallItem =>
                otherItem.type === "function_call" && otherItem.call_id === item.call_id,
        );

        return functionCall === undefined ? null : {text: functionCall.name, kind: "tool"};
    }

    return null;
}
