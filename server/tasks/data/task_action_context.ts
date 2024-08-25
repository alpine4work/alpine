import {
    ServerActionContextModules,
    ServerSessionActionContextModules,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {Context} from "~/shared/context/context.js";

type TaskActionExtraContextModules = {
    opensearch: OpensearchContextModule;
};

export type TaskActionContextModules = ServerActionContextModules & TaskActionExtraContextModules;

export type TaskActionContext = Context<TaskActionContextModules>;

export type TaskSessionActionContextModules = ServerSessionActionContextModules &
    TaskActionExtraContextModules;

export type TaskSessionActionContext = Context<TaskSessionActionContextModules>;

export type TaskSystemActionContextModules = ServerSystemActionContextModules &
    TaskActionExtraContextModules;

export type TaskSystemActionContext = Context<TaskSystemActionContextModules>;
