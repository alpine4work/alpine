import {buildClaudeAgentApprovalDecisionOptions} from "~/server/agents/bots_v2/sandbox/build_claude_agent_approval_decision_options.js";
import {ClaudeAgentStateStore} from "~/server/agents/bots_v2/sandbox/claude_agent_state_store.js";
import {
    ClaudeAgentApprovalsRuntime,
    createClaudeAgentCanUseTool,
} from "~/server/agents/bots_v2/sandbox/create_claude_agent_can_use_tool.js";
import {ClaudeAgentWebApprovalDecision} from "~/server/agents/bots_v2/sandbox/merge_claude_agent_approval_decisions.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

const storage = createAgentWebSessionStorageForTest("space-1" as SpaceId);

function webSearchDecision(input: unknown): ClaudeAgentWebApprovalDecision {
    return {
        approval: {
            toolUseIds: ["toolu_web"],
            toolName: "WebSearch",
            scope: "Web",
            summaryContent: {elements: [{type: "Text", text: "Search the web"}]},
            decisionOptions: buildClaudeAgentApprovalDecisionOptions("Web"),
            input,
        },
        value: {
            type: "Approved",
            decider: {account: {id: "account-1" as AccountId}},
        },
    };
}

function createGate(
    approvalsRuntime: ClaudeAgentApprovalsRuntime,
    interruptTurn: () => void = () => {},
) {
    return createClaudeAgentCanUseTool({
        stateStore: {
            get: () => ({
                sessionId: null,
                room: null,
                approvals: {allowedScopes: {}, pendingBatch: null},
            }),
        } as unknown as ClaudeAgentStateStore,
        approvalsRuntime,
        storage,
        interruptTurn,
    });
}

test("will consume only the web decision with an exact input match", async () => {
    const first = webSearchDecision({query: "first"});
    const second = webSearchDecision({query: "second"});
    const approvalsRuntime: ClaudeAgentApprovalsRuntime = {
        webDecisions: [first, second],
        rejectedRequests: [],
        newRequests: [],
    };
    const gate = createGate(approvalsRuntime);

    const result = await gate(
        "WebSearch",
        {query: "second"},
        {
            signal: new AbortController().signal,
            toolUseID: "toolu_new",
            requestId: "request-1",
        },
    );

    expect(result).toEqual({behavior: "allow"});
    expect(approvalsRuntime.webDecisions).toEqual([first]);
});

test("will not consume a web decision for a changed input", async () => {
    const approved = webSearchDecision({query: "approved"});
    const approvalsRuntime: ClaudeAgentApprovalsRuntime = {
        webDecisions: [approved],
        rejectedRequests: [],
        newRequests: [],
    };
    const abortController = new AbortController();
    const gate = createGate(approvalsRuntime, () => {
        queueMicrotask(() => abortController.abort());
    });

    const result = await gate(
        "WebSearch",
        {query: "changed"},
        {signal: abortController.signal, toolUseID: "toolu_new", requestId: "request-1"},
    );

    expect(result).toEqual({
        behavior: "deny",
        message: "This action is awaiting the user\u2019s approval.",
    });
    expect(approvalsRuntime.webDecisions).toEqual([approved]);
    expect(approvalsRuntime.newRequests).toHaveLength(1);
});
