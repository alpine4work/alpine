import {
    ServerBotActionContextModules,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {Context} from "~/shared/context/context.js";

type ApiServiceExtraContextModules = {
    languageModel?: LanguageModelContextModule;
};

export type ApiServiceProcessContextModules = ServerProcessContextModules &
    ApiServiceExtraContextModules;

export type ApiServiceProcessContext = Context<ApiServiceProcessContextModules>;

export type ApiServiceSystemActionContextModules = ServerSystemActionContextModules &
    ApiServiceExtraContextModules;

export type ApiServiceSystemActionContext = Context<ApiServiceSystemActionContextModules>;

type ApiServiceBotActionContextModules = ServerBotActionContextModules & {
    /**
     * A language model is optional in unit tests. But must be provided in
     * production and local developer environments.
     */
    languageModel?: LanguageModelContextModule;
};

export type ApiServiceBotActionContext = Context<ApiServiceBotActionContextModules>;
