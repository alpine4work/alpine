import {
    ChatInjectionContextModule,
    DocumentsInjectionContextModule,
    ForumInjectionContextModule,
    TasksInjectionContextModule,
} from "~/server/context/injection_context_module.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {
    ActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {Replace} from "~/shared/helpers/types/replace.js";

export type TaskRealtimeProcessContext = Context<TaskRealtimeProcessContextModules>;

assertAssignableTypes<ServerProcessContext, TaskRealtimeProcessContext>();

export type TaskRealtimeProcessContextModules = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    jobs: JobsContextModule;
    constants: ConstantsContextModule;
    opensearch: OpensearchContextModule;
    chatInjection: ChatInjectionContextModule;
    documentsInjection: DocumentsInjectionContextModule;
    forumInjection: ForumInjectionContextModule;
    tasksInjection: TasksInjectionContextModule;
};

export type TaskRealtimeActionContext = Context<TaskRealtimeActionContextModules>;

assertAssignableTypes<ServerActionContext, TaskRealtimeActionContext>();
assertAssignableTypes<TaskRealtimeActionContext, ServerMinimalActionContext>();

export type TaskRealtimeActionContextModules = TaskRealtimeProcessContextModules & {
    batch: BatchContextModule;
    cache: CacheContextModule;
    actor: ActorContextModule;
};

export type TaskRealtimeSessionActionContext = Context<TaskRealtimeSessionActionContextModules>;

export type TaskRealtimeSessionActionContextModules = Replace<
    TaskRealtimeActionContextModules,
    {actor: SessionActorContextModule}
>;

assertAssignableTypes<ServerSessionActionContext, TaskRealtimeSessionActionContext>();

export type TaskRealtimeSystemActionContext = Context<TaskRealtimeSystemActionContextModules>;

assertAssignableTypes<ServerSystemActionContext, TaskRealtimeSystemActionContext>();

export type TaskRealtimeSystemActionContextModules = Replace<
    TaskRealtimeActionContextModules,
    {actor: SystemActorContextModule}
>;
