import {isClaudeAgentApprovalScope} from "~/server/agents/bots_v2/sandbox/claude_agent_approval_scope.js";

test("will recognize the scopes a user can grant", () => {
    expect(isClaudeAgentApprovalScope("Write")).toEqual(true);
    expect(isClaudeAgentApprovalScope("Web")).toEqual(true);
});

test("will reject a scope value the API made up", () => {
    expect(isClaudeAgentApprovalScope("")).toEqual(false);
    expect(isClaudeAgentApprovalScope("write")).toEqual(false);
    expect(isClaudeAgentApprovalScope("Everything")).toEqual(false);
});

test("will reject inherited object members", () => {
    // Decisions carry whatever `scope.value` the API sent, so a prototype-chain check
    // (`scope in map`) would narrow "toString" to a real scope and let it be written
    // into `allowedScopes`.
    expect(isClaudeAgentApprovalScope("toString")).toEqual(false);
    expect(isClaudeAgentApprovalScope("constructor")).toEqual(false);
    expect(isClaudeAgentApprovalScope("__proto__")).toEqual(false);
});
