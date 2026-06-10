import {BillingContextModuleBase} from "~/server/billing/billing_context_module_base.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {ApnsContextModuleBase} from "~/server/context/apns_context_module_base.js";
import {EdgeServiceContextModule} from "~/server/context/edge_service_context_module.js";
import {FilesContextModuleBase} from "~/server/context/files_context_module.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {SlackContextModuleBase} from "~/server/context/slack_context_module_base.js";
import {WebPushContextModuleBase} from "~/server/context/web_push_context_module.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {ImporterContextModuleBase} from "~/server/importer/importer_context_module_base.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {LogoDevContextModuleBase} from "~/server/spaces/logo_dev_context_module.js";
import {Context} from "~/shared/context/context.js";

type AppServiceExtraContextModules = {
    email: EmailContextModuleBase;
    edge: EdgeServiceContextModule;
    opensearch: OpensearchContextModule;
    languageModel: LanguageModelContextModule;
    apns: ApnsContextModuleBase;
    webPush: WebPushContextModuleBase;
    files: FilesContextModuleBase;
    r2: CloudflareR2ContextModule;
    billing: BillingContextModuleBase;
    importer: ImporterContextModuleBase;
    slack: SlackContextModuleBase;
    logoDev: LogoDevContextModuleBase;
};

export type AppServiceProcessContextModules = ServerProcessContextModules &
    AppServiceExtraContextModules;

export type AppServiceProcessContext = Context<AppServiceProcessContextModules>;

export type AppServiceSystemActionContextModules = ServerSystemActionContextModules &
    AppServiceExtraContextModules;

export type AppServiceSystemActionContext = Context<AppServiceSystemActionContextModules>;
