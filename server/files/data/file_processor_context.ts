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
import {LanguageModelsContextModuleBase} from "~/server/language_models/language_models_context_module_base.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {Replace} from "~/shared/helpers/types/replace.js";

export type FileDataProcessContext = Context<FileDataProcessContextModules>;

assertAssignableTypes<ServerProcessContext, FileDataProcessContext>();

export type FileDataProcessContextModules = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    jobs: JobsContextModule;
    constants: ConstantsContextModule;
    r2: CloudflareR2ContextModule;
    files: FilesContextModuleBase;
};

export type FileDataActionContext = Context<FileDataActionContextModules>;

assertAssignableTypes<ServerActionContext, FileDataActionContext>();

export type FileDataActionContextModules = FileDataProcessContextModules & {
    cache: CacheContextModule;
    batch: BatchContextModule;
    actor: ActorContextModule;
};

/**
 * Minimal context type for system actions that work with file data.
 */
export type FileDataSystemActionContext = Context<FileDataSystemActionContextModules>;

assertAssignableTypes<ServerSystemActionContext, FileDataSystemActionContext>();

export type FileDataSystemActionContextModules = Replace<
    FileDataActionContextModules,
    {actor: SystemActorContextModule}
>;

/**
 * Minimal context type for account actions that work with file data. Supports
 * Session, ImpersonatedAccount, and Bot actors.
 */
export type FileDataAccountActionContext = Context<FileDataAccountActionContextModules>;

assertAssignableTypes<ServerAccountActionContext, FileDataAccountActionContext>();

export type FileDataAccountActionContextModules = Replace<
    FileDataActionContextModules,
    {
        actor:
            | SessionActorContextModule
            | ImpersonatedAccountActorContextModule
            | BotActorContextModule;
    }
>;

export type FileProcessorProcessContext = Context<FileProcessorProcessContextModules>;

export type FileProcessorProcessContextModules = FileDataProcessContextModules & {
    languageModels: LanguageModelsContextModuleBase;
};

export type FileProcessorActionContext = Context<FileProcessorActionContextModules>;

export type FileProcessorActionContextModules = FileProcessorProcessContextModules & {
    cache: CacheContextModule;
    batch: BatchContextModule;
    actor: ActorContextModule;
};

/**
 * Minimal context type for system actions that work with file processing.
 */
export type FileProcessorSystemActionContext = Context<FileProcessorSystemActionContextModules>;

export type FileProcessorSystemActionContextModules = Replace<
    FileProcessorActionContextModules,
    {actor: SystemActorContextModule}
>;

/**
 * Minimal context type for account actions that work with file processing.
 * Supports Session, ImpersonatedAccount, and Bot actors.
 */
export type FileProcessorAccountActionContext = Context<FileProcessorAccountActionContextModules>;

export type FileProcessorAccountActionContextModules = Replace<
    FileProcessorActionContextModules,
    {
        actor:
            | SessionActorContextModule
            | ImpersonatedAccountActorContextModule
            | BotActorContextModule;
    }
>;
