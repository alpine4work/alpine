import {ClaudeAgentApprovalScope} from "~/server/agents/bots_v2/sandbox/claude_agent_approval_scope.js";
import {ClaudeAgentApprovalDecisionOptions} from "~/server/agents/bots_v2/sandbox/claude_agent_approvals_state.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/** Builds the exact options persisted with and rendered by an approval card. */
export function buildClaudeAgentApprovalDecisionOptions(
    scope: ClaudeAgentApprovalScope,
): ClaudeAgentApprovalDecisionOptions {
    return [
        {type: "Approved"},
        {type: "Rejected"},
        {
            type: "ApprovedForSession",
            scope: {value: scope},
            summary: {
                elements: [{type: "Text", text: getClaudeAgentApprovalScopeSummaryText(scope)}],
            },
            durationMinutes: 4 * 60,
        },
    ];
}

function getClaudeAgentApprovalScopeSummaryText(scope: ClaudeAgentApprovalScope): string {
    switch (scope) {
        case "Write":
            return "all writes";
        case "Web":
            return "all web access";
        default:
            throw exhaustive(scope);
    }
}
