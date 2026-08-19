import {ClaudeAgentApprovalScope} from "~/server/agents/bots_v2/sandbox/claude_agent_approval_scope.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.open_source.js";

/**
 * Every tool the Claude agent can call, and the approval scope guarding it. `null`
 * means the tool runs without asking anyone — it's read-only against Alpine, or
 * the SDK's own skill loader, so there's nothing for prompt injection to
 * exfiltrate or destroy through it.
 *
 * This map is the whole registry. Adding an entry is what registers the tool
 * (`run_claude_agent.ts` builds the SDK's `tools`/`allowedTools` from it), and
 * writing the entry is what classifies it — there's no way to add a tool without
 * answering "does this need approval?", because the answer is the value.
 *
 * The one gap is the Alpine MCP server: `options.tools` constrains built-in tools
 * only, so a tool added to `createClaudeAgentMcpServer()` reaches the model
 * whether or not it appears here. That's what the gate's fail-closed default is
 * for — such a tool is denied at runtime until someone classifies it.
 */
const claudeAgentToolApprovalScopes = {
    Skill: null,
    mcp__alpine__read: null,
    mcp__alpine__search: null,
    mcp__alpine__scroll: null,
    mcp__alpine__find: null,
    mcp__alpine__update: "Write",
    mcp__alpine__create: "Write",
    mcp__alpine__delete: "Write",
    WebFetch: "Web",
    WebSearch: "Web",
} as const satisfies {[toolName: string]: ClaudeAgentApprovalScope | null};

type ClaudeAgentToolApprovalScopes = typeof claudeAgentToolApprovalScopes;

export type ClaudeAgentToolName = keyof ClaudeAgentToolApprovalScopes;

/**
 * The tools that need a user's approval before they run.
 *
 * In production a user must approve these to make sure an attacker isn't using
 * prompt injection to exfiltrate or destroy information.
 */
export type ClaudeAgentGatedToolName = {
    [Name in ClaudeAgentToolName]: ClaudeAgentToolApprovalScopes[Name] extends null ? never : Name;
}[ClaudeAgentToolName];

export type ClaudeAgentUngatedToolName = Exclude<ClaudeAgentToolName, ClaudeAgentGatedToolName>;

/** Every tool name, in the shape the SDK's `tools` option wants. */
export const claudeAgentToolNames = getObjectKeysWithKeyofType(claudeAgentToolApprovalScopes);

/**
 * The tools we auto-allow, in the shape the SDK's `allowedTools` option wants.
 * Gated tools are deliberately absent: the gate decides those explicitly, and
 * keeping them out is defense in depth for the case where it doesn't run.
 */
export const claudeAgentUngatedToolNames = claudeAgentToolNames.filter(
    isClaudeAgentUngatedToolName,
);

/**
 * Narrows a tool name from the SDK's bare `string` to one that needs approval,
 * which is what lets a pending approval carry a meaningful tool name instead of an
 * opaque string.
 */
export function isClaudeAgentGatedToolName(toolName: string): toolName is ClaudeAgentGatedToolName {
    const registeredToolName = claudeAgentToolNames.find(name => name === toolName);
    return (
        registeredToolName !== undefined &&
        claudeAgentToolApprovalScopes[registeredToolName] !== null
    );
}

/** Whether a tool is registered and intentionally allowed without approval. */
export function isClaudeAgentUngatedToolName(
    toolName: string,
): toolName is ClaudeAgentUngatedToolName {
    const registeredToolName = claudeAgentToolNames.find(name => name === toolName);
    return registeredToolName !== undefined && !isClaudeAgentGatedToolName(registeredToolName);
}

/** The approval scope guarding a gated tool. */
export function getClaudeAgentGatedToolScope(
    toolName: ClaudeAgentGatedToolName,
): ClaudeAgentApprovalScope {
    return claudeAgentToolApprovalScopes[toolName];
}

/**
 * Whether a gated tool is one of the built-in web tools — the ones we can't run
 * ourselves, so an approved call has to be re-driven by the CLI through the gate.
 *
 * A predicate rather than a `getClaudeAgentGatedToolScope(...) === "Web"`
 * comparison so callers carry the narrowed tool name into their own types instead
 * of re-asserting the fact later.
 */
export function isClaudeAgentWebToolName(
    toolName: ClaudeAgentGatedToolName,
): toolName is "WebFetch" | "WebSearch" {
    return claudeAgentToolApprovalScopes[toolName] === "Web";
}
