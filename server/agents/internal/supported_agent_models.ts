export interface SupportedAgentModels {
    openai: "gpt-5-mini" | "gpt-5.1" | "gpt-5.4-mini" | "gpt-5.4";
}

export type SupportedAgentProviders = keyof SupportedAgentModels;

type ProviderTokenUsage = {
    openai: {
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
    };
};

// If this type is erroring, it likely means you need to add a mapping for a new
// provider/model in agentDollarsPerMillionTokens
type AgentTokenUsageToMillicents = {
    [K in SupportedAgentProviders]: Record<SupportedAgentModels[K], ProviderTokenUsage[K]>;
};

// Local configuration for the cost of each agent model. Values are in millicents
// per token. You can derive this number from the pricing docs of each provider by
// dividing dollars per million tokens by 10.
//
// To convert dollarsPerMillionTokens to millicentsPerToken: dollarsPerToken =
// (dollarsPerMillionTokens / 1,000,000) centsPerToken = dollarsPerToken _ 100
// millicentsPerToken = centsPerToken _ 1000 Therefore, millicentsPerToken is just
// dollarsPerMillionTokens / 10
export const agentMillicentsPerToken: AgentTokenUsageToMillicents = {
    // https://platform.openai.com/docs/pricing
    openai: {
        "gpt-5.4-mini": {
            inputTokens: 0.075, // $0.75 per million
            cachedInputTokens: 0.0075, // $0.075 per million
            outputTokens: 0.45, // $4.50 per million
        },
        "gpt-5.4": {
            inputTokens: 0.25, // $2.50 per million
            cachedInputTokens: 0.025, // $0.25 per million
            outputTokens: 1.5, // $15.00 per million
        },
        "gpt-5-mini": {
            inputTokens: 0.025, // $0.25 per million
            cachedInputTokens: 0.0025, // $0.025 per million
            outputTokens: 0.2, // $2.00 per million
        },
        "gpt-5.1": {
            inputTokens: 0.125, // $1.25 per million
            cachedInputTokens: 0.0125, // $0.125 per million
            outputTokens: 1, // $10.00 per million
        },
    },
};
