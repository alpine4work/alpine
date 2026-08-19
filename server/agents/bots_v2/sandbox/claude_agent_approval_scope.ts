import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.open_source.js";

/**
 * The scopes a user can grant when approving an agent action with
 * `ApprovedForSession`. Granting a scope allows all future actions with that scope
 * in the room without further approvals.
 *
 * - `Write`: The Alpine write tools (`update`, `create`, and `delete`).
 * - `Web`: The web tools (`WebFetch` and `WebSearch`).
 *
 * Which tool falls under which scope is decided by the tool registry in
 * `claude_agent_tool_names.ts`. This module deliberately doesn't know — it sits
 * underneath both the registry and the persisted approvals state so neither has to
 * import the other.
 */
export type ClaudeAgentApprovalScope = "Write" | "Web";

const claudeAgentApprovalScopes: {[scope in ClaudeAgentApprovalScope]: true} = {
    Write: true,
    Web: true,
};

/**
 * Narrows a scope value that came off the wire (an `ApprovedForSession` decision
 * carries whatever the API sent) down to a scope we actually grant, so
 * `ClaudeAgentApprovalsState.allowedScopes` can be keyed by the union rather than
 * by `string`.
 */
export function isClaudeAgentApprovalScope(scope: string): scope is ClaudeAgentApprovalScope {
    return hasOwnProperty(claudeAgentApprovalScopes, scope);
}
