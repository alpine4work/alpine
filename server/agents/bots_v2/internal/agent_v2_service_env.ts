import {ClaudeAgentSandbox} from "~/server/agents/bots_v2/internal/claude_agent_sandbox.js";

export type AgentV2ServiceEnv = {
    ClaudeAgentSandbox: DurableObjectNamespace<ClaudeAgentSandbox>;

    /**
     * The R2 bucket every sandbox mounts at `/workspace/bucket` (under a per-sandbox
     * prefix, see `claude_agent_sandbox.ts`). This is where the sandbox keeps all of
     * its durable state — including the approvals state in `state.json`, written by
     * `ClaudeAgentStateStore`. The binding was already declared in `wrangler.toml` for
     * the mount; it's typed here so the worker can read a sandbox's `state.json`
     * directly without cold-starting a container (see
     * `read_claude_agent_conversation_state_from_bucket.ts`).
     */
    ClaudeAgentBucket: R2Bucket;

    EDGE_SERVICE_URL?: string;
    API_SERVICE_URL?: string;
    CLAUDE_API_SERVICE_KEY?: string;
    CLAUDE_WEBHOOK_SECRET?: string;
    HONEYCOMB_API_KEY?: string;
    KINESIS_TRACER_STREAM_NAME?: string;
    KINESIS_AWS_ACCESS_KEY_ID?: string;
    KINESIS_AWS_SECRET_ACCESS_KEY?: string;
};
