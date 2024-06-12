import {ApnsContextModule} from "~/server/apns/apns_context_module.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {SearchEntityIndexSystemActionContextModules} from "~/server/search/data/index/search_entity_index_system_action_context.js";
import {TaskContextModuleBase} from "~/server/tasks/data/task_context_module.js";
import {Context} from "~/shared/context/context.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";

export type JobQueueSystemActionContext = Context<JobQueueSystemActionContextModules>;

export type JobQueueSystemActionContextModules = ServerSystemActionContextModules & {
    tasks: TaskContextModuleBase;
    apns: ApnsContextModule;
};

export type MaintenanceJobQueueSystemActionContext =
    Context<MaintenanceJobQueueSystemActionContextModules>;

export type MaintenanceJobQueueSystemActionContextModules = Omit<
    ServerSystemActionContextModules,
    "actor"
> & {
    tasks: TaskContextModuleBase;
};

// Should be able to use a job queue context for search entity indexing.
assertAssignableTypes<
    JobQueueSystemActionContextModules,
    SearchEntityIndexSystemActionContextModules
>();
