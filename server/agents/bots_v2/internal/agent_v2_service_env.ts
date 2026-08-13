import {ClaudeAgentSandbox} from "~/server/agents/bots_v2/internal/claude_agent_sandbox.js";

export type AgentV2ServiceEnv = {
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
