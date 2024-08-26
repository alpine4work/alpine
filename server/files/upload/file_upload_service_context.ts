import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {Context} from "~/shared/context/context.js";

type FileUploadServiceExtraContextModules = {
    r2: CloudflareR2ContextModule;
};

export type FileUploadServiceProcessContextModules = ServerProcessContextModules &
    FileUploadServiceExtraContextModules;

export type FileUploadServiceProcessContext = Context<FileUploadServiceProcessContextModules>;

export type FileUploadServiceActionContextModules = ServerActionContextModules &
    FileUploadServiceExtraContextModules;

export type FileUploadServiceActionContext = Context<FileUploadServiceActionContextModules>;
