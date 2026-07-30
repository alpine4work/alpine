import {LanguageModelBase} from "~/server/language_models/core/language_model_base.js";
import {LanguageModelsContextModule} from "~/server/language_models/language_models_context_module.js";
import {LanguageModelsContextModuleBase} from "~/server/language_models/language_models_context_module_base.js";
import {LanguageModelsDevelopmentContextModule} from "~/server/language_models/language_models_development_context_module.js";
import {LanguageModelsNoopDevelopmentContextModule} from "~/server/language_models/language_models_noop_development_context_module.js";

/**
 * Create the process-level LLM module for the current runtime.
 *
 * In tests we always use a no-op module. In development we only enable Bedrock
 * when a bearer token is configured. In production we always return the real
 * module and let it assert configuration when used.
 */
export function createLanguageModelsContextModuleForProcess({
    awsBedrockTokenForDevelopment,
    embeddingModel,
}: {
    awsBedrockTokenForDevelopment?: string;
    embeddingModel?: LanguageModelBase | null;
}): LanguageModelsContextModuleBase {
    if (process.env.NODE_ENV === "test") {
        return new LanguageModelsNoopDevelopmentContextModule({embeddingModel});
    }

    if (process.env.NODE_ENV === "production") {
        return new LanguageModelsContextModule({embeddingModel});
    }

    return awsBedrockTokenForDevelopment !== undefined
        ? new LanguageModelsDevelopmentContextModule({
              awsBedrockTokenForDevelopment,
              embeddingModel,
          })
        : new LanguageModelsNoopDevelopmentContextModule({embeddingModel});
}
