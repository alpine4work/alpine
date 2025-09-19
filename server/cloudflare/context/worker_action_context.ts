import {WorkerProcessContextModules} from "~/server/cloudflare/context/worker_process_context.js";
import {
    ActorContextModule,
    BotActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ForkActionContextModule} from "~/shared/context/fork_action_context_module.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";

type WorkerActionContextModulesBase = WorkerProcessContextModules & {
    /**
     * Action-level caching. Cached values only live for the span of the action and
     * are not shared across actions.
     */
    cache: CacheContextModule;

    /**
     * Action-level batching. Allows us to batch multiple requests made in the
     * current synchronous context into one network request to some backend
     * service.
     */
    batch: BatchContextModule;

    /**
     * Allow executing RPCs in an action. You may only execute RPCs within the
     * context of an action because there's an actor context module with session
     * information.
     *
     * Allow any RPC context module (instead of just `WorkerRpcContextModule`) so
     * that tests may use `LocalRpcContextModule`.
     */
    rpc: RpcContextModuleBase;

    /**
     * Allows us to fork out new actions with the same credentials but everything
     * else is reset. Particularly useful for WebSocket servers where we fork a new
     * action context for each incoming message we need to process.
     */
    fork: ForkActionContextModule;
};

/**
 * Generic context for handling actions against our system.
 */
export type WorkerActionContext = Context<WorkerActionContextModules>;

export type WorkerActionContextModules = MergeObjectIntersection<
    WorkerActionContextModulesBase & {
        /**
         * A representation of the entity acting against our systems.
         *
         * Uses the generic actor interface instead of `ActorContextModule`
         * (which is what we instantiate this context with) so that tests can pass in
         * an `AppActorContextModule` which is type compatible.
         */
        actor: ActorContextModule;
    }
>;

/**
 * Generic context for handling actions against our system with a
 * session actor.
 */
export type WorkerSessionActionContext = Context<WorkerSessionActionContextModules>;

export type WorkerSessionActionContextModules = WorkerActionContextModulesBase & {
    actor: SessionActorContextModule;
};

/**
 * Generic context for handling actions against our system with a
 * system actor.
 */
export type WorkerSystemActionContext = Context<WorkerSystemActionContextModules>;

export type WorkerSystemActionContextModules = WorkerActionContextModulesBase & {
    actor: SystemActorContextModule;
};

/**
 * Context for actions by a bot in a specified scope.
 */

export type WorkerBotActionContext = Context<WorkerBotActionContextModules>;

export type WorkerBotActionContextModules = WorkerActionContextModulesBase & {
    actor: BotActorContextModule;
};
