import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {ContentContextModuleBase} from "~/server/context/content_context_module_base.js";
import {FilesContextModuleBase} from "~/server/context/files_context_module.js";
import {
    ServerActionContextModules,
    ServerSessionActionContextModules,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {Context} from "~/shared/context/context.js";

export type ServerContentExtraContextModules = {
    content: ContentContextModuleBase;
    files: FilesContextModuleBase;
    r2: CloudflareR2ContextModule;
};

export type ServerContentActionContext = Context<ServerContentActionContextModules>;

export type ServerContentActionContextModules = ServerActionContextModules &
    ServerContentExtraContextModules;

export type ServerContentSessionActionContext = Context<ServerContentSessionActionContextModules>;

export type ServerContentSessionActionContextModules = ServerSessionActionContextModules &
    ServerContentExtraContextModules;

export type ServerContentSystemActionContext = Context<ServerContentSystemActionContextModules>;

export type ServerContentSystemActionContextModules = ServerSystemActionContextModules &
    ServerContentExtraContextModules;
