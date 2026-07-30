import {
    LanguageModelBase,
    LanguageModelBaseClass,
} from "~/server/language_models/core/language_model_base.js";
import {
    LanguageModelsGenerateObjectOptions,
    LanguageModelsGenerateObjectResult,
    LanguageModelsGenerateTextOptions,
    LanguageModelsGenerateTextResult,
} from "~/server/language_models/language_models_types.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";

export type LanguageModelsContextModuleOptions = {
    readonly embeddingModel?: LanguageModelBase | null;
};

/**
 * Base context module for shared Bedrock-backed LLM operations.
 */
export abstract class LanguageModelsContextModuleBase<
    Modules extends {
        tracer: TracerContextModule;
    } = {
        tracer: TracerContextModule;
    },
> extends ContextModuleBase<Modules> {
    public readonly embeddingModel: LanguageModelBase | null;

    constructor({embeddingModel = null}: LanguageModelsContextModuleOptions = {}) {
        super();
        this.embeddingModel = embeddingModel;
    }

    getEmbeddingModelKey(): LanguageModelBaseClass["key"] | null {
        return this.embeddingModel?.statics.key ?? null;
    }

    async embed(
        texts: Iterable<string>,
        options: {readonly inputType: "SearchDocument" | "SearchQuery"},
    ): Promise<Iterable<Iterable<number>>> {
        const embeddingModel = this.embeddingModel;
        assert(embeddingModel, "Missing embedding language model in context");

        return await embeddingModel.embed(this._context.tracer.getTracer(), texts, options);
    }

    abstract generateText(
        options: LanguageModelsGenerateTextOptions,
    ): Promise<LanguageModelsGenerateTextResult>;
    abstract generateObject<ObjectType>(
        options: LanguageModelsGenerateObjectOptions<ObjectType>,
    ): Promise<LanguageModelsGenerateObjectResult<ObjectType>>;
    abstract fork(): ForkableContextModuleBase;
}
