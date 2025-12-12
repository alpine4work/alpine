export type AgentServiceEnv = {
    ChatGptAgentDurableObjectNamespace: DurableObjectNamespace;
    MockAgentDurableObjectNamespace: DurableObjectNamespace;
    API_SERVICE_URL: string;
    CHAT_GPT_API_SERVICE_KEY: string;
    MOCK_CHAT_GPT_API_SERVICE_KEY?: string;
    OPEN_AI_API_KEY?: string;
    HONEYCOMB_API_KEY?: string;
};
