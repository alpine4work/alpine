import {fireEvent, render, screen} from "@testing-library/react";
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

test("anchors decided approvals using every persisted tool use id", () => {
    const toolUseId = "toolu_0123456789abcdefghijklmn";
    const otherToolUseId = "toolu_not_present_in_the_transcript";
    const dataWithApproval: ClaudeConversationDebugData = {
        ...data,
        state: {
            ...data.state,
            approvals: {
                decidedBatches: [
                    {
                        messageIndex: 2,
                        decidedTime: "2026-08-17T12:00:00.000Z",
                        approvals: [
                            {
                                toolUseIds: [otherToolUseId, toolUseId],
                                toolName: "WebFetch",
                                scope: "Web",
                                decision: "Approved",
                            },
                        ],
                    },
                ],
            },
        },
        items: [
            {
                type: "assistant",
                message: {
                    role: "assistant",
                    content: [{type: "tool_use", id: toolUseId, name: "WebFetch", input: {}}],
                },
            },
            {
                type: "user",
                message: {role: "user", content: "After call"},
            },
        ],
    };

    render(<ClaudeDebugView data={dataWithApproval} />);
    fireEvent.click(screen.getByText("Annotated"));

    const approvalDecision = screen.getByText("approval decided");
    expect(
        approvalDecision.compareDocumentPosition(screen.getByText("After call")) &
            Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
        screen.getByText(`#${otherToolUseId.slice(-4)}, #${toolUseId.slice(-4)}`),
    ).toBeInTheDocument();
});
