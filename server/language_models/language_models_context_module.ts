import {generateObjectFromLanguageModel} from "~/server/language_models/internal/generate_object_from_language_model.js";
import {generateTextFromLanguageModel} from "~/server/language_models/internal/generate_text_from_language_model.js";
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
 * Shared Bedrock-backed LLM context module.
 */
export class LanguageModelsContextModule extends LanguageModelsContextModuleBase {
    constructor(options: LanguageModelsContextModuleOptions = {}) {
        super(options);
    }

    async generateText(
        options: LanguageModelsGenerateTextOptions,
    ): Promise<LanguageModelsGenerateTextResult> {
        return await this._context.tracer.getTracer().withSpan("Generate LLM text", async span => {
            return await generateTextFromLanguageModel({
                tracer: span,
                ...options,
            });
        });
    }

    async generateObject<ObjectType>(
        options: LanguageModelsGenerateObjectOptions<ObjectType>,
    ): Promise<LanguageModelsGenerateObjectResult<ObjectType>> {
        return await this._context.tracer
            .getTracer()
            .withSpan("Generate LLM object", async span => {
                return await generateObjectFromLanguageModel({
                    tracer: span,
                    ...options,
                });
            });
    }

    fork(): LanguageModelsContextModuleBase {
        return new LanguageModelsContextModule({embeddingModel: this.embeddingModel});
    }
}
