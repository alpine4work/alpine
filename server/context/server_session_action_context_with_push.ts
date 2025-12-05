import {PushContextModules} from "~/server/context/push_context_modules.js";
import {ServerSessionActionContextModules} from "~/server/context/server_action_context.js";
import {Context} from "~/shared/context/context.js";

export type ServerSessionActionContextWithPush = Context<ServerSessionActionContextWithPushModules>;

export type ServerSessionActionContextWithPushModules = ServerSessionActionContextModules &
    PushContextModules;
