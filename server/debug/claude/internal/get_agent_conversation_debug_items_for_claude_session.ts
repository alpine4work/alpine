import {countTokens as countO200kBaseTokens} from "gpt-tokenizer/esm/encoding/o200k_base";
import {
    AgentConversationDebugContentLanguage,
    printAgentConversationDebugContentHtml,
} from "~/server/debug/shared/print_agent_conversation_debug_content_html.js";
import {
    ClaudeConversationItem,
    ClaudeConversationItemContentBlock,
} from "~/shared/debug/claude/claude_conversation_item.js";
import {
    AgentConversationDebugItem,
    AgentConversationDebugItemLabel,
} from "~/shared/debug/shared/agent_conversation_debug_item.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";

// A conversation item before its content is formatted and highlighted.
type ClaudeSessionDebugContent = {
    readonly type: string;
    readonly label: AgentConversationDebugItemLabel | null;
    readonly callId: string | null;
    readonly tokenCount: number | null;
    readonly text: string;
    readonly language: AgentConversationDebugContentLanguage;
};

/**
 * Converts a Claude Agent SDK session transcript into the conversation state the
 * model sees, in the shape our agent debuggers render (see
 * `agent_conversation_debug_item.ts`).
 *
 * The transcript is a JSONL log, so it carries more than the conversation: each
 * `user`/`assistant` turn bundles several content blocks, and bookkeeping entries
 * (`queue-operation`, `ai-title`, `mode`, …) aren't part of the conversation at
 * all. We drop the bookkeeping and flatten every content block into its own item,
 * which lines the Claude conversation up with the flat item list ChatGPT's
 * Responses API gives us. The Claude debugger's other views still render the raw
 * transcript.
 *
 * Token counts are approximate: we count with the same tokenizer as the ChatGPT
 * debugger (Claude's tokenizer isn't public) so item sizes are comparable across
 * both debuggers, but they won't match Claude's own accounting exactly.
 */
export async function getAgentConversationDebugItemsForClaudeSession(
    items: ReadonlyArray<ClaudeConversationItem>,
): Promise<ReadonlyArray<AgentConversationDebugItem>> {
    // `tool_use` id → tool name, so a `tool_result` can be labeled with the tool it
    // answers (like the ChatGPT debugger labels a `function_call_output`).
    const toolNameByToolUseId = new Map<string, string>();

    for (const item of items) {
        for (const block of getClaudeContentBlocks(item)) {
            if (
                block.type === "tool_use" &&
                typeof block.id === "string" &&
                typeof block.name === "string"
            ) {
                toolNameByToolUseId.set(block.id, block.name);
            }
        }
    }

    const contents: Array<ClaudeSessionDebugContent> = [];

    for (const item of items) {
        if (item.type !== "user" && item.type !== "assistant") continue;

        const label: AgentConversationDebugItemLabel =
            item.type === "user"
                ? {text: "user", kind: "human"}
                : {text: "assistant", kind: "agent"};

        // A string `content` is a plain message (e.g. the harness' resume nudge).
        if (typeof item.message?.content === "string") {
            contents.push({
                type: "message",
                label,
                callId: null,
                tokenCount: countO200kBaseTokens(item.message.content),
                text: item.message.content,
                language: "markdown",
            });
            continue;
        }

        for (const block of getClaudeContentBlocks(item)) {
            contents.push(getClaudeSessionDebugContent(block, label, toolNameByToolUseId));
        }
    }

    return await runAllPromises(
        contents.map(async content => ({
            type: content.type,
            label: content.label,
            tokenCount: content.tokenCount,
            callId: content.callId,
            contentHtml:
                content.text.length === 0
                    ? null
                    : await printAgentConversationDebugContentHtml(content.text, content.language),
        })),
    );
}

function getClaudeSessionDebugContent(
    block: ClaudeConversationItemContentBlock,
    label: AgentConversationDebugItemLabel,
    toolNameByToolUseId: ReadonlyMap<string, string>,
): ClaudeSessionDebugContent {
    switch (block.type) {
        case "text": {
            const text = block.text ?? "";
            return {
                type: "message",
                label,
                callId: null,
                tokenCount: countO200kBaseTokens(text),
                text,
                language: "markdown",
            };
        }

        case "thinking": {
            // Thinking text often isn't persisted (only its signature is), which shows up here
            // as an item with no content.
            const text = block.thinking ?? "";
            return {
                type: "thinking",
                label,
                callId: null,
                tokenCount: countO200kBaseTokens(text),
                text,
                language: "markdown",
            };
        }

        case "tool_use":
            return {
                type: "tool_use",
                label: {text: block.name ?? "tool", kind: "tool"},
                callId: typeof block.id === "string" ? block.id : null,
                // Like the ChatGPT debugger, we don't count the tokens of a tool call's arguments
                // — only of the messages and tool output around it.
                tokenCount: null,
                text: printClaudeJson(block.input),
                language: "json",
            };

        case "tool_result": {
            const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : null;
            const toolName = toolUseId === null ? undefined : toolNameByToolUseId.get(toolUseId);
            const text = getClaudeToolResultText(block.content);

            return {
                type: "tool_result",
                label: toolName === undefined ? null : {text: toolName, kind: "tool"},
                callId: toolUseId,
                tokenCount: countO200kBaseTokens(text),
                text,
                language: "markdown",
            };
        }

        default:
            return {
                type: block.type,
                label,
                callId: null,
                tokenCount: null,
                text: printClaudeJson(block),
                language: "json",
            };
    }
}

function getClaudeContentBlocks(
    item: ClaudeConversationItem,
): ReadonlyArray<ClaudeConversationItemContentBlock> {
    const content = item.message?.content;
    if (content === undefined || typeof content === "string") return [];
    return content;
}

function getClaudeToolResultText(content: ClaudeConversationItemContentBlock["content"]): string {
    if (content === undefined) return "";
    if (typeof content === "string") return content;

    return content
        .map(block => (typeof block.text === "string" ? block.text : printClaudeJson(block)))
        .join("\n");
}

function printClaudeJson(value: unknown): string {
    if (value === undefined) return "";
    // Session items are parsed from JSON, so they're always serializable. We stringify
    // even a plain string so the result is valid JSON for the formatter.
    return JSON.stringify(value, null, 2);
}
