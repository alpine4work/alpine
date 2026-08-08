import {MessageContentSchema} from "~/shared/content/message_content_schema.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {createMessageApprovalAlreadyDecidedError} from "~/shared/messaging/message_approval_error_messages.js";
import {
    MessageExperimentalApprovalDecisionSchemaSchema,
    MessageExperimentalApprovalSchema,
    MessageStreamExperimentalApprovalsPartPayload,
} from "~/shared/messaging/message_schema.js";
import {isDeepEqualWithSchema} from "~/shared/schema/helpers/is_deep_equal_with_schema.js";

/**
 * Approval parts may be updated after stream completion, but only their pending
 * decisions may transition. Request summaries and terminal decisions are
 * immutable.
 */
export function validateMessageStreamApprovalStatusUpdate(
    previous: MessageStreamExperimentalApprovalsPartPayload,
    next: MessageStreamExperimentalApprovalsPartPayload,
) {
    if (previous.approvals.length !== next.approvals.length) {
        throw new FailedPreconditionError("Approval request details cannot be changed");
    }

    for (let index = 0; index < previous.approvals.length; index++) {
        const previousApproval = assertExists(previous.approvals[index]);
        const nextApproval = assertExists(next.approvals[index]);
        if (
            !isDeepEqualWithSchema(
                MessageContentSchema,
                previousApproval.summary,
                nextApproval.summary,
            ) ||
            !isDeepEqualWithSchema(
                MessageExperimentalApprovalDecisionSchemaSchema,
                previousApproval.decision.schema,
                nextApproval.decision.schema,
            )
        ) {
            throw new FailedPreconditionError("Approval request details cannot be changed");
        }

        if (
            previousApproval.decision.value !== undefined &&
            !isDeepEqualWithSchema(
                MessageExperimentalApprovalSchema,
                previousApproval,
                nextApproval,
            )
        ) {
            throw createMessageApprovalAlreadyDecidedError();
        }
    }
}
