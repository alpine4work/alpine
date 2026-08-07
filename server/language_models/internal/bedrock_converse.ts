import {
    BedrockRuntimeClient,
    ContentBlock,
    ConverseCommand,
    ConverseCommandOutput,
    SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import {
    BedrockSupportedAwsRegion,
    BedrockTokenUsage,
    bedrockSupportedAwsRegions,
    getBedrockTokenUsage,
    getBedrockTracerData,
} from "~/server/language_models/internal/bedrock_tracer_data.js";
import {LanguageModelsGenerateTextOptions} from "~/server/language_models/language_models_types.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {TracerBase} from "~/shared/tracer/tracer_base.open_source.js";

/**
 * The subset of a Bedrock `converse` response we rely on for shared LLM text
 * generation.
 */
export type LanguageModelsBedrockConverseResponse = {
    readonly output?: {
        readonly message?: {
            readonly content?: Array<ContentBlock>;
        };
    };
    readonly usage?: {
        readonly inputTokens?: number;
        readonly outputTokens?: number;
        readonly totalTokens?: number;
    };
};

/**
 * Shared normalized Bedrock result used by our text/object generation helpers.
 *
 * We keep the raw response for content extraction and a normalized usage object
 * for tracer annotation and cost estimation.
 */
export type LanguageModelsBedrockConverseResult = {
    readonly response: LanguageModelsBedrockConverseResponse;
    readonly usage: BedrockTokenUsage;
};

let languageModelsBedrockClient: BedrockRuntimeClient | null = null;

/**
 * Sends a Bedrock `converse` request through the AWS SDK and annotates the span
 * with normalized token usage metadata.
 */
export async function languageModelsBedrockConverse({
    inferenceConfig,
    messages,
    model,
    signal,
    system,
    tracer,
}: {
    readonly tracer: TracerBase;
} & LanguageModelsGenerateTextOptions): Promise<LanguageModelsBedrockConverseResult> {
    return await tracer.withSpan("Amazon Bedrock converse", async span => {
        const region = getLanguageModelsBedrockSupportedAwsRegionIfExists();
        const client = getLanguageModelsBedrockClient();
        const command = new ConverseCommand({
            inferenceConfig,
            messages,
            modelId: model,
            system: createLanguageModelsBedrockSystemBlocks(system),
        });

        try {
            const response = await client.send(command, {abortSignal: signal});
            const usage = getBedrockTokenUsage(response);

            span.addData({
                bedrock: getBedrockTracerData({
                    model,
                    region,
                    usage,
                }),
            });

            return {
                response,
                usage,
            };
        } catch (error) {
            span.logException("Amazon Bedrock converse exception", error);
            throw error;
        }
    });
}

function getLanguageModelsBedrockSupportedAwsRegionIfExists():
    | BedrockSupportedAwsRegion
    | undefined {
    const awsRegion = process.env.AWS_REGION;
    if (awsRegion === undefined) return undefined;

    assert(
        bedrockSupportedAwsRegions.includes(awsRegion as BedrockSupportedAwsRegion),
        "Invalid AWS region",
    );

    return awsRegion as BedrockSupportedAwsRegion;
}

/**
 * Extracts the plain text body from a Bedrock `converse` response.
 *
 * Bedrock may return multiple content blocks, so we concatenate text blocks in
 * order and ignore non-text content.
 */
export function extractTextFromLanguageModelsBedrockConverseResponse(
    response: LanguageModelsBedrockConverseResponse | ConverseCommandOutput,
): string {
    const text = response.output?.message?.content
        ?.map(contentBlock => {
            if ("text" in contentBlock && typeof contentBlock.text === "string") {
                return contentBlock.text;
            }

            return null;
        })
        .filter((part): part is string => part !== null)
        .join("\n")
        .trim();

    if (!text) {
        throw new InternalError("Expected LLM response to contain text");
    }

    return text;
}

/**
 * Lazily constructs and memoizes the Bedrock runtime client for this process.
 */
function getLanguageModelsBedrockClient(): BedrockRuntimeClient {
    if (languageModelsBedrockClient === null) {
        languageModelsBedrockClient = new BedrockRuntimeClient();
    }

    return languageModelsBedrockClient;
}

/**
 * Converts our plain system prompt string into the SDK shape expected by Bedrock
 * `converse`.
 */
function createLanguageModelsBedrockSystemBlocks(
    system: string | undefined,
): Array<SystemContentBlock> | undefined {
    if (system === undefined) return undefined;
    return [{text: system}];
}

export {
    createLanguageModelsBedrockSystemBlocks,
    getLanguageModelsBedrockSupportedAwsRegionIfExists,
};
