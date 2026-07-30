import {
    ServerBotActionContextModules,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {LanguageModelsContextModuleBase} from "~/server/language_models/language_models_context_module_base.js";
import {Context} from "~/shared/context/context.js";

type ApiServiceExtraContextModules = {
    languageModels?: LanguageModelsContextModuleBase;
};

export type ApiServiceProcessContextModules = ServerProcessContextModules &
    ApiServiceExtraContextModules;

export type ApiServiceProcessContext = Context<ApiServiceProcessContextModules>;

export type ApiServiceSystemActionContextModules = ServerSystemActionContextModules &
    ApiServiceExtraContextModules;

export type ApiServiceSystemActionContext = Context<ApiServiceSystemActionContextModules>;

type ApiServiceBotActionContextModules = ServerBotActionContextModules & {
    /**
     * A language model is optional in unit tests. But must be provided in production
     * and local developer environments.
     */
    languageModels?: LanguageModelsContextModuleBase;
};

export type ApiServiceBotActionContext = Context<ApiServiceBotActionContextModules>;
