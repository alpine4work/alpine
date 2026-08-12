import {ClaudeAgentSandbox} from "~/server/agents/bots_v2/internal/claude_agent_sandbox.js";
import {
    ApiBotWebhookEvent,
    ApiBotWebhookRequestBody,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {Replace} from "~/shared/helpers/types/replace.open_source.js";
import {TracerSpanPropagationContext} from "~/shared/tracer/tracer_span.open_source.js";

export type AgentV2ServiceEnv = {
    Queue: Queue<AgentV2ServiceQueueMessage>;
    ClaudeAgentSandbox: DurableObjectNamespace<ClaudeAgentSandbox>;
    EDGE_SERVICE_URL?: string;
    API_SERVICE_URL?: string;
    CLAUDE_API_SERVICE_KEY?: string;
    CLAUDE_WEBHOOK_SECRET?: string;
    HONEYCOMB_API_KEY?: string;
    KINESIS_TRACER_STREAM_NAME?: string;
    KINESIS_AWS_ACCESS_KEY_ID?: string;
    KINESIS_AWS_SECRET_ACCESS_KEY?: string;
};

export type AgentV2ServiceQueueMessage = {
    readonly type: "ClaudeAgentWebhook";
    readonly sendTime: number;
    readonly requestBody: Replace<
        ApiBotWebhookRequestBody,
        {event: Extract<ApiBotWebhookEvent, {type: "CreatedMessage" | "CreatedPost"}>}
    >;
    readonly tracerContext: TracerSpanPropagationContext;
};
