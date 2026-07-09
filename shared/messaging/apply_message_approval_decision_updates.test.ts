import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    applyMessageApprovalDecisionUpdates,
    setMessageApprovalDecisionValueForTest,
} from "~/shared/messaging/apply_message_approval_decision_updates.js";
import {
    MessageExperimentalApproval,
    MessageExperimentalApprovalDecisionValue,
    MessageStreamExperimentalApprovalsPartPayload,
} from "~/shared/messaging/message_schema.js";

const decider = {
    account: {
        id: generateId<AccountId>(),
    },
} as const;

const approvalRequest: MessageStreamExperimentalApprovalsPartPayload = {
    type: "ExperimentalApprovals",
    approvals: [
        {
            summary: createSimpleMessageContent("Create document: Draft"),
            decision: {
                schema: {
                    options: [
                        {type: "Approved"},
                        {type: "Rejected"},
                        {
                            type: "ApprovedForSession",
                            scope: {value: "Create"},
                            summary: createSimpleMessageContent("Approve creates"),
                            durationMinutes: null,
                        },
                    ],
                },
            },
        },
        {
            summary: createSimpleMessageContent("Create document: Outline"),
            decision: {
                schema: {
                    options: [
                        {type: "Approved"},
                        {type: "Rejected"},
                        {
                            type: "ApprovedForSession",
                            scope: {value: "Create"},
                            summary: createSimpleMessageContent("Approve creates"),
                            durationMinutes: null,
                        },
                    ],
                },
            },
        },
        {
            summary: createSimpleMessageContent("Update document: Notes"),
            decision: {
                schema: {
                    options: [
                        {type: "Approved"},
                        {type: "Rejected"},
                        {
                            type: "ApprovedForSession",
                            scope: {value: "Update"},
                            summary: createSimpleMessageContent("Approve updates"),
                            durationMinutes: null,
                        },
                    ],
                },
            },
        },
    ],
};

test("applies a full explicit batch", () => {
    expect(
        applyMessageApprovalDecisionUpdates(approvalRequest, {
            decisions: [
                {index: 0, value: {type: "Approved", decider}},
                {index: 1, value: {type: "Rejected", decider}},
                {index: 2, value: {type: "Approved", decider}},
            ],
            shouldExpandScopeKeys: false,
        }),
    ).toStrictEqual({
        approvalPayload: {
            type: "ExperimentalApprovals",
            approvals: [
                {
                    ...approvalRequest.approvals[0]!,
                    decision: {
                        ...approvalRequest.approvals[0]!.decision,
                        value: {type: "Approved", decider},
                    },
                },
                {
                    ...approvalRequest.approvals[1]!,
                    decision: {
                        ...approvalRequest.approvals[1]!.decision,
                        value: {type: "Rejected", decider},
                    },
                },
                {
                    ...approvalRequest.approvals[2]!,
                    decision: {
                        ...approvalRequest.approvals[2]!.decision,
                        value: {type: "Approved", decider},
                    },
                },
            ],
        },
        decisionUpdates: [
            {approvalIndex: 0, decisionValue: {type: "Approved", decider}},
            {approvalIndex: 1, decisionValue: {type: "Rejected", decider}},
            {approvalIndex: 2, decisionValue: {type: "Approved", decider}},
        ],
    });
});

test("rejects conflicting explicit batch decisions", () => {
    const decidedRequest = applyMessageApprovalDecisionUpdates(approvalRequest, {
        decisions: [
            {index: 0, value: {type: "Approved", decider}},
            {index: 1, value: {type: "Rejected", decider}},
            {index: 2, value: {type: "Approved", decider}},
        ],
        shouldExpandScopeKeys: false,
    }).approvalPayload;

    expect(() =>
        applyMessageApprovalDecisionUpdates(decidedRequest, {
            decisions: [
                {index: 0, value: {type: "Rejected", decider}},
                {index: 1, value: {type: "Rejected", decider}},
                {index: 2, value: {type: "Approved", decider}},
            ],
            shouldExpandScopeKeys: false,
        }),
    ).toThrow("Approval request has already been decided");
});

test("throws if any batch decision has already been decided", () => {
    const acceptedDecisionValue: MessageExperimentalApprovalDecisionValue = {
        type: "Approved",
        decider,
    };
    const rejectedDecisionValue: MessageExperimentalApprovalDecisionValue = {
        type: "Rejected",
        decider,
    };

    const decidedRequest = applyMessageApprovalDecisionUpdates(approvalRequest, {
        decisions: [{index: 0, value: acceptedDecisionValue}],
        shouldExpandScopeKeys: false,
    }).approvalPayload;

    expect(() =>
        applyMessageApprovalDecisionUpdates(decidedRequest, {
            decisions: [acceptedDecisionValue, rejectedDecisionValue, acceptedDecisionValue].map(
                (value, index) => ({index, value}),
            ),
            shouldExpandScopeKeys: false,
        }),
    ).toThrow("Approval request has already been decided");
});

