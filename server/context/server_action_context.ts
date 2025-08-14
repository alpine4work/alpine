import {
    DynamoActorContextModule,
    DynamoAnonymousActorContextModule,
    DynamoImpersonatedAccountActorContextModule,
    DynamoSessionActorContextModule,
    DynamoSystemActorContextModule,
    DynamoUnknownActorContextModule,
} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
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
     * Action-level batching. We batch at the action level so that unrelated
     * requests do not share IO.
     *
     * For example, any calls to DynamoDB's `getItem()`, `createOrReplaceItem()`,
     * or `deleteItem()` in short succession on the context are batched.
     */
    batch: BatchContextModule;
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

export type ServerSessionActionWithEmailContext = Context<
    ServerSessionActionContextModules & {
        email: EmailContextModuleBase;
    }
>;

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
 * Context for actions where we know the actor is an impersonated account
 * actor.
 */
export type ServerImpersonatedAccountActionContext =
    Context<ServerImpersonatedAccountActionContextModules>;

export type ServerImpersonatedAccountActionContextModules = MergeObjectIntersection<
    ServerActionContextModulesBase & {
        actor: DynamoImpersonatedAccountActorContextModule;
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
