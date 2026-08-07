import {
    extractTextFromLanguageModelsBedrockConverseResponse,
    languageModelsBedrockConverse,
} from "~/server/language_models/internal/bedrock_converse.js";
import {
    LanguageModelsGenerateTextOptions,
    LanguageModelsGenerateTextResult,
} from "~/server/language_models/language_models_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

/**
 * Generate a plain text response from a shared Alpine model wrapper.
 */
export async function generateTextFromLanguageModel({
    inferenceConfig,
    messages,
    model,
    signal,
    system,
    tracer,
}: {
    readonly tracer: TracerSpan;
} & LanguageModelsGenerateTextOptions): Promise<LanguageModelsGenerateTextResult> {
    const result = await languageModelsBedrockConverse({
        inferenceConfig,
        messages,
        model,
        signal,
        system,
        tracer,
    });
    return {text: extractTextFromLanguageModelsBedrockConverseResponse(result.response)};
}
