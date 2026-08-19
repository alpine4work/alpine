import {SessionStoreEntry} from "@anthropic-ai/claude-agent-sdk";
import {applyApprovalDecisionsToClaudeAgentTranscript} from "~/server/agents/bots_v2/sandbox/apply_approval_decisions_to_claude_agent_transcript.js";

// Fixtures mirroring the real transcript shapes observed in the spikes.
function toolUseEntry(
    uuid: string,
    parentUuid: string,
    id: string,
    name: string,
): SessionStoreEntry {
    return {
        parentUuid,
        type: "assistant",
        message: {role: "assistant", content: [{type: "tool_use", id, name, input: {}}]},
        uuid,
    };
}

function denyResultEntry(uuid: string, parentUuid: string, toolUseId: string): SessionStoreEntry {
    return {
        parentUuid,
        type: "user",
        message: {
            role: "user",
            content: [
                {
                    type: "tool_result",
                    tool_use_id: toolUseId,
                    is_error: true,
                    content: [{type: "text", text: "This action needs approval."}],
                },
            ],
        },
        uuid,
        toolUseResult: [{type: "text", text: "This action needs approval."}],
    };
}

function assistantTextEntry(uuid: string, parentUuid: string, text: string): SessionStoreEntry {
    return {
        parentUuid,
        type: "assistant",
        message: {role: "assistant", content: [{type: "text", text}]},
        uuid,
    };
}

test("will inject a result in place of a denied result and clear the error flag", () => {
    const entries = [
        toolUseEntry("a2", "a1", "toolu_update", "mcp__alpine__update"),
        denyResultEntry("a3", "a2", "toolu_update"),
        assistantTextEntry("a4", "a3", "I\u2019ve requested approval."),
    ];

    const result = applyApprovalDecisionsToClaudeAgentTranscript(entries, [
        {
            toolUseId: "toolu_update",
            type: "InjectResult",
            text: "Updated /doc/roadmap.",
            isError: false,
        },
    ]);

    // Trailing "I've requested approval." is truncated.
    expect(result).toHaveLength(2);

    const resultEntry = result[1]!;
    const block = (resultEntry.message as {content: Array<Record<string, unknown>>}).content[0]!;
    expect(block.tool_use_id).toEqual("toolu_update");
    expect(block.content).toEqual([{type: "text", text: "Updated /doc/roadmap."}]);
    expect("is_error" in block).toBe(false);
    expect(resultEntry.toolUseResult).toEqual([{type: "text", text: "Updated /doc/roadmap."}]);
});

test("will dangle a tool call by deleting its denied result entry", () => {
    const entries = [
        toolUseEntry("a2", "a1", "toolu_fetch", "WebFetch"),
        denyResultEntry("a3", "a2", "toolu_fetch"),
        assistantTextEntry("a4", "a3", "I\u2019ve requested approval."),
    ];

    const result = applyApprovalDecisionsToClaudeAgentTranscript(entries, [
        {toolUseId: "toolu_fetch", type: "Dangle"},
    ]);

    // The tool_use is kept (dangling), the deny result + trailing text are gone.
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toEqual("assistant");
    const block = (result[0]!.message as {content: Array<Record<string, unknown>>}).content[0]!;
    expect(block.type).toEqual("tool_use");
});

