import {ApnsContextModuleBase} from "~/server/apns/apns_context_module.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {ContentContextModuleBase} from "~/server/context/content_context_module_base.js";
import {FilesContextModuleBase} from "~/server/context/files_context_module.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {GithubContextModuleBase} from "~/server/deploy/data/github_context_module.js";
import {SchedulerContextModuleBase} from "~/server/deploy/data/scheduler_context_module.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {TaskContextModuleBase} from "~/server/tasks/data/task_context_module.js";
import {EdgeServiceContextModule} from "~/server/tokens/edge_service_context_module.js";
import {Context} from "~/shared/context/context.js";

type JobQueueServiceExtraContextModules = {
    edge: EdgeServiceContextModule;
    opensearch: OpensearchContextModule;
    languageModel: LanguageModelContextModule;
    apns: ApnsContextModuleBase;
    github: GithubContextModuleBase;
    scheduler: SchedulerContextModuleBase;
    files: FilesContextModuleBase;
    r2: CloudflareR2ContextModule;
};

type JobQueueServiceActionExtraContextModules = {
    content: ContentContextModuleBase;
    tasks: TaskContextModuleBase;
};

export type JobQueueServiceProcessContextModules = ServerProcessContextModules &
    JobQueueServiceExtraContextModules;

export type JobQueueServiceProcessContext = Context<JobQueueServiceProcessContextModules>;

export type JobQueueServiceSystemActionContextModules = ServerSystemActionContextModules &
    JobQueueServiceExtraContextModules &
    JobQueueServiceActionExtraContextModules;

export type JobQueueServiceSystemActionContext = Context<JobQueueServiceSystemActionContextModules>;

export type MaintenanceJobQueueServiceSystemActionContextModules = Omit<
    ServerSystemActionContextModules,
    "actor"
> &
    JobQueueServiceExtraContextModules &
    JobQueueServiceActionExtraContextModules;

export type MaintenanceJobQueueSystemActionContext =
    Context<MaintenanceJobQueueServiceSystemActionContextModules>;
