import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module.js";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module_interface.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

export type TaskRealtimeActionContext = Context<{
    tracer: TracerContextModule;
    cache: CacheContextModule;
    dynamo: DynamoContextModule;
    opensearch: OpensearchContextModule;
    actor: SystemActorContextModule;
}>;
