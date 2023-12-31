import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {Context} from "~/shared/context/context.js";

export type SearchEntityIndexSystemActionContext =
    Context<SearchEntityIndexSystemActionContextModules>;

export type SearchEntityIndexSystemActionContextModules = ServerSystemActionContextModules & {
    jobs: JobsContextModule;

    /**
     * A language model is optional in unit tests. But must be provided in
     * production and local developer environments.
     */
    languageModel?: LanguageModelContextModule;
};
