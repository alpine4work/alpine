import {
    LanguageModelsBedrockConverseResponse,
    extractTextFromLanguageModelsBedrockConverseResponse,
} from "~/server/language_models/internal/bedrock_converse.js";
import {sendLanguageModelsBedrockConverseRequestWithBearerToken} from "~/server/language_models/internal/bedrock_converse_development.js";
import {
    createGenerateObjectFromLanguageModelSystemPrompt,
    deserializeGeneratedObjectFromLanguageModel,
} from "~/server/language_models/internal/generate_object_from_language_model.js";
import {
    LanguageModelsContextModuleBase,
    LanguageModelsContextModuleOptions,
} from "~/server/language_models/language_models_context_module_base.js";
import {
    LanguageModelsGenerateObjectOptions,
    LanguageModelsGenerateObjectResult,
    LanguageModelsGenerateTextOptions,
    LanguageModelsGenerateTextResult,
} from "~/server/language_models/language_models_types.js";

/**
 * Development-only LLM context module that uses a Bedrock API key bearer token.
 */
export class LanguageModelsDevelopmentContextModule extends LanguageModelsContextModuleBase {
    private readonly _awsBedrockTokenForDevelopment: string;

    constructor({
        awsBedrockTokenForDevelopment,
        embeddingModel,
    }: {awsBedrockTokenForDevelopment: string} & LanguageModelsContextModuleOptions) {
        super({embeddingModel});
        this._awsBedrockTokenForDevelopment = awsBedrockTokenForDevelopment;
    }

    async generateText(
        options: LanguageModelsGenerateTextOptions,
    ): Promise<LanguageModelsGenerateTextResult> {
        return await this._context.tracer.getTracer().withSpan("Generate LLM text", async span => {
            const response = await sendLanguageModelsBedrockConverseRequestWithBearerToken({
                awsBedrockTokenForDevelopment: this._awsBedrockTokenForDevelopment,
                tracer: span,
                ...options,
            });

            return {text: extractTextFromLanguageModelsBedrockConverseResponse(response.response)};
        });
    }

    async generateObject<ObjectType>(
        options: LanguageModelsGenerateObjectOptions<ObjectType>,
    ): Promise<LanguageModelsGenerateObjectResult<ObjectType>> {
        return await this._context.tracer
            .getTracer()
            .withSpan("Generate LLM object", async span => {
                const response = await sendLanguageModelsBedrockConverseRequestWithBearerToken({
                    awsBedrockTokenForDevelopment: this._awsBedrockTokenForDevelopment,
                    inferenceConfig: options.inferenceConfig,
                    messages: options.messages,
                    model: options.model,
                    signal: options.signal,
                    system: createGenerateObjectFromLanguageModelSystemPrompt({
                        schema: options.schema,
                        system: options.system,
                    }),
                    tracer: span,
                });

                return intoLanguageModelsGenerateObjectResult(options.schema, response);
            });
    }

    fork(): LanguageModelsContextModuleBase {
        return new LanguageModelsDevelopmentContextModule({
            awsBedrockTokenForDevelopment: this._awsBedrockTokenForDevelopment,
            embeddingModel: this.embeddingModel,
        });
    }
}

function intoLanguageModelsGenerateObjectResult<ObjectType>(
    schema: LanguageModelsGenerateObjectOptions<ObjectType>["schema"],
    response: {readonly response: LanguageModelsBedrockConverseResponse},
): LanguageModelsGenerateObjectResult<ObjectType> {
    const text = extractTextFromLanguageModelsBedrockConverseResponse(response.response);
    return {
        object: deserializeGeneratedObjectFromLanguageModel(schema, text),
        text,
    };
}
