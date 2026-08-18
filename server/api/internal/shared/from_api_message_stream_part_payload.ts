import {fromApiContent} from "~/shared/api/content/closed_source/from_api_content.js";
import {fromApiLabelContent} from "~/shared/api/content/closed_source/from_api_label_content.js";
import {
    ApiMessageExperimentalApproval,
    ApiMessageExperimentalApprovalDecisionOption,
    ApiMessageStreamPartPayload,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {
    MessageExperimentalApproval,
    MessageExperimentalApprovalDecisionOption,
    MessageStreamPartPayload,
} from "~/shared/messaging/message_schema.js";

export function fromApiMessageStreamPartPayload(
    payload: ApiMessageStreamPartPayload,
): MessageStreamPartPayload {
    switch (payload.type) {
        case "Content": {
            const content = assertMessageContent(
                fromApiContent(MessageContentProsemirrorSchema, payload.content),
            );
            return {type: "Content", content};
        }
        case "ToolCall": {
            return {
                type: "ToolCall",
                call: {
                    content: fromApiLabelContent(payload.call.content),
                    annotations: payload.call.annotations,
                },
            };
        }
        case "Reasoning": {
            return {
                type: "Reasoning",
                content: assertMessageContent(
                    fromApiContent(MessageContentProsemirrorSchema, payload.content),
                ),
            };
        }
        case "ExperimentalApprovals": {
            return {
                type: "ExperimentalApprovals",
                approvals: payload.approvals.map(fromApiMessageExperimentalApproval),
            };
        }
        default:
            throw exhaustive(payload);
    }
}

function fromApiMessageExperimentalApproval(
    approval: ApiMessageExperimentalApproval,
): MessageExperimentalApproval {
    assert(approval.decision.schema.options.length >= 1);
    return {
        summary: fromApiLabelContent(approval.summary),
        decision: {
            schema: {
                options: approval.decision.schema.options.map(
                    fromApiMessageExperimentalApprovalDecisionOption,
                ),
            },
            // ExperimentalApprovals written through a stream part are always pending. The API
            // request decision value carries no `decider`, and decisions are recorded through
            // the approvals endpoint, which attributes them to the deciding account.
        },
    };
}

function fromApiMessageExperimentalApprovalDecisionOption(
    option: ApiMessageExperimentalApprovalDecisionOption,
): MessageExperimentalApprovalDecisionOption {
    switch (option.type) {
        case "Approved":
        case "Rejected":
            return option;
        case "ApprovedForSession":
            return {
                ...option,
                summary:
                    option.summary === undefined ? undefined : fromApiLabelContent(option.summary),
            };
        default:
            throw exhaustive(option);
    }
}
