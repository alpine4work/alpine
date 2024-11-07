import {FilesContextModuleBase} from "~/server/context/files_context_module.js";
import {
    ServerActionContextModules,
    ServerSessionActionContextModules,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {Context} from "~/shared/context/context.js";

export type ServerContentExtraContextModules = {
    files: FilesContextModuleBase;
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
