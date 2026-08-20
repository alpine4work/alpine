import {z} from "zod";
import {AgentWebMessageStreamSession} from "~/server/agents/bots_v2/sandbox/agent_web_message_stream_session.js";
import {
    ClaudeAgentApprovalResolution,
    applyApprovalDecisionsToClaudeAgentTranscript,
} from "~/server/agents/bots_v2/sandbox/apply_approval_decisions_to_claude_agent_transcript.js";
import {ClaudeAgentSessionStore} from "~/server/agents/bots_v2/sandbox/claude_agent_session_store.js";
import {
    ClaudeAgentGatedToolName,
    isClaudeAgentWebToolName,
} from "~/server/agents/bots_v2/sandbox/claude_agent_tool_names.js";
import {claudeAgentWriteToolInputShapes} from "~/server/agents/bots_v2/sandbox/claude_agent_write_tool_input_shapes.js";
import {hydrateClaudeAgentApprovalDecisionsFromTranscript} from "~/server/agents/bots_v2/sandbox/hydrate_claude_agent_approval_decisions_from_transcript.js";
import {
    ClaudeAgentApprovalDecision,
    ClaudeAgentApprovalDecisionWithInput,
    ClaudeAgentWebApprovalDecision,
} from "~/server/agents/bots_v2/sandbox/merge_claude_agent_approval_decisions.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.open_source.js";
import {callAgentWebDeleteTool} from "~/server/agents/web/call_agent_web_delete_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.open_source.js";
import {intoApiMessageStreamToolCallPart} from "~/server/agents/web/into_api_message_stream_tool_call_part.js";
import {ApiMessageStreamToolCallPartPayloadCallRequest} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

// The injected result for a rejected action. The explicit "Do not retry it" keeps
// the model from re-issuing the same call on resume (which would park it again and
// show the user a fresh card for something they just declined). Matches the deny
// message the gate uses for a rejected web decision.
const claudeAgentRejectedActionResultText = "The user rejected this action. Do not retry it.";

export type ResolveClaudeAgentApprovalDecisionsResult = {
    /**
     * The approved web tool (`WebFetch`/`WebSearch`) decisions. Their tool calls were
     * left dangling in the transcript; the caller seeds these into the approvals
     * runtime so the resume gate (`canUseTool`) allows them when the model re-issues
     * them (see `create_claude_agent_can_use_tool.ts`).
     */
    readonly approvedWebDecisions: ReadonlyArray<ClaudeAgentWebApprovalDecision>;

    /**
     * The `(toolName, input)` pairs the user rejected. Seeded into the approvals
     * runtime so the resume gate denies an exact re-issue instead of parking it into a
     * fresh card (see `create_claude_agent_can_use_tool.ts`).
     */
    readonly rejectedRequests: ReadonlyArray<{
        readonly toolName: ClaudeAgentGatedToolName;
        readonly input: unknown;
    }>;
};

type ClaudeAgentApprovalExecutionOutcome = {
    readonly isError: boolean;
    readonly response: string;
    readonly toolCall: ApiMessageStreamToolCallPartPayloadCallRequest | null;
};

/**
 * Resolves a fully decided approval batch by editing the agent's session
 * transcript, then rewrites the store so a resumed `query()` sees the resolved
 * state.
 *
 * For each decided call:
 *
 * - **Approved Alpine tool** — execute it ourselves with the exact stored input
 *   (accepting an aged read for `update`/`delete`) and inject the real result.
 * - **Rejected tool** (Alpine or web) — inject a rejection message.
 * - **Approved web tool** — leave its `tool_use` dangling; the CLI re-drives the
 *   real fetch/search on resume once the gate allows it.
 */
