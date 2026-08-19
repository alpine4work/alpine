import {
    ApiBotWebhookEvent,
    ApiBotWebhookRequestBody,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {TracerSpanPropagationContext} from "~/shared/tracer/tracer_span.open_source.js";

/**
 * A webhook delivery `/claude/webhook` forwards to the sandbox container, split by
 * what the webhook was able to do on our behalf before starting the process.
 *
 * This module must stay free of Node.js imports! The `AgentV2Service` worker
 * builds these requests (see `run_claude_agent_webhook.ts`) and the container
 * parses them back out of its `process.argv` (see `claude_agent_service.ts`).
 */
export type ClaudeAgentServiceRequest =
    | ClaudeAgentServiceRoomRequest
    | ClaudeAgentServiceApprovalDecisionRequest;

/** A new message or post for the agent to respond to. */
export type ClaudeAgentServiceRoomRequest = {
    readonly type: "MessageRequest";

    readonly body: ApiBotWebhookRequestBody & {
        readonly event: Exclude<
            ApiBotWebhookEvent,
            {type: "UpdatedMessageStreamExperimentalApprovalsPart"}
        >;
    };

    /**
     * The stream message the webhook created while waiting on the sandbox to
     * initialize, so the user gets immediate feedback that we're working on their
     * request.
     */
    readonly streamMessageIndex: number;

    /**
     * Allows the container to continue tracing from the parent webhook call span.
     */
    readonly tracerContext: TracerSpanPropagationContext;
};

/**
 * A decision on an approvals card the agent posted.
 *
 * Deliberately carries no stream message. The webhook can't tell whether a
 * decision is actionable without the agent's state, so it starts the container
 * unconditionally and leaves message creation to it — a delivery the agent doesn't
 * act on leaves no empty message behind (see
 * `resumeClaudeAgentAfterApprovalDecision`).
 */
export type ClaudeAgentServiceApprovalDecisionRequest = {
    readonly type: "ApprovalDecisionRequest";

    readonly body: ApiBotWebhookRequestBody & {
        readonly event: Extract<
            ApiBotWebhookEvent,
            {type: "UpdatedMessageStreamExperimentalApprovalsPart"}
        >;
    };

    /**
     * Allows the container to continue tracing from the parent webhook call span.
     */
    readonly tracerContext: TracerSpanPropagationContext;
};
