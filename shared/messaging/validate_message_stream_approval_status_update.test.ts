import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {MessageStreamExperimentalApprovalsPartPayload} from "~/shared/messaging/message_schema.js";
import {validateMessageStreamApprovalStatusUpdate} from "~/shared/messaging/validate_message_stream_approval_status_update.js";

const pending: MessageStreamExperimentalApprovalsPartPayload = {
    type: "ExperimentalApprovals",
    approvals: [
        {
            summary: createSimpleMessageContent("Create document: Draft"),
            decision: {schema: {options: [{type: "Approved"}, {type: "Rejected"}]}},
        },
    ],
};

const deciderAccountId = generateId<AccountId>();
test("allows a pending approval to become terminal", () => {
    expect(() =>
        validateMessageStreamApprovalStatusUpdate(pending, {
            ...pending,
            approvals: [
                {
                    ...pending.approvals[0]!,
                    decision: {
                        ...pending.approvals[0]!.decision,
                        value: {type: "Approved", decider: {account: {id: deciderAccountId}}},
                    },
                },
            ],
        }),
    ).not.toThrow();
});

test("does not allow a terminal approval to change", () => {
    const approved: MessageStreamExperimentalApprovalsPartPayload = {
        ...pending,
        approvals: [
            {
                ...pending.approvals[0]!,
                decision: {
                    ...pending.approvals[0]!.decision,
                    value: {type: "Approved", decider: {account: {id: deciderAccountId}}},
                },
            },
        ],
    };

    expect(() =>
        validateMessageStreamApprovalStatusUpdate(approved, {
            ...approved,
            approvals: [
                {
                    ...approved.approvals[0]!,
                    decision: {
                        ...approved.approvals[0]!.decision,
                        value: {type: "Rejected", decider: {account: {id: deciderAccountId}}},
                    },
                },
            ],
        }),
    ).toThrow("Approval request has already been decided");
});
