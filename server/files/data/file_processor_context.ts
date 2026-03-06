import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {FilesContextModuleBase} from "~/server/context/files_context_module.js";
import {
    ServerAccountActionContext,
    ServerActionContext,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {
    ActorContextModule,
    BotActorContextModule,
    ImpersonatedAccountActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {Replace} from "~/shared/helpers/types/replace.js";

export type FileProcessorProcessContext = Context<FileProcessorProcessContextModules>;

assertAssignableTypes<ServerProcessContext, FileProcessorProcessContext>();

export type FileProcessorProcessContextModules = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    jobs: JobsContextModule;
    constants: ConstantsContextModule;
    r2: CloudflareR2ContextModule;
    files: FilesContextModuleBase;
};

export type FileProcessorActionContext = Context<FileProcessorActionContextModules>;

assertAssignableTypes<ServerActionContext, FileProcessorActionContext>();

export type FileProcessorActionContextModules = FileProcessorProcessContextModules & {
    cache: CacheContextModule;
    batch: BatchContextModule;
    actor: ActorContextModule;
};

/**
 * Minimal context type for system actions that work with files. This is a subset
 * of ServerSystemActionContext with only the modules needed.
 */
export type FileProcessorSystemActionContext = Context<FileProcessorSystemActionContextModules>;

assertAssignableTypes<ServerSystemActionContext, FileProcessorSystemActionContext>();

export type FileProcessorSystemActionContextModules = Replace<
    FileProcessorActionContextModules,
    {actor: SystemActorContextModule}
>;

/**
 * Minimal context type for account actions that work with files (upload, etc.).
 * This is a subset of ServerAccountActionContext with only the modules needed.
 * Supports Session, ImpersonatedAccount, and Bot actors.
 */
export type FileProcessorAccountActionContext = Context<FileProcessorAccountActionContextModules>;

assertAssignableTypes<ServerAccountActionContext, FileProcessorAccountActionContext>();

export type FileProcessorAccountActionContextModules = Replace<
    FileProcessorActionContextModules,
    {
        actor:
            | SessionActorContextModule
            | ImpersonatedAccountActorContextModule
            | BotActorContextModule;
    }
>;
