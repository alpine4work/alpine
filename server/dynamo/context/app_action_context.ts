import {
    AppActorContextModule,
    AppUnknownActorContextModule,
    AppSessionActorContextModule,
    AppSystemActorContextModule,
} from "~/server/dynamo/context/app_actor_context_module.js";
import {AppProcessContextModulesBase} from "~/server/dynamo/context/app_process_context.js";
import {DynamoBatchContextModule} from "~/server/dynamo/dynamo_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";

/**
 * Generic context for handling actions against our system that doesn't know
 * which actor is operating our system.
 */
export type AppActionContextBase = Context<AppActionContextModulesBase>;

export type AppActionContextModulesBase = AppProcessContextModulesBase & {
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
     */
    dynamoBatchContext: DynamoBatchContextModule;
};

/**
 * Generic context for handling actions against our system.
 */
export type AppActionContext = Context<AppActionContextModules>;

export type AppActionContextModules = MergeObjectIntersection<
    AppActionContextModulesBase & {
        actor: AppActorContextModule;
    }
>;

/**
 * Context for actions where we know the actor is a session actor.
 */
export type AppSessionActionContext = Context<AppSessionActionContextModules>;

export type AppSessionActionContextModules = MergeObjectIntersection<
    AppActionContextModulesBase & {
        actor: AppSessionActorContextModule;
    }
>;

/**
 * Context for actions where we know the actor is a system actor.
 */
export type AppSystemActionContext = Context<AppSystemActionContextModules>;

export type AppSystemActionContextModules = MergeObjectIntersection<
    AppActionContextModulesBase & {
        actor: AppSystemActorContextModule;
    }
>;

/**
 * Context for actions where the actor might be a session actor but we need to
 * lazily authenticate to get an `AppActionContext`.
 */
export type AppAmbiguousActionContext = Context<AppAmbiguousActionContextModules>;

export type AppAmbiguousActionContextModules = MergeObjectIntersection<
    AppActionContextModulesBase & {
        actor: AppUnknownActorContextModule;
    }
>;
