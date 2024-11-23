import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {FilesContextModuleBase} from "~/server/context/files_context_module.js";
import {
    ServerActionContextModules,
    ServerSessionActionContextModules,
} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {Context} from "~/shared/context/context.js";

type FileProcessorServiceExtraContextModules = {
    r2: CloudflareR2ContextModule;
    files: FilesContextModuleBase;
};

export type FileProcessorServiceProcessContextModules = ServerProcessContextModules &
    FileProcessorServiceExtraContextModules;

export type FileProcessorServiceProcessContext = Context<FileProcessorServiceProcessContextModules>;

export type FileProcessorServiceActionContextModules = ServerActionContextModules &
    FileProcessorServiceExtraContextModules;

export type FileProcessorServiceActionContext = Context<FileProcessorServiceActionContextModules>;

export type FileProcessorServiceSessionActionContextModules = ServerSessionActionContextModules &
    FileProcessorServiceExtraContextModules;

export type FileProcessorServiceSessionActionContext =
    Context<FileProcessorServiceSessionActionContextModules>;
