import {DynamoSystemActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";

export type TaskRealtimeSystemActionContext = Context<TaskRealtimeSystemActionContextModules>;

type TaskRealtimeSystemActionContextModules = ServerProcessContextModules & {
    cache: CacheContextModule;
    actor: DynamoSystemActorContextModule;
};
