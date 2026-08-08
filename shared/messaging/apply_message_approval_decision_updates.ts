import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {omitObject} from "~/shared/helpers/object/omit_object.open_source.js";
import {
    createMessageApprovalAlreadyDecidedError,
    createMessageApprovalNotFoundError,
} from "~/shared/messaging/message_approval_error_messages.js";
import {
    MessageExperimentalApproval,
    MessageExperimentalApprovalDecisionValue,
    MessageStreamExperimentalApprovalsPartPayload,
    isMessageApprovalDecisionValueForOption,
} from "~/shared/messaging/message_schema.js";

export type MessageApprovalDecisionUpdate = {
    readonly approvalIndex: number;
    readonly decisionValue: MessageExperimentalApprovalDecisionValue;
};

export type ApplyMessageApprovalDecisionUpdatesResult = {
    /**
     * The approval decisions that were actually changed by the action.
     */
    readonly decisionUpdates: ReadonlyArray<MessageApprovalDecisionUpdate>;
    /**
     * The MessageApproval after the action has been applied.
     */
    readonly approvalPayload: MessageStreamExperimentalApprovalsPartPayload;
};

export function applyMessageApprovalDecisionUpdates(
    approvalPayload: MessageStreamExperimentalApprovalsPartPayload,
    {
        decisions,
        shouldExpandScopeKeys,
    }: {
        decisions: ReadonlyArray<{
            index: number;
            value: MessageExperimentalApprovalDecisionValue;
        }>;
        shouldExpandScopeKeys: boolean;
    },
): ApplyMessageApprovalDecisionUpdatesResult {
    const originalApprovals = approvalPayload.approvals;

    // Decided approvals keyed by their index. We accumulate here and materialize both
    // the final approvals array and the list of changed decisions with a single pass
    // at the end.
    const approvalsWithNewDecisionValues = new Map<number, MessageExperimentalApproval>();
    const visitedKeys = new Set<string>();

    function approvalAt(index: number): MessageExperimentalApproval {
        const approval = approvalsWithNewDecisionValues.get(index) ?? originalApprovals[index];
        if (!approval) throw createMessageApprovalNotFoundError();
        return approval;
    }

    function decide(index: number, decisionValue: MessageExperimentalApprovalDecisionValue) {
        const existingApproval = approvalAt(index);

        // `setMessageApprovalDecisionValue` throws if the approval was already decided.
        approvalsWithNewDecisionValues.set(
            index,
            setMessageApprovalDecisionValue(existingApproval, decisionValue),
        );
    }

    for (const decision of decisions) {
        if (decision.value.type === "ApprovedForSession") {
            const scopeKey = decision.value.scope.value;

            // If we approve all approvals with the same scope key and we've already seen this
            // scope key, then there's no reason to try to apply the approval decision again.
            // In fact, if we were to remove this check, we would fail in the
            // `setMessageApprovalDecisionValue` routine since we would technically be trying
            // to set a decision value that already exists.
            if (scopeKey && shouldExpandScopeKeys && visitedKeys.has(scopeKey)) {
                continue;
            }
        }

        decide(decision.index, decision.value);

        if (shouldExpandScopeKeys) {
            applyApprovalScopeKeyExpansion({
                originalApprovals,
                sourceApprovalIndex: decision.index,
                decisionValue: decision.value,
                approvalAt,
                decide,
            });
        }

        if (decision.value.type === "ApprovedForSession") {
            visitedKeys.add(decision.value.scope.value);
        }
    }

    if (approvalsWithNewDecisionValues.size === 0) {
        return {approvalPayload, decisionUpdates: []};
    }

    return {
        approvalPayload: {
            ...approvalPayload,
            approvals: originalApprovals.map(
                (approval, index) => approvalsWithNewDecisionValues.get(index) ?? approval,
            ),
        },
        decisionUpdates: Array.from(
            approvalsWithNewDecisionValues,
            ([approvalIndex, approval]) => ({
                approvalIndex,
                decisionValue: assertExists(approval.decision.value),
            }),
        ),
    };
}

function applyApprovalScopeKeyExpansion({
    originalApprovals,
    sourceApprovalIndex,
    decisionValue,
    approvalAt,
    decide,
}: {
    originalApprovals: ReadonlyArray<MessageExperimentalApproval>;
    sourceApprovalIndex: number;
    decisionValue: MessageExperimentalApprovalDecisionValue;
    approvalAt: (index: number) => MessageExperimentalApproval;
    decide: (index: number, decisionValue: MessageExperimentalApprovalDecisionValue) => void;
}) {
    if (decisionValue.type !== "ApprovedForSession") return;
    if (decisionValue.scope === undefined) return;

    for (let approvalIndex = 0; approvalIndex < originalApprovals.length; approvalIndex++) {
        if (approvalIndex === sourceApprovalIndex) continue;

        const approval = approvalAt(approvalIndex);

        // Expansion is a convenience sweep over the approvals that are still pending. An
        // approval that was already decided — earlier in this batch or in a previous
        // action — keeps its decision; only an explicit decision on a decided approval is
        // an error.
        if (approval.decision.value !== undefined) continue;

        if (!hasMatchingApprovalScopeKey(approval, decisionValue)) continue;

        decide(approvalIndex, decisionValue);
    }
}

function hasMatchingApprovalScopeKey(
    approval: MessageExperimentalApproval,
    decisionValue: Extract<
        MessageExperimentalApprovalDecisionValue,
        {readonly type: "ApprovedForSession"}
    >,
): boolean {
    const decisionScopeKey = decisionValue.scope.value;

    return approval.decision.schema.options.some(option => {
        if (option.type !== "ApprovedForSession") return false;

        if (option.scope.value !== decisionScopeKey) return false;

        const optionWithoutSummary = omitObject(option, ["summary"]);
        const decisionValueWithoutDecider = omitObject(decisionValue, ["decider"]);
        assertEqualTypes<typeof decisionValueWithoutDecider, typeof optionWithoutSummary>();
        return isDeepEqual(decisionValueWithoutDecider, optionWithoutSummary);
    });
}

function setMessageApprovalDecisionValue(
    approval: MessageExperimentalApproval,
    decisionValue: MessageExperimentalApprovalDecisionValue,
): MessageExperimentalApproval {
    if (approval.decision.value !== undefined) throw createMessageApprovalAlreadyDecidedError();

    if (
        !approval.decision.schema.options.some(option =>
            isMessageApprovalDecisionValueForOption(option, decisionValue),
        )
    ) {
        // NOTE(ifitzsimmons, 2026-07-09): The error message here has a display message so
        // that our API clients can display more helpful error messages to users.
        throw new FailedPreconditionError("Invalid approval decision.", {
            displayMessage: errorDisplayMessage`Approval decision isn\u2019t a valid option.`,
        });
    }

    return {
        ...approval,
        decision: {
            ...approval.decision,
            value: decisionValue,
        },
    };
}

export function setMessageApprovalDecisionValueForTest(
    approval: MessageExperimentalApproval,
    decisionValue: MessageExperimentalApprovalDecisionValue,
): MessageExperimentalApproval {
    assert(import.meta.jest);

    return setMessageApprovalDecisionValue(approval, decisionValue);
}
