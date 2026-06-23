import {SupportedBedrockModel} from "~/server/language_models/supported_bedrock_model.js";
import {
    SupportedBedrockAwsRegion,
    supportedBedrockAwsRegions,
} from "~/server/language_models/supported_bedrock_region.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

export const bedrockSupportedAwsRegions = supportedBedrockAwsRegions;
export type BedrockSupportedAwsRegion = SupportedBedrockAwsRegion;

/**
 * Normalized Bedrock token usage values.
 *
 * Bedrock usage fields are optional in responses, but downstream tracing and
 * pricing logic is easier to reason about when these counts are always present.
 */
export type BedrockTokenUsage = {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
};

type BedrockDollarsPerMillionTokens = {
    readonly inputTokens: number;
    readonly outputTokens: number;
};

const bedrockDollarsPerMillionTokensByModelAndRegion: Record<
    SupportedBedrockModel,
    Record<BedrockSupportedAwsRegion, BedrockDollarsPerMillionTokens>
> = {
    // Amazon Bedrock pricing for Google Gemma 3 4B:
    // https://aws.amazon.com/bedrock/pricing/
    "google.gemma-3-4b-it": {
        "ap-northeast-1": {inputTokens: 0.05, outputTokens: 0.1},
        "ap-south-1": {inputTokens: 0.05, outputTokens: 0.09},
        "ap-southeast-2": {inputTokens: 0.0412, outputTokens: 0.0824},
        "eu-south-1": {inputTokens: 0.05, outputTokens: 0.09},
        "eu-west-1": {inputTokens: 0.05, outputTokens: 0.09},
        "eu-west-2": {inputTokens: 0.06, outputTokens: 0.12},
        "sa-east-1": {inputTokens: 0.05, outputTokens: 0.1},
        "us-east-1": {inputTokens: 0.04, outputTokens: 0.08},
        "us-east-2": {inputTokens: 0.04, outputTokens: 0.08},
        "us-west-2": {inputTokens: 0.04, outputTokens: 0.08},
    },
    // Amazon Bedrock pricing for Google Gemma 3 12B:
    // https://aws.amazon.com/bedrock/pricing/
    "google.gemma-3-12b-it": {
        "ap-northeast-1": {inputTokens: 0.11, outputTokens: 0.35},
        "ap-south-1": {inputTokens: 0.11, outputTokens: 0.34},
        "ap-southeast-2": {inputTokens: 0.0927, outputTokens: 0.2987},
        "eu-south-1": {inputTokens: 0.11, outputTokens: 0.34},
        "eu-west-1": {inputTokens: 0.11, outputTokens: 0.34},
        "eu-west-2": {inputTokens: 0.14, outputTokens: 0.45},
        "sa-east-1": {inputTokens: 0.11, outputTokens: 0.35},
        "us-east-1": {inputTokens: 0.09, outputTokens: 0.29},
        "us-east-2": {inputTokens: 0.09, outputTokens: 0.29},
        "us-west-2": {inputTokens: 0.09, outputTokens: 0.29},
    },
};

/**
 * Normalizes the optional Bedrock usage payload into a fully-populated local
 * shape.
 *
 * If Bedrock omits `totalTokens`, we derive it from the input and output counts so
 * all callers can rely on it being present.
 */
export function getBedrockTokenUsage(response: {
    readonly usage?:
        | {
              readonly inputTokens?: number;
              readonly outputTokens?: number;
              readonly totalTokens?: number;
          }
        | undefined;
}): BedrockTokenUsage {
    const inputTokens = response.usage?.inputTokens ?? 0;
    const outputTokens = response.usage?.outputTokens ?? 0;
    const totalTokens = response.usage?.totalTokens ?? inputTokens + outputTokens;

    return {
        inputTokens,
        outputTokens,
        totalTokens,
    };
}

/**
 * Builds the Bedrock portion of our tracer payload for a single generation.
 *
 * When a region is available we also attach token pricing and an estimated total
 * cost so Bedrock requests can be analyzed similarly to our OpenAI traces.
 */
export function getBedrockTracerData({
    model,
    region,
    usage,
}: {
    readonly model: SupportedBedrockModel;
    readonly region?: BedrockSupportedAwsRegion;
    readonly usage: BedrockTokenUsage;
}): TracerEventData["bedrock"] {
    const pricingInMillicentsPerToken = getBedrockPricingInMillicentsPerToken({
        model,
        region,
    });

    return {
        model,
        region,
        usage:
            pricingInMillicentsPerToken === null
                ? usage
                : {
                      ...usage,
                      estimatedCostMillicents:
                          usage.inputTokens * pricingInMillicentsPerToken.inputTokens +
                          usage.outputTokens * pricingInMillicentsPerToken.outputTokens,
                      inputTokensMillicents: pricingInMillicentsPerToken.inputTokens,
                      outputTokensMillicents: pricingInMillicentsPerToken.outputTokens,
                  },
    };
}

/**
 * Looks up pricing for a specific Bedrock model/region pair and converts it to our
 * millicents-per-token representation.
 */
function getBedrockPricingInMillicentsPerToken({
    model,
    region,
}: {
    readonly model: SupportedBedrockModel;
    readonly region?: BedrockSupportedAwsRegion;
}): {readonly inputTokens: number; readonly outputTokens: number} | null {
    if (region === undefined) return null;

    const dollarsPerMillionTokens = bedrockDollarsPerMillionTokensByModelAndRegion[model][region];
    if (dollarsPerMillionTokens === undefined) return null;

    return {
        // To convert dollars per million tokens to millicents per token, divide by 10.
        inputTokens: dollarsPerMillionTokens.inputTokens / 10,
        outputTokens: dollarsPerMillionTokens.outputTokens / 10,
    };
}
