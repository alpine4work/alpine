import {SessionStoreEntry} from "@anthropic-ai/claude-agent-sdk";
import {
    ClaudeAgentApprovalDecision,
    ClaudeAgentApprovalDecisionWithInput,
} from "~/server/agents/bots_v2/sandbox/merge_claude_agent_approval_decisions.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isDeepEqualForUnknownValues} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";

/**
 * We store pending approval decisions with only the `toolUseIds` and `toolName` in
 * order to keep state light. When we are ready to act on the approval decisions,
 * we get the original tool input from the transcript using the tool name and tool
 * use id.
 *
 * This function merges the input from the transcript into the decision.
 */
export function hydrateClaudeAgentApprovalDecisionsFromTranscript(
    entries: ReadonlyArray<SessionStoreEntry>,
    decisions: ReadonlyArray<ClaudeAgentApprovalDecision>,
): ReadonlyArray<ClaudeAgentApprovalDecisionWithInput> {
    const toolUseById = new Map<string, {readonly name: string; readonly input: unknown}>();

    for (const entry of entries) {
        const message = isObject(entry.message) ? entry.message : null;
        if (message === null || !Array.isArray(message.content)) continue;

        for (const block of message.content) {
            if (
                !isObject(block) ||
                block.type !== "tool_use" ||
                typeof block.id !== "string" ||
                typeof block.name !== "string"
            ) {
                continue;
            }

            toolUseById.set(block.id, {name: block.name, input: block.input});
        }
    }

    return decisions.map(decision => {
        const {approval} = decision;
        assert(approval.toolUseIds.length > 0, "Approval must reference a tool call");

        let input: unknown;
        let hasInput = false;

        for (const toolUseId of approval.toolUseIds) {
            const toolUse = toolUseById.get(toolUseId);
            assert(toolUse !== undefined, `Approval tool call ${toolUseId} is missing`);
            assert(
                toolUse.name === approval.toolName,
                `Approval tool call ${toolUseId} has a different tool name`,
            );

            if (!hasInput) {
                input = toolUse.input;
                hasInput = true;
            } else {
                assert(
                    isDeepEqualForUnknownValues(input, toolUse.input),
                    "Deduplicated approval tool calls have different inputs",
                );
            }
        }

        assert(hasInput);
        return {...decision, approval: {...approval, input}};
    });
}
