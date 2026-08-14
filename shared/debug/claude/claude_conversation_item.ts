import {
    AgentConversationDebugItem,
    AgentConversationDebugItemSchema,
} from "~/shared/debug/shared/agent_conversation_debug_item.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * A single line from the Claude Agent SDK session transcript (one JSONL entry).
 *
 * Session items are heterogeneous — `user`/`assistant` turns, plus bookkeeping
 * items like `queue-operation`, `ai-title`, `last-prompt`, `mode`, and
 * `attachment`. We type the fields the pretty view annotates and keep an index
 * signature so the raw entry is preserved untouched (nothing is lost, and the raw
 * JSON view can render the full object).
 */
export type ClaudeConversationItem = {
    /**
     * The item kind. Known values: `user`, `assistant`, `queue-operation`, `ai-title`,
     * `last-prompt`, `mode`, `attachment`. Typed as `string` so new kinds still
     * round-trip.
     */
    readonly type: string;

    readonly uuid?: string;
    readonly parentUuid?: string | null;
    readonly timestamp?: string;
    readonly sessionId?: string;
    readonly isMeta?: boolean;
    readonly isSidechain?: boolean;

    /**
     * Present on `user` items that carry a gate outcome. `user-rejected` marks a
     * parked or injected rejection for a gated tool call.
     */
    readonly toolDenialKind?: string;

    /** Present on `user` and `assistant` items. */
    readonly message?: ClaudeConversationItemMessage;

    /** Present on `ai-title` items. */
    readonly aiTitle?: string;
    /** Present on `last-prompt` items — the prompt used to resume the session. */
    readonly lastPrompt?: string;
    /** Present on `mode` items. */
    readonly mode?: string;
    /** Present on `queue-operation` items (`enqueue` / `dequeue`). */
    readonly operation?: string;
    /** Present on `attachment` items. */
    readonly attachment?: {readonly type?: string; readonly [key: string]: unknown};

    // Preserve every other field from the raw entry so nothing is lost.
    readonly [key: string]: unknown;
};

/** The `message` payload of a `user` or `assistant` session item. */
export type ClaudeConversationItemMessage = {
    readonly role?: string;
    /**
     * `<synthetic>` marks a CLI-synthesized assistant message (e.g. "No response
     * requested.") that isn't a real model call.
     */
    readonly model?: string;
    /**
     * A string (a resume nudge like "Continue from where you left off.") or an array
     * of content blocks.
     */
    readonly content?: string | ReadonlyArray<ClaudeConversationItemContentBlock>;
    readonly [key: string]: unknown;
};

/**
 * A content block inside a message: `text`, `thinking`, `tool_use`, or
 * `tool_result`.
 */
export type ClaudeConversationItemContentBlock = {
    readonly type: string;

    // `text`
    readonly text?: string;

    // `thinking` (its persisted `thinking` text is often empty, but it always has a
    // `signature`)
    readonly thinking?: string;
    readonly signature?: string;

    // `tool_use`
    readonly id?: string;
    readonly name?: string;
    readonly input?: unknown;

    // `tool_result`
    readonly tool_use_id?: string;
    readonly content?: string | ReadonlyArray<ClaudeConversationItemToolResultBlock>;
    readonly is_error?: boolean;

    readonly [key: string]: unknown;
};

/** A block inside a `tool_result`'s array-shaped `content`. */
export type ClaudeConversationItemToolResultBlock = {
    readonly type: string;
    readonly text?: string;
    readonly [key: string]: unknown;
};

/**
 * The Claude agent's persisted `state.json` (`ClaudeAgentState` in the sandbox),
 * read straight from R2. Every field is optional/passthrough so the debugger keeps
 * working whether or not the approvals feature has shipped.
 */
export type ClaudeAgentDebugState = {
    readonly sessionId?: string | null;
    readonly room?: ClaudeAgentDebugRoomState | null;
    readonly [key: string]: unknown;
};

export type ClaudeAgentDebugRoomState = {
    readonly timeZone?: string;
    readonly pageLinkKey?: string;
    readonly lastMessageIndex?: number | string;
    readonly [key: string]: unknown;
};

/**
 * Everything the Claude agent debugger renders for one conversation: which bot and
 * session are shown, the persisted `state.json`, the conversation state as the
 * model sees it, and the ordered session transcript items.
 */
export type ClaudeConversationDebugData = {
    /**
     * The Claude bot's account id in the space, or `null` if it isn't instantiated.
     */
    readonly botAccountId: string | null;
    /**
     * The R2 sandbox prefix (`{botAccountId}/{roomKey}`), or `null` when unresolved.
     */
    readonly sandboxId: string | null;
    /** The session id from `state.json`, or `null` when there's no session yet. */
    readonly sessionId: string | null;
    /** The Claude Agent SDK project key the transcript lives under, if found. */
    readonly projectKey: string | null;
    readonly state: ClaudeAgentDebugState | null;
    /**
     * The session transcript flattened into the conversation the model sees, shared
     * with the ChatGPT debugger (see
     * `get_agent_conversation_debug_items_for_claude_session.ts`).
     */
    readonly conversationItems: ReadonlyArray<AgentConversationDebugItem>;
    readonly items: ReadonlyArray<ClaudeConversationItem>;
};

// Session items are heterogeneous, so we pass each raw JSONL entry through
// untouched (typed, but unvalidated) — mirroring `ChatGptConversationItemSchema`.
export const ClaudeConversationItemSchema = Schema.unknown<ClaudeConversationItem>();

export const ClaudeAgentDebugStateSchema = Schema.unknown<ClaudeAgentDebugState>();

export const ClaudeConversationDebugDataSchema = Schema.object({
    botAccountId: Schema.string.nullable(),
    sandboxId: Schema.string.nullable(),
    sessionId: Schema.string.nullable(),
    projectKey: Schema.string.nullable(),
    state: ClaudeAgentDebugStateSchema.nullable(),
    conversationItems: Schema.array(AgentConversationDebugItemSchema),
    items: Schema.array(ClaudeConversationItemSchema),
});

/**
 * The `GET /claude/conversation-state` response, deserialized by the debug loader
 * (see `handle_claude_agent_conversation_state_request.ts` and
 * `load_claude_conversation_items.ts`). Mirrors
 * `ChatGptConversationStateResponseSchema`.
 */
export const ClaudeConversationStateResponseSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        sandboxId: Schema.string,
        sessionId: Schema.string.nullable(),
        projectKey: Schema.string.nullable(),
        state: ClaudeAgentDebugStateSchema.nullable(),
        items: Schema.array(ClaudeConversationItemSchema),
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);
