import {Schema} from "~/shared/schema/schema.js";

/**
 * One item of an agent's conversation state — the history as the model sees it —
 * in the shape our agent debuggers render.
 *
 * ChatGPT and Claude store conversations differently (a flat list of Responses API
 * items versus a JSONL session transcript of messages with content blocks), but
 * both describe the same thing: messages, tool calls, and tool outputs. Each
 * debugger converts its provider format into this one so they share a single view
 * (see `agent_conversation_debug_view.tsx`).
 */
export type AgentConversationDebugItem = {
    /** The provider's item type, e.g. `message`, `function_call`, or `tool_use`. */
    readonly type: string;

    /** Who the item came from, rendered before `type`. `null` when unattributed. */
    readonly label: AgentConversationDebugItemLabel | null;

    /**
     * Approximate number of tokens the item's content contributes to the context.
     */
    readonly tokenCount: number | null;

    /** Ties a tool call to its output. Truncated when rendered. */
    readonly callId: string | null;

    /**
     * Syntax highlighted HTML of the item's content, or `null` when it has none.
     */
    readonly contentHtml: string | null;
};

/**
 * The author of an `AgentConversationDebugItem`: a role name or a tool name.
 */
export type AgentConversationDebugItemLabel = {
    readonly text: string;
    readonly kind: AgentConversationDebugItemLabelKind;
};

/** What a label names, which decides the color it's rendered in. */
export type AgentConversationDebugItemLabelKind = "human" | "agent" | "system" | "tool";

export const AgentConversationDebugItemSchema: Schema<AgentConversationDebugItem> = Schema.object({
    type: Schema.string,
    label: Schema.object({
        text: Schema.string,
        kind: Schema.enum<AgentConversationDebugItemLabelKind>([
            "human",
            "agent",
            "system",
            "tool",
        ]),
    }).nullable(),
    tokenCount: Schema.integer.nullable(),
    callId: Schema.string.nullable(),
    contentHtml: Schema.string.nullable(),
});
