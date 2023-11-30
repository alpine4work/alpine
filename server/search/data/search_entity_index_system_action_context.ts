import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {TaskContextModuleBase} from "~/server/tasks/data/task_context_module.js";
import {Context} from "~/shared/context/context.js";

export type SearchEntityIndexSystemActionContext =
    Context<SearchEntityIndexSystemActionContextModules>;

export type SearchEntityIndexSystemActionContextModules = ServerSystemActionContextModules & {
    tasks: TaskContextModuleBase;
};
