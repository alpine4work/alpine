import {
    ClaudeAgentPendingApproval,
    ClaudeAgentPendingApprovalBatch,
} from "~/server/agents/bots_v2/sandbox/claude_agent_approvals_state.js";
import {ApiBotWebhookUpdatedMessageStreamExperimentalApprovalsPartEvent} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {isMessageApprovalDecisionValueForOption} from "~/shared/messaging/message_schema.js";

export type ClaudeAgentApprovalDecisionValue = NonNullable<
    ApiBotWebhookUpdatedMessageStreamExperimentalApprovalsPartEvent["approvals"][number]["decision"]["value"]
>;

export type ClaudeAgentApprovalDecision = {
    readonly approval: ClaudeAgentPendingApproval;
    readonly value: ClaudeAgentApprovalDecisionValue;
};

export type ClaudeAgentApprovalDecisionWithInput = Omit<ClaudeAgentApprovalDecision, "approval"> & {
    readonly approval: ClaudeAgentPendingApproval & {readonly input: unknown};
};

export type ClaudeAgentApprovalDecisionsMergeResult =
    | {
          readonly type: "FullyDecided";
          readonly decisions: ReadonlyArray<ClaudeAgentApprovalDecision>;
      }
    | {readonly type: "StillPending"}
    | {readonly type: "Mismatch"};

/**
 * Merges the decision values from an approval decision webhook event into a
 * pending approval batch.
 *
 * The webhook resends the full decisions array on every delivery (each decision
 * the user makes triggers a new event), so this is a pure function of the batch
 * and the latest event:
 *
 * - `FullyDecided`: every approval in the batch has a decision. The agent should
 *   resume and act on the decisions.
 * - `StillPending`: some approvals are still awaiting a decision. Nothing to do
 *   yet, a later event will resend everything.
 * - `Mismatch`: the event doesn't line up with the persisted card shape. This
 *   shouldn't happen, so the batch is treated as corrupted.
 */
export function mergeClaudeAgentApprovalDecisions(
    pendingApprovals: ClaudeAgentPendingApprovalBatch,
    approvalDecisions: ApiBotWebhookUpdatedMessageStreamExperimentalApprovalsPartEvent["approvals"],
): ClaudeAgentApprovalDecisionsMergeResult {
    if (pendingApprovals.approvals.length !== approvalDecisions.length) {
        return {type: "Mismatch"};
    }

    const decisions: Array<ClaudeAgentApprovalDecision> = [];

    for (let index = 0; index < pendingApprovals.approvals.length; index++) {
        const approval = assertExists(pendingApprovals.approvals[index]);
        const value = assertExists(approvalDecisions[index]).decision.value;

        if (value === undefined) {
            return {type: "StillPending"};
        }

        if (
            !Array.isArray(approval.decisionOptions) ||
            !approval.decisionOptions.some(option => {
                return isMessageApprovalDecisionValueForOption(option, value);
            })
        ) {
            return {type: "Mismatch"};
        }

        decisions.push({approval, value});
    }

    return {type: "FullyDecided", decisions};
}

/**
 * A decided approval for one of the built-in web tools. Narrowed on `toolName`
 * rather than tagged with an invented discriminator, so the fact that it's a web
 * decision is something the type knows instead of something the producer has to
 * remember to stamp on.
 */
export type ClaudeAgentWebApprovalDecision = ClaudeAgentApprovalDecisionWithInput & {
    readonly approval: {readonly toolName: "WebFetch" | "WebSearch"};
};
