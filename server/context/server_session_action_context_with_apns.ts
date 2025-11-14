import {ApnsContextModuleBase} from "~/server/context/apns_context_module_base.js";
import {ServerSessionActionContextModules} from "~/server/context/server_action_context.js";
import {Context} from "~/shared/context/context.js";

export type ServerSessionActionContextWithApns = Context<ServerSessionActionContextWithApnsModules>;

export type ServerSessionActionContextWithApnsModules = ServerSessionActionContextModules & {
    apns: ApnsContextModuleBase;
};
