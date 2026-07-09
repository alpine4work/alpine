import {fromApiContent} from "~/shared/api/content/from_api_content.js";
import {printApiMentionTarget} from "~/shared/api/specification/parse_api_path.js";
import {
    ApiLabelContent,
    ApiMessageExperimentalApproval,
    ApiMessageExperimentalApprovalDecisionOption,
    ApiMessageStreamPartPayload,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    MessageContent,
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
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
            switch (payload.call.type) {
                case "Read": {
                    return {
                        type: "ToolCall",
                        call: {
                            type: "Read",
                            targetPath: printApiMentionTarget(payload.call.target),
                        },
                    };
                }
                case "Search": {
                    return {
                        type: "ToolCall",
                        call: {
                            type: "Search",
                            query: payload.call.query,
                        },
                    };
                }
                case "Create": {
                    return {
                        type: "ToolCall",
                        call: {
                            type: "Create",
                            target: payload.call.target,
                        },
                    };
                }
                default:
                    throw exhaustive(payload.call);
            }
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
        summary: fromApiMessageExperimentalApprovalSummary(approval.summary),
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

function fromApiMessageExperimentalApprovalSummary(summary: ApiLabelContent): MessageContent {
    return assertMessageContent(
        fromApiContent(MessageContentProsemirrorSchema, {
            elements: [{type: "Paragraph", elements: summary.elements}],
        }),
    );
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
                    option.summary === undefined
                        ? undefined
                        : fromApiMessageExperimentalApprovalSummary(option.summary),
            };
        default:
            throw exhaustive(option);
    }
}