test("expands scoped approvals to matching pending approvals", () => {
    expect(
        applyMessageApprovalDecisionUpdates(approvalRequest, {
            decisions: [
                {
                    index: 0,
                    value: {
                        type: "ApprovedForSession",
                        scope: {value: "Create"},
                        durationMinutes: null,
                        decider,
                    },
                },
            ],
            shouldExpandScopeKeys: true,
        }),
    ).toStrictEqual({
        approvalPayload: {
            type: "ExperimentalApprovals",
            approvals: [
                {
                    ...approvalRequest.approvals[0]!,
                    decision: {
                        ...approvalRequest.approvals[0]!.decision,
                        value: {
                            type: "ApprovedForSession",
                            scope: {value: "Create"},
                            durationMinutes: null,
                            decider,
                        },
                    },
                },
                {
                    ...approvalRequest.approvals[1]!,
                    decision: {
                        ...approvalRequest.approvals[1]!.decision,
                        value: {
                            type: "ApprovedForSession",
                            scope: {value: "Create"},
                            durationMinutes: null,
                            decider,
                        },
                    },
                },
                approvalRequest.approvals[2]!,
            ],
        },
        decisionUpdates: [
            {
                approvalIndex: 0,
                decisionValue: {
                    type: "ApprovedForSession",
                    scope: {value: "Create"},
                    durationMinutes: null,
                    decider,
                },
            },
            {
                approvalIndex: 1,
                decisionValue: {
                    type: "ApprovedForSession",
                    scope: {value: "Create"},
                    durationMinutes: null,
                    decider,
                },
            },
        ],
    });
});

test("skips already decided approvals when expanding scoped approvals", () => {
    // Approval 0 was decided on its own in an earlier action. A session approval on
    // approval 1 expands over the matching "Create" scope but must leave the already
    // decided sibling untouched instead of failing the whole batch.
    const decidedRequest = applyMessageApprovalDecisionUpdates(approvalRequest, {
        decisions: [{index: 0, value: {type: "Approved", decider}}],
        shouldExpandScopeKeys: true,
    }).approvalPayload;

    expect(
        applyMessageApprovalDecisionUpdates(decidedRequest, {
            decisions: [
                {
                    index: 1,
                    value: {
                        type: "ApprovedForSession",
                        scope: {value: "Create"},
                        durationMinutes: null,
                        decider,
                    },
                },
            ],
            shouldExpandScopeKeys: true,
        }),
    ).toStrictEqual({
        approvalPayload: {
            type: "ExperimentalApprovals",
            approvals: [
                {
                    ...approvalRequest.approvals[0]!,
                    decision: {
                        ...approvalRequest.approvals[0]!.decision,
                        value: {type: "Approved", decider},
                    },
                },
                {
                    ...approvalRequest.approvals[1]!,
                    decision: {
                        ...approvalRequest.approvals[1]!.decision,
                        value: {
                            type: "ApprovedForSession",
                            scope: {value: "Create"},
                            durationMinutes: null,
                            decider,
                        },
                    },
                },
                approvalRequest.approvals[2]!,
            ],
        },
        decisionUpdates: [
            {
                approvalIndex: 1,
                decisionValue: {
                    type: "ApprovedForSession",
                    scope: {value: "Create"},
                    durationMinutes: null,
                    decider,
                },
            },
        ],
    });
});

test("rejects an explicit decision on a decided approval even when expanding", () => {
    const decidedRequest = applyMessageApprovalDecisionUpdates(approvalRequest, {
        decisions: [{index: 0, value: {type: "Approved", decider}}],
        shouldExpandScopeKeys: true,
    }).approvalPayload;

    expect(() =>
        applyMessageApprovalDecisionUpdates(decidedRequest, {
            decisions: [
                {
                    index: 0,
                    value: {
                        type: "ApprovedForSession",
                        scope: {value: "Create"},
                        durationMinutes: null,
                        decider,
                    },
                },
            ],
            shouldExpandScopeKeys: true,
        }),
    ).toThrow("Approval request has already been decided");
});

describe("setMessageApprovalDecisionValueIfNeeded", () => {
    const pendingApproval: MessageExperimentalApproval = {
        summary: createSimpleMessageContent("Create document: Draft"),
        decision: {
            schema: {
                options: [
                    {type: "Approved"},
                    {type: "Rejected"},
                    {
                        type: "ApprovedForSession",
                        scope: {value: "Create"},
                        summary: createSimpleMessageContent("Approve Create"),
                        durationMinutes: null,
                    },
                ],
            },
        },
    };

    const deciderAccountId = generateId<AccountId>();
    test("records a rejection", () => {
        expect(
            setMessageApprovalDecisionValueForTest(pendingApproval, {
                type: "Rejected",
                decider: {account: {id: deciderAccountId}},
            }),
        ).toMatchObject({
            decision: {
                value: {type: "Rejected"},
            },
        });
    });

    test("records scoped approval", () => {
        expect(
            setMessageApprovalDecisionValueForTest(pendingApproval, {
                type: "ApprovedForSession",
                decider: {account: {id: deciderAccountId}},
                scope: {value: "Create"},
                durationMinutes: null,
            }),
        ).toMatchObject({
            decision: {
                value: {
                    type: "ApprovedForSession",
                    scope: {value: "Create"},
                    durationMinutes: null,
                },
            },
        });
    });

    test("rejects a conflicting decision after the first terminal decision", () => {
        const deniedApproval = assertExists(
            setMessageApprovalDecisionValueForTest(pendingApproval, {
                type: "Rejected",
                decider: {account: {id: deciderAccountId}},
            }),
        );

        expect(() =>
            setMessageApprovalDecisionValueForTest(deniedApproval, {
                type: "Approved",
                decider: {account: {id: deciderAccountId}},
            }),
        ).toThrow("Approval request has already been decided");
    });

    test("rejects an identical terminal decision", () => {
        const decisionValue: MessageExperimentalApprovalDecisionValue = {
            type: "Rejected",
            decider: {account: {id: deciderAccountId}},
        };
        const deniedApproval = assertExists(
            setMessageApprovalDecisionValueForTest(pendingApproval, decisionValue),
        );

        expect(() =>
            setMessageApprovalDecisionValueForTest(deniedApproval, {
                type: "Rejected",
                decider: {account: {id: deciderAccountId}},
            }),
        ).toThrow("Approval request has already been decided");
    });
});
