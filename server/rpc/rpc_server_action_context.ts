import {BillingContextModuleBase} from "~/server/billing/billing_context_module_base.js";
import {ApnsContextModuleBase} from "~/server/context/apns_context_module_base.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {SlackContextModuleBase} from "~/server/context/slack_context_module_base.js";
import {WebPushContextModule} from "~/server/context/web_push_context_module.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {ImporterContextModuleBase} from "~/server/importer/importer_context_module_base.js";
import {LanguageModelsContextModuleBase} from "~/server/language_models/language_models_context_module_base.js";
import {LogoDevContextModuleBase} from "~/server/spaces/logo_dev_context_module.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {Context} from "~/shared/context/context.js";

export type RpcServerActionContext = Context<RpcServerActionContextModules>;

export type RpcServerActionContextModules = ServerActionContextModules &
    RpcServerActionExtraContextModules;

export type RpcServerActionExtraContextModules = {
    tasks: TaskContextModule;
    email: EmailContextModuleBase;
    languageModels: LanguageModelsContextModuleBase;
    apns: ApnsContextModuleBase;
    webPush: WebPushContextModule;
    billing: BillingContextModuleBase;
    importer: ImporterContextModuleBase;
    logoDev: LogoDevContextModuleBase;
    slack: SlackContextModuleBase;
};
