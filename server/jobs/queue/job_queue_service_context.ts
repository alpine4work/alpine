import {ApnsContextModuleBase} from "~/server/apns/apns_context_module.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {GithubContextModuleBase} from "~/server/deploy/data/github_context_module.js";
import {SchedulerContextModuleBase} from "~/server/deploy/data/scheduler_context_module.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {TaskContextModuleBase} from "~/server/tasks/data/task_context_module.js";
import {EdgeServiceContextModule} from "~/server/tokens/edge_service_context_module.js";
import {Context} from "~/shared/context/context.js";

type JobQueueServiceProcessExtraContextModules = {
    edge: EdgeServiceContextModule;
    opensearch: OpensearchContextModule;
    languageModel: LanguageModelContextModule;
    apns: ApnsContextModuleBase;
    github: GithubContextModuleBase;
    scheduler: SchedulerContextModuleBase;
};

type JobQueueServiceActionExtraContextModules = {
    tasks: TaskContextModuleBase;
};

export type JobQueueServiceProcessContextModules = ServerProcessContextModules &
    JobQueueServiceProcessExtraContextModules;

export type JobQueueServiceProcessContext = Context<JobQueueServiceProcessContextModules>;

export type JobQueueServiceSystemActionContextModules = ServerSystemActionContextModules &
    JobQueueServiceProcessExtraContextModules &
    JobQueueServiceActionExtraContextModules;

export type JobQueueServiceSystemActionContext = Context<JobQueueServiceSystemActionContextModules>;

export type MaintenanceJobQueueServiceSystemActionContextModules = Omit<
    ServerSystemActionContextModules,
    "actor"
> &
    JobQueueServiceProcessExtraContextModules &
    JobQueueServiceActionExtraContextModules;

export type MaintenanceJobQueueSystemActionContext =
    Context<MaintenanceJobQueueServiceSystemActionContextModules>;
