import {SessionStoreEntry} from "@anthropic-ai/claude-agent-sdk";
import {buildClaudeAgentApprovalDecisionOptions} from "~/server/agents/bots_v2/sandbox/build_claude_agent_approval_decision_options.js";
import {hydrateClaudeAgentApprovalDecisionsFromTranscript} from "~/server/agents/bots_v2/sandbox/hydrate_claude_agent_approval_decisions_from_transcript.js";
import {ClaudeAgentApprovalDecision} from "~/server/agents/bots_v2/sandbox/merge_claude_agent_approval_decisions.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

function toolUseEntry(id: string, input: unknown): SessionStoreEntry {
    return {
        type: "assistant",
        uuid: `uuid-${id}`,
        parentUuid: null,
        message: {
            role: "assistant",
            content: [{type: "tool_use", id, name: "mcp__alpine__update", input}],
        },
    };
}

const approvalDecision: ClaudeAgentApprovalDecision = {
    approval: {
        toolUseIds: ["toolu_1", "toolu_2"],
        toolName: "mcp__alpine__update",
        scope: "Write",
        summaryContent: {elements: [{type: "Text", text: "Update a document"}]},
        decisionOptions: buildClaudeAgentApprovalDecisionOptions("Write"),
    },
    value: {type: "Approved", decider: {account: {id: "account-1" as AccountId}}},
};

test("will hydrate identical deduplicated tool calls from the transcript", () => {
    const input = {path: "/document/roadmap", updates: [{old: "a", new: "b"}]};
    const entries = [toolUseEntry("toolu_1", input), toolUseEntry("toolu_2", input)];

    const result = hydrateClaudeAgentApprovalDecisionsFromTranscript(entries, [approvalDecision]);

    expect(result).toEqual([
        {...approvalDecision, approval: {...approvalDecision.approval, input}},
    ]);
});

test("will reject a pending approval whose tool call is missing", () => {
    expect(() => hydrateClaudeAgentApprovalDecisionsFromTranscript([], [approvalDecision])).toThrow(
        "Approval tool call toolu_1 is missing",
    );
});

test("will reject deduplicated tool calls with different inputs", () => {
    const entries = [
        toolUseEntry("toolu_1", {path: "/document/a"}),
        toolUseEntry("toolu_2", {path: "/document/b"}),
    ];

    expect(() =>
        hydrateClaudeAgentApprovalDecisionsFromTranscript(entries, [approvalDecision]),
    ).toThrow("Deduplicated approval tool calls have different inputs");
});
