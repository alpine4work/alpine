import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {
    DynamoActorContextModule,
    DynamoSessionActorContextModule,
} from "~/server/context/dynamo_actor_context_module.js";
import {FilesContextModuleBase} from "~/server/context/files_context_module.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {ServerConstantsContextModule} from "~/shared/context/constants_context_module.js";
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
    constants: ServerConstantsContextModule;
    r2: CloudflareR2ContextModule;
    files: FilesContextModuleBase;
};

export type FileProcessorActionContext = Context<FileProcessorActionContextModules>;

assertAssignableTypes<ServerActionContext, FileProcessorActionContext>();

export type FileProcessorActionContextModules = FileProcessorProcessContextModules & {
    cache: CacheContextModule;
    batch: BatchContextModule;
    actor: DynamoActorContextModule;
};

export type FileProcessorSessionActionContext = Context<FileProcessorSessionActionContextModules>;

assertAssignableTypes<ServerSessionActionContext, FileProcessorSessionActionContext>();

export type FileProcessorSessionActionContextModules = Replace<
    FileProcessorActionContextModules,
    {actor: DynamoSessionActorContextModule}
>;
