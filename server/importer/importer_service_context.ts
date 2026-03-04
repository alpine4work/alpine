import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {FilesContextModuleBase} from "~/server/context/files_context_module.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {ImporterServiceContextModuleBase} from "~/server/importer/importer_service_context_module_base.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

/**
 * Process-level context modules for the importer service. Does not include
 * action-level modules (actor, cache, batch).
 */
type ImporterServiceProcessContextModules = {
    importerService: ImporterServiceContextModuleBase;
    process: ProcessContextModule;
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    jobs: JobsContextModule;
    r2: CloudflareR2ContextModule;
    files: FilesContextModuleBase;
};

/**
 * Action-level context modules for the importer service. Includes all process
 * modules plus actor, cache, and batch.
 */
type ImporterServiceContextModules = ImporterServiceProcessContextModules & {
    actor: SystemActorContextModule;
    cache: CacheContextModule;
    batch: BatchContextModule;
};

export type ImporterServiceProcessContext = Context<ImporterServiceProcessContextModules>;
export type ImporterServiceSystemActionContext = Context<ImporterServiceContextModules>;
