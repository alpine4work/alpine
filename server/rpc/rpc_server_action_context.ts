import {ApnsContextModuleBase} from "~/server/context/apns_context_module_base.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {Context} from "~/shared/context/context.js";

export type RpcServerActionContext = Context<RpcServerActionContextModules>;

export type RpcServerActionContextModules = ServerActionContextModules &
    RpcServerActionExtraContextModules;

export type RpcServerActionExtraContextModules = {
    tasks: TaskContextModule;
    email: EmailContextModuleBase;
    languageModel: LanguageModelContextModule;
    apns: ApnsContextModuleBase;
};
