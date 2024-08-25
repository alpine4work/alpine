import {ApnsContextModuleBase} from "~/server/apns/apns_context_module.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {EdgeServiceContextModule} from "~/server/tokens/edge_service_context_module.js";
import {Context} from "~/shared/context/context.js";

type AppServiceProcessExtraContextModules = {
    email: EmailContextModuleBase;
    edge: EdgeServiceContextModule;
    opensearch: OpensearchContextModule;
    languageModel: LanguageModelContextModule;
    apns: ApnsContextModuleBase;
};

export type AppServiceProcessContextModules = ServerProcessContextModules &
    AppServiceProcessExtraContextModules;

export type AppServiceProcessContext = Context<AppServiceProcessContextModules>;

export type AppServiceSystemActionContextModules = ServerSystemActionContextModules &
    AppServiceProcessExtraContextModules;

export type AppServiceSystemActionContext = Context<AppServiceSystemActionContextModules>;
