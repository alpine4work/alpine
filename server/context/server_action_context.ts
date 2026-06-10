import {DiscoveryContextModule} from "~/server/context/discovery_context_module.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {
    AccountActorContextModule,
    ActorContextModule,
    AnonymousActorContextModule,
    AuthenticatedActorContextModule,
    BotActorContextModule,
    ImpersonatedAccountActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
    UnknownActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";

/**
 * Generic context for handling actions against our system that doesn't know which
 * actor is operating our system.
 */
export type ServerActionContextBase = Context<ServerActionContextModulesBase>;

export type ServerActionContextModulesBase = ServerProcessContextModules & {
    /**
     * Action-level caching. Cached values only live for the span of the action and are
     * not shared across actions.
     */
    cache: CacheContextModule;

    /**
     * Action-level batching. We batch at the action level so that unrelated requests
     * do not share IO.
     *
     * For example, any calls to DynamoDB's `getItem()`, `createOrReplaceItem()`, or
     * `deleteItem()` in short succession on the context are batched.
     */
    batch: BatchContextModule;

    /**
     * Optional context module our parent context provides when it wants to immediately
     * know about certain pieces of information that's only discovered deep within the
     * call stack.
     *
     * For example, to immediately figure out the `SpaceId` for a document when loading
     * the `/doc/:documentId` route once we've initially loaded the document.
     */
    discovery?: DiscoveryContextModule;
};

/**
 * Generic context for handling actions against our system.
 */
export type ServerActionContext = Context<ServerActionContextModules>;

export type ServerActionContextModules = MergeObjectIntersection<
    ServerActionContextModulesBase & {
        actor: ActorContextModule;
    }
>;

/**
 * Context for actions where we know the actor is a session actor.
 */
export type ServerSessionActionContext = Context<ServerSessionActionContextModules>;

export type ServerSessionActionContextWithEmail = Context<
    ServerSessionActionContextModules & {
        email: EmailContextModuleBase;
    }
>;

export type ServerSessionActionContextModules = MergeObjectIntersection<
    ServerActionContextModulesBase & {
        actor: SessionActorContextModule;
    }
>;

/**
 * Context for actions where we know the actor is a system actor.
 */
export type ServerSystemActionContext = Context<ServerSystemActionContextModules>;

export type ServerSystemActionContextModules = MergeObjectIntersection<
    ServerActionContextModulesBase & {
        actor: SystemActorContextModule;
    }
>;

/**
 * Context for actions from anonymous users.
 */
export type ServerAnonymousActionContext = Context<ServerAnonymousActionContextModules>;

export type ServerAnonymousActionContextModules = MergeObjectIntersection<
    ServerActionContextModulesBase & {
        actor: AnonymousActorContextModule;
    }
>;

/**
 * Context for actions where we know the actor is an impersonated account actor.
 */
export type ServerImpersonatedAccountActionContext =
    Context<ServerImpersonatedAccountActionContextModules>;

export type ServerImpersonatedAccountActionContextModules = MergeObjectIntersection<
    ServerActionContextModulesBase & {
        actor: ImpersonatedAccountActorContextModule;
    }
>;

/**
 * Context for actions by a bot in a specified scope.
 */
export type ServerBotActionContext = Context<ServerBotActionContextModules>;

export type ServerBotActionContextModules = MergeObjectIntersection<
    ServerActionContextModulesBase & {
        actor: BotActorContextModule;
    }
>;

/**
 * Context for actions where the actor might be a session actor but we need to
 * lazily authenticate to get an `DynamoActionContext`.
 */
export type ServerUnknownActionContext = Context<ServerUnknownActionContextModules>;

export type ServerUnknownActionContextModules = MergeObjectIntersection<
    ServerActionContextModulesBase & {
        actor: UnknownActorContextModule<{
            process: ProcessContextModule;
            tracer: TracerContextModule;
            cache: CacheContextModule;
            dynamo: DynamoContextModule;
        }>;
    }
>;

/**
 * Context for actions where the actor is some account. Either a session actor,
 * impersonated account actor, or bot account actor.
 */
export type ServerAccountActionContext = Context<ServerAccountActionContextModules>;

export type ServerAccountActionContextModules = MergeObjectIntersection<
    ServerActionContextModulesBase & {
        actor: AccountActorContextModule;
    }
>;

/**
 * Context for actions where the actor is expected to be authenticated and known
 * (i.e. _not_ anonymous or unknown). Either a session actor, impersonated account
 * actor, bot actor, or system actor.
 */
export type ServerAuthenticatedActionContext = Context<ServerAuthenticatedActionContextModules>;

export type ServerAuthenticatedActionContextModules = MergeObjectIntersection<
    ServerActionContextModulesBase & {
        actor: AuthenticatedActorContextModule;
    }
>;
