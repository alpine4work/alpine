import {ApnsContextModuleBase} from "~/server/apns/apns_context_module.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {ContentContextModuleBase} from "~/server/context/content_context_module_base.js";
import {FilesContextModuleBase} from "~/server/context/files_context_module.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {EdgeServiceContextModuleBase} from "~/server/tokens/edge_service_context_module.js";
import {Context} from "~/shared/context/context.js";

export type RpcServerActionContext = Context<RpcServerActionContextModules>;

export type RpcServerActionContextModules = ServerActionContextModules &
    RpcServerActionExtraContextModules;

export type RpcServerActionExtraContextModules = {
    email: EmailContextModuleBase;
    edge: EdgeServiceContextModuleBase;
    opensearch: OpensearchContextModule;
    tasks: TaskContextModule;
    languageModel: LanguageModelContextModule;
    apns: ApnsContextModuleBase;
    content: ContentContextModuleBase;
    files: FilesContextModuleBase;
    r2: CloudflareR2ContextModule;
};
