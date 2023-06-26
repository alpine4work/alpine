import {
    ActorContextModule,
    MaybeSessionActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
} from "~/server/dynamo/context/actor_context_module.js";
import {ProcessContextModulesBase} from "~/server/dynamo/context/process_context.js";
import {DynamoBatchContextModule} from "~/server/dynamo/dynamo_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";

/**
 * Generic context for handling actions against our system that doesn't know
 * which actor is operating our system.
 */
export type ActionContextBase = Context<ActionContextModulesBase>;

export type ActionContextModulesBase = ProcessContextModulesBase & {
    /**
     * Action-level caching. Cached values only live for the span of the action and
     * are not shared across actions.
     */
    cache: CacheContextModule;

    /**
     * Batch DynamoDB requests at the action level. Any calls to `getItem()`,
     * `createOrReplaceItem()`, or `deleteItem()` in short succession on the
     * context are batched.
     *
     * We batch at the action level so that unrelated requests do not share IO.
     * It's an error to share IO across requests in Cloudflare Workers.
     */
    dynamoBatchContext: DynamoBatchContextModule;
};

/**
 * Generic context for handling actions against our system.
 */
export type ActionContext = Context<ActionContextModules>;

export type ActionContextModules = MergeObjectIntersection<
    ActionContextModulesBase & {
        actor: ActorContextModule;
    }
>;

/**
 * Context for actions where we know the actor is a session actor.
 */
export type SessionActionContext = Context<SessionActionContextModules>;

export type SessionActionContextModules = MergeObjectIntersection<
    ActionContextModulesBase & {
        actor: SessionActorContextModule;
    }
>;

/**
 * Context for actions where the actor might be a session actor but we need to
 * lazily authenticate to get a `SessionActionContext`.
 */
export type MaybeSessionActionContext = Context<MaybeSessionActionContextModules>;

export type MaybeSessionActionContextModules = MergeObjectIntersection<
    ActionContextModulesBase & {
        actor: MaybeSessionActorContextModule;
    }
>;

/**
 * Context for actions where we know the actor is a system actor.
 */
export type SystemActionContext = Context<SystemActionContextModules>;

export type SystemActionContextModules = MergeObjectIntersection<
    ActionContextModulesBase & {
        actor: SystemActorContextModule;
    }
>;
