import {
    ClaudeAgentGatedToolName,
    ClaudeAgentUngatedToolName,
    claudeAgentToolNames,
    claudeAgentUngatedToolNames,
    getClaudeAgentGatedToolScope,
    isClaudeAgentGatedToolName,
    isClaudeAgentUngatedToolName,
} from "~/server/agents/bots_v2/sandbox/claude_agent_tool_names.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";

// The two name unions are derived from one map by mapped type, so pin them: a
// derivation that collapsed to `never` or widened to every tool would still
// typecheck everywhere else, and the gate would quietly stop gating.
assertEqualTypes<
    ClaudeAgentGatedToolName,
    "mcp__alpine__update" | "mcp__alpine__create" | "mcp__alpine__delete" | "WebFetch" | "WebSearch"
>();
assertEqualTypes<
    ClaudeAgentUngatedToolName,
    | "Skill"
    | "mcp__alpine__read"
    | "mcp__alpine__search"
    | "mcp__alpine__scroll"
    | "mcp__alpine__find"
>();

test("will gate the Alpine write tools behind the Write scope", () => {
    expect(getClaudeAgentGatedToolScope("mcp__alpine__update")).toEqual("Write");
    expect(getClaudeAgentGatedToolScope("mcp__alpine__create")).toEqual("Write");
    expect(getClaudeAgentGatedToolScope("mcp__alpine__delete")).toEqual("Write");
});

test("will gate the web tools behind the Web scope", () => {
    expect(getClaudeAgentGatedToolScope("WebFetch")).toEqual("Web");
    expect(getClaudeAgentGatedToolScope("WebSearch")).toEqual("Web");
});

test("will recognize the gated tool names", () => {
    expect(isClaudeAgentGatedToolName("mcp__alpine__update")).toEqual(true);
    expect(isClaudeAgentGatedToolName("mcp__alpine__create")).toEqual(true);
    expect(isClaudeAgentGatedToolName("mcp__alpine__delete")).toEqual(true);
    expect(isClaudeAgentGatedToolName("WebFetch")).toEqual(true);
    expect(isClaudeAgentGatedToolName("WebSearch")).toEqual(true);
});

test("will not gate the read-only Alpine tools", () => {
    expect(isClaudeAgentGatedToolName("mcp__alpine__read")).toEqual(false);
    expect(isClaudeAgentGatedToolName("mcp__alpine__search")).toEqual(false);
    expect(isClaudeAgentGatedToolName("mcp__alpine__scroll")).toEqual(false);
    expect(isClaudeAgentGatedToolName("mcp__alpine__find")).toEqual(false);
    expect(isClaudeAgentGatedToolName("Skill")).toEqual(false);
});

test("will recognize the ungated tool names", () => {
    expect(isClaudeAgentUngatedToolName("mcp__alpine__read")).toEqual(true);
    expect(isClaudeAgentUngatedToolName("Skill")).toEqual(true);

    expect(isClaudeAgentUngatedToolName("mcp__alpine__update")).toEqual(false);
    expect(isClaudeAgentUngatedToolName("WebFetch")).toEqual(false);
});

test("will classify every registered tool as exactly one of gated or ungated", () => {
    expect(claudeAgentToolNames.length).toBeGreaterThan(0);

    for (const toolName of claudeAgentToolNames) {
        expect(isClaudeAgentGatedToolName(toolName)).toEqual(
            !isClaudeAgentUngatedToolName(toolName),
        );
    }
});

test("will auto-allow exactly the ungated tools", () => {
    expect([...claudeAgentUngatedToolNames].sort()).toEqual(
        claudeAgentToolNames.filter(isClaudeAgentUngatedToolName).sort(),
    );

    expect(claudeAgentUngatedToolNames).not.toContain("mcp__alpine__update");
    expect(claudeAgentUngatedToolNames).not.toContain("WebFetch");
});

test("will not treat an unregistered tool as either", () => {
    expect(isClaudeAgentGatedToolName("mcp__alpine__future_tool")).toEqual(false);
    expect(isClaudeAgentUngatedToolName("mcp__alpine__future_tool")).toEqual(false);

    // Inherited object members must not read as registered tools.
    expect(isClaudeAgentGatedToolName("toString")).toEqual(false);
    expect(isClaudeAgentUngatedToolName("constructor")).toEqual(false);
});
