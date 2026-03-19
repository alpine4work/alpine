import {
    ChatInjectionContextModule,
    DocumentsInjectionContextModule,
    ForumInjectionContextModule,
    TasksInjectionContextModule,
} from "~/server/context/injection_context_module.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {
    AccountActorContextModule,
    ActorContextModule,
    BotActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {Replace} from "~/shared/helpers/types/replace.js";

/**
 * A lightweight action context that's compatible with the minimal action context
 * of `TaskRealtimeService` and `FileProcessorService`.
 */
export type ServerMinimalActionContext = Context<ServerMinimalActionContextModules>;

assertAssignableTypes<ServerActionContext, ServerMinimalActionContext>();

export type ServerMinimalActionContextModules = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
    cache: CacheContextModule;
    batch: BatchContextModule;
    dynamo: DynamoContextModule;
    jobs: JobsContextModule;
    actor: ActorContextModule;
    chatInjection: ChatInjectionContextModule;
    documentsInjection: DocumentsInjectionContextModule;
    forumInjection: ForumInjectionContextModule;
    tasksInjection: TasksInjectionContextModule;
};

export type ServerMinimalSystemActionContext = Context<ServerMinimalSystemActionContextModules>;

export type ServerMinimalSystemActionContextModules = Replace<
    ServerMinimalActionContextModules,
    {
        actor: SystemActorContextModule;
    }
>;

export type ServerMinimalBotActionContext = Context<ServerMinimalBotActionContextModules>;

export type ServerMinimalBotActionContextModules = Replace<
    ServerMinimalActionContextModules,
    {
        actor: BotActorContextModule;
    }
>;

export type ServerMinimalAccountActionContext = Context<ServerMinimalAccountActionContextModules>;

export type ServerMinimalAccountActionContextModules = Replace<
    ServerMinimalActionContextModules,
    {
        actor: AccountActorContextModule;
    }
>;
