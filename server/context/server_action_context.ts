import {
    DynamoActorContextModule,
    DynamoAnonymousActorContextModule,
    DynamoSessionActorContextModule,
    DynamoSystemActorContextModule,
    DynamoUnknownActorContextModule,
} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {DynamoBatchContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";

/**
 * Generic context for handling actions against our system that doesn't know
 * which actor is operating our system.
 */
export type ServerActionContextBase = Context<ServerActionContextModulesBase>;

export type ServerActionContextModulesBase = ServerProcessContextModules & {
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
export type ServerActionContext = Context<ServerActionContextModules>;

export type ServerActionContextModules = MergeObjectIntersection<
    ServerActionContextModulesBase & {
        actor: DynamoActorContextModule;
    }
>;

/**
 * Context for actions where we know the actor is a session actor.
 */
export type ServerSessionActionContext = Context<ServerSessionActionContextModules>;

export type ServerSessionActionContextModules = MergeObjectIntersection<
    ServerActionContextModulesBase & {
        actor: DynamoSessionActorContextModule;
    }
>;

/**
 * Context for actions where we know the actor is a system actor.
 */
export type ServerSystemActionContext = Context<ServerSystemActionContextModules>;

export type ServerSystemActionContextModules = MergeObjectIntersection<
    ServerActionContextModulesBase & {
        actor: DynamoSystemActorContextModule;
    }
>;

/**
 * Context for actions from anonymous users.
 */
export type ServerAnonymousActionContext = Context<ServerAnonymousActionContextModules>;

export type ServerAnonymousActionContextModules = MergeObjectIntersection<
    ServerActionContextModulesBase & {
        actor: DynamoAnonymousActorContextModule;
    }
>;

/**
 * Context for actions where the actor might be a session actor but we need to
 * lazily authenticate to get an `DynamoActionContext`.
 */
export type ServerUnknownActionContext = Context<ServerUnknownActionContextModules>;

export type ServerUnknownActionContextModules = MergeObjectIntersection<
    ServerActionContextModulesBase & {
        actor: DynamoUnknownActorContextModule;
    }
>;
