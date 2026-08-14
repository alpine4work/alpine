import {getAgentConversationDebugItemsForClaudeSession} from "~/server/debug/claude/internal/get_agent_conversation_debug_items_for_claude_session.js";
import {ClaudeConversationItem} from "~/shared/debug/claude/claude_conversation_item.js";

test("flattens a turn\u2019s content blocks into one item each", async () => {
    // Arrange
    const items: ReadonlyArray<ClaudeConversationItem> = [
        {type: "user", message: {role: "user", content: "What time is it?"}},
        {
            type: "assistant",
            message: {
                role: "assistant",
                content: [
                    {type: "text", text: "Let me check."},
                    {type: "tool_use", id: "toolu_01", name: "mcp__alpine__read", input: {a: 1}},
                ],
            },
        },
    ];

    // Act
    const conversationItems = await getAgentConversationDebugItemsForClaudeSession(items);

    // Assert
    expect(conversationItems.map(item => [item.type, item.label])).toEqual([
        ["message", {text: "user", kind: "human"}],
        ["message", {text: "assistant", kind: "agent"}],
        ["tool_use", {text: "mcp__alpine__read", kind: "tool"}],
    ]);
});

test("labels a tool result with the tool it answers", async () => {
    // Arrange
    const items: ReadonlyArray<ClaudeConversationItem> = [
        {
            type: "assistant",
            message: {
                role: "assistant",
                content: [{type: "tool_use", id: "toolu_01", name: "WebFetch", input: {}}],
            },
        },
        {
            type: "user",
            message: {
                role: "user",
                content: [{type: "tool_result", tool_use_id: "toolu_01", content: "Hello!"}],
            },
        },
    ];

    // Act
    const conversationItems = await getAgentConversationDebugItemsForClaudeSession(items);

    // Assert
    expect(conversationItems[1]).toEqual({
        type: "tool_result",
        label: {text: "WebFetch", kind: "tool"},
        tokenCount: expect.any(Number),
        callId: "toolu_01",
        contentHtml: "Hello!\n",
    });
});

test("drops bookkeeping items that aren\u2019t part of the conversation", async () => {
    // Arrange
    const items: ReadonlyArray<ClaudeConversationItem> = [
        {type: "queue-operation", operation: "enqueue"},
        {type: "ai-title", aiTitle: "Checking the time"},
        {type: "mode", mode: "default"},
        {type: "user", message: {role: "user", content: "What time is it?"}},
    ];

    // Act
    const conversationItems = await getAgentConversationDebugItemsForClaudeSession(items);

    // Assert
    expect(conversationItems.map(item => item.type)).toEqual(["message"]);
});

test("keeps a thinking block that wasn\u2019t persisted, without content", async () => {
    // Arrange
    const items: ReadonlyArray<ClaudeConversationItem> = [
        {
            type: "assistant",
            message: {
                role: "assistant",
                content: [{type: "thinking", thinking: "", signature: "abc"}],
            },
        },
    ];

    // Act
    const conversationItems = await getAgentConversationDebugItemsForClaudeSession(items);

    // Assert
    expect(conversationItems).toEqual([
        {
            type: "thinking",
            label: {text: "assistant", kind: "agent"},
            tokenCount: 0,
            callId: null,
            contentHtml: null,
        },
    ]);
});