export async function runApprovedToolCallsAndUpdateClaudeSessionTranscript(
    span: TracerSpan,
    {
        decisions,
        context,
        sessionStore,
        sessionId,
        projectKey,
        messageRef,
    }: {
        decisions: ReadonlyArray<ClaudeAgentApprovalDecision>;
        context: AgentWebContext;
        sessionStore: ClaudeAgentSessionStore;
        sessionId: string;
        projectKey: string;
        messageRef: {current: AgentWebMessageStreamSession | null};
    },
): Promise<ResolveClaudeAgentApprovalDecisionsResult> {
    // Locate and load the transcript FIRST. It needs no decisions, and if it's missing
    // we want to find out before touching the user's data — otherwise the writes land,
    // the assertion throws, the run errors, and `runClaudeAgent()` wipes the bucket,
    // so the user sees a failure for edits that actually happened.
    const key = {projectKey, sessionId};

    const entries = assertExists(await sessionStore.load(key), "Session transcript is empty");
    const decisionsWithInput = hydrateClaudeAgentApprovalDecisionsFromTranscript(
        entries,
        decisions,
    );

    const resolutions: Array<ClaudeAgentApprovalResolution> = [];
    const approvedWebDecisions: Array<ClaudeAgentWebApprovalDecision> = [];
    const rejectedRequests: Array<{toolName: ClaudeAgentGatedToolName; input: unknown}> = [];
    const approvedAlpineDecisions: Array<ClaudeAgentApprovalDecisionWithInput> = [];

    for (const decision of decisionsWithInput) {
        const {approval, value} = decision;
        const isApproved = value.type !== "Rejected";

        if (isApproved && isClaudeAgentWebToolName(approval.toolName)) {
            // Leave the tool call dangling — the CLI re-drives the real web tool on resume.
            // Rebuilt rather than spread wholesale so the narrowed `toolName` survives into
            // the result type, which is what lets the gate skip re-deriving it.
            approvedWebDecisions.push({
                ...decision,
                approval: {...approval, toolName: approval.toolName},
            });
            for (const toolUseId of approval.toolUseIds) {
                resolutions.push({toolUseId, type: "Dangle"});
            }
            continue;
        }

        if (!isApproved) {
            for (const toolUseId of approval.toolUseIds) {
                resolutions.push({
                    toolUseId,
                    type: "InjectResult",
                    text: claudeAgentRejectedActionResultText,
                    isError: false,
                });
            }

            // Remember it so the resume gate denies an exact re-issue rather than re-parking
            // it (see `create_claude_agent_can_use_tool.ts`).
            rejectedRequests.push({toolName: approval.toolName, input: approval.input});
            continue;
        }

        approvedAlpineDecisions.push(decision);
    }

    const approvedAlpineExecutions = await runAllPromises(
        approvedAlpineDecisions.map(async decision => ({
            decision,
            outcome: await executeApprovedClaudeAgentAlpineTool(span, {
                context,
                toolName: decision.approval.toolName,
                input: decision.approval.input,
            }),
        })),
    );

    for (const {decision, outcome} of approvedAlpineExecutions) {
        const {approval} = decision;

        if (outcome.toolCall !== null) {
            messageRef.current?.pushToolCall(context.span, outcome.toolCall);
        }

        for (const toolUseId of approval.toolUseIds) {
            resolutions.push({
                toolUseId,
                type: "InjectResult",
                text: outcome.response,
                isError: outcome.isError,
            });
        }
    }

    // The results here go into the session TRANSCRIPT (Claude's memory), not the
    // Alpine message stream (the UI) — the tool-call stream parts for `update` and
    // `create` were already pushed above. The user sees the outcome itself from the
    // agent's continuation text after it resumes ("I've updated the doc…").
    const rewritten = applyApprovalDecisionsToClaudeAgentTranscript(entries, resolutions);

    await sessionStore.replaceWithSnapshot(key, [...rewritten]);

    return {approvedWebDecisions, rejectedRequests};
}

// Parsed from the very shapes the tools themselves declare, so an input the user
// approved can't fail to parse here because a tool's schema moved.
const updateToolInputSchema = z.object(claudeAgentWriteToolInputShapes.update);
const createToolInputSchema = z.object(claudeAgentWriteToolInputShapes.create);
const deleteToolInputSchema = z.object(claudeAgentWriteToolInputShapes.delete);

/**
 * Executes an approved Alpine write tool with its stored input. The input was
 * denied before the tool's own schema validated it, so we validate it here before
 * running.
 */
async function executeApprovedClaudeAgentAlpineTool(
    span: TracerSpan,
    {
        context,
        toolName,
        input,
    }: {
        context: AgentWebContext;
        toolName: string;
        input: unknown;
    },
): Promise<ClaudeAgentApprovalExecutionOutcome> {
    switch (toolName) {
        case "mcp__alpine__update": {
            const args = updateToolInputSchema.safeParse(input);
            if (!args.success) return invalidStoredInputResult(span, toolName);

            // The user may decide hours after the agent proposed this edit, long after the
            // read response expired. `withoutStaleReadCheck` accepts the aged read rather than
            // refusing the write the user just approved — the read-time page version is still
            // carried through, so the collaboration service merges against the snapshot the
            // agent actually saw instead of clobbering newer edits.
            const result = await callAgentWebUpdateTool(context, {
                ...args.data,
                withoutStaleReadCheck: true,
            });

            return {
                isError: result.isError,
                response: result.response,
                toolCall: result.isError
                    ? null
                    : intoApiMessageStreamToolCallPart({
                          type: "Update",
                          pageLink: result.pageLink,
                      }),
            };
        }
        case "mcp__alpine__create": {
            const args = createToolInputSchema.safeParse(input);
            if (!args.success) return invalidStoredInputResult(span, toolName);

            const result = await callAgentWebCreateTool(context, args.data);

            return {
                isError: result.isError,
                response: result.response,
                toolCall: result.isError
                    ? null
                    : intoApiMessageStreamToolCallPart({
                          type: "Create",
                          pageLink: result.pageLink,
                      }),
            };
        }
        case "mcp__alpine__delete": {
            const args = deleteToolInputSchema.safeParse(input);
            if (!args.success) return invalidStoredInputResult(span, toolName);

            const result = await callAgentWebDeleteTool(context, args.data);

            return {...result, toolCall: null};
        }
        default:
            return invalidStoredInputResult(span, toolName);
    }
}

function invalidStoredInputResult(
    span: TracerSpan,
    toolName: string,
): ClaudeAgentApprovalExecutionOutcome {
    span.addException(
        new InternalError(`Approved approval had an invalid stored input for ${toolName}`),
    );
    return {
        isError: true,
        response: "This action couldn\u2019t be performed because its stored input was invalid.",
        toolCall: null,
    };
}
