import {ApnsContextModuleBase} from "~/server/apns/apns_context_module.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {GithubContextModuleBase} from "~/server/deploy/data/github_context_module.js";
import {SchedulerContextModuleBase} from "~/server/deploy/data/scheduler_context_module.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {Context} from "~/shared/context/context.js";

type JobQueueServiceExtraContextModules = {
    languageModel: LanguageModelContextModule;
    apns: ApnsContextModuleBase;
    github: GithubContextModuleBase;
    scheduler: SchedulerContextModuleBase;
};

export type JobQueueServiceProcessContextModules = ServerProcessContextModules &
    JobQueueServiceExtraContextModules;

export type JobQueueServiceProcessContext = Context<JobQueueServiceProcessContextModules>;

export type JobQueueServiceSystemActionContextModules = ServerSystemActionContextModules &
    JobQueueServiceExtraContextModules;

export type JobQueueServiceSystemActionContext = Context<JobQueueServiceSystemActionContextModules>;

export type MaintenanceJobQueueServiceSystemActionContextModules = Omit<
    ServerSystemActionContextModules,
    "actor"
> &
    JobQueueServiceExtraContextModules;

export type MaintenanceJobQueueSystemActionContext =
    Context<MaintenanceJobQueueServiceSystemActionContextModules>;
