import {buildClaudeAgentApprovalDecisionOptions} from "~/server/agents/bots_v2/sandbox/build_claude_agent_approval_decision_options.js";
import {
    ClaudeAgentPendingApproval,
    ClaudeAgentPendingApprovalBatch,
} from "~/server/agents/bots_v2/sandbox/claude_agent_approvals_state.js";
import {
    ClaudeAgentApprovalDecisionValue,
    mergeClaudeAgentApprovalDecisions,
} from "~/server/agents/bots_v2/sandbox/merge_claude_agent_approval_decisions.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

const decider = {account: {id: "account-1" as AccountId}};

/**
 * The grant duration offered by every card, see
 * `buildClaudeAgentApprovalDecisionOptions()`.
 */
const cardDurationMinutes = 4 * 60;

const approvedValue: ClaudeAgentApprovalDecisionValue = {type: "Approved", decider};
const rejectedValue: ClaudeAgentApprovalDecisionValue = {type: "Rejected", decider};

const approvedForSessionWriteValue: ClaudeAgentApprovalDecisionValue = {
    type: "ApprovedForSession",
    decider,
    scope: {value: "Write"},
    durationMinutes: cardDurationMinutes,
};

const approvedForSessionWebValue: ClaudeAgentApprovalDecisionValue = {
    type: "ApprovedForSession",
    decider,
    scope: {value: "Web"},
    durationMinutes: cardDurationMinutes,
};

const writeApproval: ClaudeAgentPendingApproval = {
    toolUseIds: ["toolu_1"],
    toolName: "mcp__alpine__update",
    scope: "Write",
    summaryContent: {elements: [{type: "Text", text: "Update /doc/a"}]},
    decisionOptions: buildClaudeAgentApprovalDecisionOptions("Write"),
};

const webApproval: ClaudeAgentPendingApproval = {
    toolUseIds: ["toolu_2"],
    toolName: "WebFetch",
    scope: "Web",
    summaryContent: {elements: [{type: "Text", text: "Fetch https://example.com"}]},
    decisionOptions: buildClaudeAgentApprovalDecisionOptions("Web"),
};

const batch: ClaudeAgentPendingApprovalBatch = {
    messageIndex: 4,
    approvals: [writeApproval, webApproval],
};

test("will return every decision when all approvals are decided", () => {
    const result = mergeClaudeAgentApprovalDecisions(batch, [
        {decision: {value: approvedValue}},
        {decision: {value: rejectedValue}},
    ]);

    expect(result).toEqual({
        type: "FullyDecided",
        decisions: [
            {approval: writeApproval, value: approvedValue},
            {approval: webApproval, value: rejectedValue},
        ],
    });
});

test("will return an approved for session decision matching the option on its card", () => {
    const result = mergeClaudeAgentApprovalDecisions(batch, [
        {decision: {value: approvedForSessionWriteValue}},
        {decision: {value: approvedForSessionWebValue}},
    ]);

    expect(result).toEqual({
        type: "FullyDecided",
        decisions: [
            {approval: writeApproval, value: approvedForSessionWriteValue},
            {approval: webApproval, value: approvedForSessionWebValue},
        ],
    });
});

test("will report still pending when any approval lacks a decision", () => {
    const result = mergeClaudeAgentApprovalDecisions(batch, [
        {decision: {value: approvedValue}},
        {decision: {}},
    ]);

    expect(result).toEqual({type: "StillPending"});
});

test("will report a mismatch when the event has a different approval count", () => {
    const result = mergeClaudeAgentApprovalDecisions(batch, [{decision: {value: approvedValue}}]);

    expect(result).toEqual({type: "Mismatch"});
});

test("will report a mismatch when a decision was not offered on the persisted card", () => {
    // The `Write` card only ever offers a `Write` session grant.
    const result = mergeClaudeAgentApprovalDecisions(batch, [
        {decision: {value: approvedForSessionWebValue}},
        {decision: {value: rejectedValue}},
    ]);

    expect(result).toEqual({type: "Mismatch"});
});

test("will report a mismatch when a session grant asks for a duration the card did not offer", () => {
    const result = mergeClaudeAgentApprovalDecisions(batch, [
        {decision: {value: {...approvedForSessionWriteValue, durationMinutes: 60}}},
        {decision: {value: rejectedValue}},
    ]);

    expect(result).toEqual({type: "Mismatch"});
});

test("will report a mismatch when a persisted card has no decision options", () => {
    // `state.json` is parsed without validation, so a card written by an older version
    // of the container can carry anything here.
    const corruptedBatch = {
        messageIndex: 4,
        approvals: [{...writeApproval, decisionOptions: undefined}],
    } as unknown as ClaudeAgentPendingApprovalBatch;

    const result = mergeClaudeAgentApprovalDecisions(corruptedBatch, [
        {decision: {value: approvedValue}},
    ]);

    expect(result).toEqual({type: "Mismatch"});
});
