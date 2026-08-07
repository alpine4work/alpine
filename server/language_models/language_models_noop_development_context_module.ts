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
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {SchemaSerializedObjectValue} from "~/shared/schema/schema.open_source.js";

/**
 * No-op LLM context module for tests and development without Bedrock configured.
 */
export class LanguageModelsNoopDevelopmentContextModule extends LanguageModelsContextModuleBase {
    constructor(options: LanguageModelsContextModuleOptions = {}) {
        super(options);
        assert(
            process.env.NODE_ENV !== "production",
            "LanguageModelsNoopDevelopmentContextModule should not be used in production",
        );
    }

    async generateText(
        options: LanguageModelsGenerateTextOptions,
    ): Promise<LanguageModelsGenerateTextResult> {
        void options;
        return {text: ""};
    }

    async generateObject<ObjectType>(
        options: LanguageModelsGenerateObjectOptions<ObjectType>,
    ): Promise<LanguageModelsGenerateObjectResult<ObjectType>> {
        return {
            object: options.schema.deserialize({} as SchemaSerializedObjectValue),
            text: "",
        };
    }

    fork(): LanguageModelsContextModuleBase {
        return new LanguageModelsNoopDevelopmentContextModule({
            embeddingModel: this.embeddingModel,
        });
    }
}
