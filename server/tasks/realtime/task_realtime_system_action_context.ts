import {DynamoSystemActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

export type TaskRealtimeSystemActionContext = Context<{
    process: ProcessContextModule;
    tracer: TracerContextModule;
    cache: CacheContextModule;
    dynamo: DynamoContextModule;
    opensearch: OpensearchContextModule;
    actor: DynamoSystemActorContextModule;
}>;
