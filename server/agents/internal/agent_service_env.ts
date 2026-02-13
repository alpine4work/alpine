export type AgentServiceEnv = {
    ChatGptAgentDurableObjectNamespace: DurableObjectNamespace;
    CursorAgentDurableObjectNamespace: DurableObjectNamespace;
    MockAgentDurableObjectNamespace: DurableObjectNamespace;
    AgentUsageDatabase: D1Database;
    API_SERVICE_URL: string;
    EDGE_SERVICE_URL: string;
    CHAT_GPT_API_SERVICE_KEY: string;
    CURSOR_API_SERVICE_KEY: string;
    MOCK_CHAT_GPT_API_SERVICE_KEY?: string;
    OPEN_AI_API_KEY?: string;
    HONEYCOMB_API_KEY?: string;
    CURSOR_AGENT_SMEE_WEBHOOK_URL?: string;
    KINESIS_TRACER_STREAM_NAME?: string;
    KINESIS_AWS_ACCESS_KEY_ID?: string;
    KINESIS_AWS_SECRET_ACCESS_KEY?: string;
};
