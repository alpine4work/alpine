import {render, screen} from "@testing-library/react";
import {ClaudeDebugView} from "~/client/web/debug/claude/claude_debug_view.js";
import {ClaudeConversationDebugData} from "~/shared/debug/claude/claude_conversation_item.js";

const data: ClaudeConversationDebugData = {
    botAccountId: "account_1",
    sandboxId: "account_1/chats/chat_1",
    sessionId: "session_1",
    projectKey: "-workspace",
    state: {sessionId: "session_1", room: {timeZone: "America/New_York"}},
    conversationItems: [
        {
            type: "message",
            label: {text: "user", kind: "human"},
            tokenCount: 4,
            callId: null,
            contentHtml: "What time is it?",
        },
        {
            type: "tool_use",
            label: {text: "WebFetch", kind: "tool"},
            tokenCount: null,
            callId: "toolu_0123456789abcdefghijklmn",
            contentHtml: "{}",
        },
    ],
    items: [{type: "user", message: {role: "user", content: "What time is it?"}}],
};

test("shows the conversation state by default", () => {
    // Arrange, Act
    render(<ClaudeDebugView data={data} />);

    // Assert
    expect(screen.getByText("2 conversation items")).toBeInTheDocument();
    expect(screen.getByText("What time is it?")).toBeInTheDocument();
    expect(screen.getByText("WebFetch")).toBeInTheDocument();
});
