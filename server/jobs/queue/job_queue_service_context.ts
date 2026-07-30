import {BotWebhookContextModule} from "~/server/bots/bot_webhook_context_module.js";
import {ApnsContextModuleBase} from "~/server/context/apns_context_module_base.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {SlackContextModuleBase} from "~/server/context/slack_context_module_base.js";
import {WebPushContextModule} from "~/server/context/web_push_context_module.js";
import {GithubContextModuleBase} from "~/server/deploy/data/github_context_module.js";
import {SchedulerContextModuleBase} from "~/server/deploy/data/scheduler_context_module.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {LanguageModelsContextModuleBase} from "~/server/language_models/language_models_context_module_base.js";
import {LoopsContextModuleBase} from "~/server/spaces/loops_context_module.js";
import {Context} from "~/shared/context/context.js";

type JobQueueServiceExtraContextModules = {
    languageModels: LanguageModelsContextModuleBase;
    apns: ApnsContextModuleBase;
    github: GithubContextModuleBase;
    scheduler: SchedulerContextModuleBase;
    email: EmailContextModuleBase;
    botWebhook: BotWebhookContextModule;
    webPush: WebPushContextModule;
    slack: SlackContextModuleBase;
    loops: LoopsContextModuleBase;
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