test("will inject one call and dangle another in the same transcript", () => {
    // The mixed case: an Alpine write (injected) alongside a WebFetch (dangled).
    const entries = [
        toolUseEntry("a2", "a1", "toolu_update", "mcp__alpine__update"),
        toolUseEntry("a3", "a2", "toolu_fetch", "WebFetch"),
        denyResultEntry("a4", "a3", "toolu_update"),
        denyResultEntry("a5", "a4", "toolu_fetch"),
        assistantTextEntry("a6", "a5", "I\u2019ve requested approval."),
    ];

    const result = applyApprovalDecisionsToClaudeAgentTranscript(entries, [
        {
            toolUseId: "toolu_update",
            type: "InjectResult",
            text: "Updated /doc/roadmap.",
            isError: false,
        },
        {toolUseId: "toolu_fetch", type: "Dangle"},
    ]);

    // Kept: both tool_uses + the injected update result. Dropped: fetch's deny result
    // and the trailing text. The fetch tool_use is left dangling.
    expect(result).toHaveLength(3);
    expect(result[0]!.message).toMatchObject({content: [{type: "tool_use", id: "toolu_update"}]});
    expect(result[1]!.message).toMatchObject({content: [{type: "tool_use", id: "toolu_fetch"}]});
    const injected = (result[2]!.message as {content: Array<Record<string, unknown>>}).content[0]!;
    expect(injected.tool_use_id).toEqual("toolu_update");
    expect(injected.content).toEqual([{type: "text", text: "Updated /doc/roadmap."}]);
});

test("will inject a rejection message for a rejected tool", () => {
    const entries = [
        toolUseEntry("a2", "a1", "toolu_delete", "mcp__alpine__delete"),
        denyResultEntry("a3", "a2", "toolu_delete"),
    ];

    const result = applyApprovalDecisionsToClaudeAgentTranscript(entries, [
        {
            toolUseId: "toolu_delete",
            type: "InjectResult",
            text: "The user rejected this action.",
            isError: false,
        },
    ]);

    const block = (result[1]!.message as {content: Array<Record<string, unknown>>}).content[0]!;
    expect(block.content).toEqual([{type: "text", text: "The user rejected this action."}]);
    expect("is_error" in block).toBe(false);
});

test("will preserve a successful ungated result while resolving a gated one", () => {
    // A read (ungated, already executed with a success result) plus an update (gated,
    // denied). Only the update is resolved; the read result stays intact.
    const entries: Array<SessionStoreEntry> = [
        toolUseEntry("a2", "a1", "toolu_read", "mcp__alpine__read"),
        toolUseEntry("a3", "a2", "toolu_update", "mcp__alpine__update"),
        {
            parentUuid: "a3",
            type: "user",
            message: {
                role: "user",
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: "toolu_read",
                        content: [{type: "text", text: "…doc…"}],
                    },
                ],
            },
            uuid: "a4",
        },
        denyResultEntry("a5", "a4", "toolu_update"),
    ];

    const result = applyApprovalDecisionsToClaudeAgentTranscript(entries, [
        {
            toolUseId: "toolu_update",
            type: "InjectResult",
            text: "Updated /doc/roadmap.",
            isError: false,
        },
    ]);

    // Read result untouched, update result injected.
    const readBlock = (result[2]!.message as {content: Array<Record<string, unknown>>}).content[0]!;
    expect(readBlock.tool_use_id).toEqual("toolu_read");
    expect(readBlock.content).toEqual([{type: "text", text: "…doc…"}]);
    const updateBlock = (result[3]!.message as {content: Array<Record<string, unknown>>})
        .content[0]!;
    expect(updateBlock.content).toEqual([{type: "text", text: "Updated /doc/roadmap."}]);
});

test("will preserve an executed tool error in the transcript", () => {
    const entries = [
        toolUseEntry("a2", "a1", "toolu_update", "mcp__alpine__update"),
        denyResultEntry("a3", "a2", "toolu_update"),
    ];

    const result = applyApprovalDecisionsToClaudeAgentTranscript(entries, [
        {
            toolUseId: "toolu_update",
            type: "InjectResult",
            text: "The update failed.",
            isError: true,
        },
    ]);

    const block = (result[1]!.message as {content: Array<Record<string, unknown>>}).content[0]!;
    expect(block.content).toEqual([{type: "text", text: "The update failed."}]);
    expect(block.is_error).toEqual(true);
    expect(result[1]!.toolUseResult).toEqual([{type: "text", text: "The update failed."}]);
});
