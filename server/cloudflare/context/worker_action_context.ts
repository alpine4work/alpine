import {
    WorkerActorContextModule,
    WorkerSessionActorContextModule,
} from "~/server/cloudflare/context/worker_actor_context_module.js";
import {WorkerProcessContextModules} from "~/server/cloudflare/context/worker_process_context.js";
import {WorkerRpcContextModule} from "~/server/cloudflare/context/worker_rpc_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";

type WorkerActionContextModulesBase = WorkerProcessContextModules & {
    /**
     * Action-level caching. Cached values only live for the span of the action and
     * are not shared across actions.
     */
    cache: CacheContextModule;

    /**
     * Allow executing RPCs in an action. You may only execute RPCs within the
     * context of an action because there's an actor context module with session
     * information.
     */
    rpc: WorkerRpcContextModule;
};

/**
 * Generic context for handling actions against our system.
 */
export type WorkerActionContext = Context<WorkerActionContextModules>;

export type WorkerActionContextModules = MergeObjectIntersection<
    WorkerActionContextModulesBase & {
        actor: WorkerActorContextModule;
    }
>;

/**
 * Generic context for handling actions against our system with a
 * session actor.
 */
export type WorkerSessionActionContext = Context<WorkerSessionActionContextModules>;

export type WorkerSessionActionContextModules = MergeObjectIntersection<
    WorkerActionContextModulesBase & {
        actor: WorkerSessionActorContextModule;
    }
>;
