import {buildClaudeAgentApprovalDecisionOptions} from "~/server/agents/bots_v2/sandbox/build_claude_agent_approval_decision_options.js";

test("will describe the Write scope as covering every write", () => {
    expect(buildClaudeAgentApprovalDecisionOptions("Write")).toEqual([
        {type: "Approved"},
        {type: "Rejected"},
        {
            type: "ApprovedForSession",
            scope: {value: "Write"},
            summary: {elements: [{type: "Text", text: "all writes"}]},
            durationMinutes: 4 * 60,
        },
    ]);
});

test("will describe the Web scope as covering all web access", () => {
    expect(buildClaudeAgentApprovalDecisionOptions("Web")).toEqual([
        {type: "Approved"},
        {type: "Rejected"},
        {
            type: "ApprovedForSession",
            scope: {value: "Web"},
            summary: {elements: [{type: "Text", text: "all web access"}]},
            durationMinutes: 4 * 60,
        },
    ]);
});
