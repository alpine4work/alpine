import {
    AuthenticatedAuthContextModule,
    AuthenticatedSessionAuthContextModule,
    UnauthenticatedSessionAuthContextModule,
} from "~/server/dynamo/context/auth_context_module";
import {ProcessContextModules} from "~/server/dynamo/context/process_context";
import {SystemContextModule} from "~/server/dynamo/context/system_context_module";
import {CacheContextModule} from "~/shared/context/cache_context_module";
import {Context} from "~/shared/context/context";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";

type RequestContextModulesBase = ProcessContextModules & {
    /**
     * Request-level caching. Cached values only live for the span of the request.
     */
    cache: CacheContextModule;
};

/**
 * A context with only the base modules of a request context. Does not contain
 * authentication information.
 */
export type RequestContextBase = Context<RequestContextModulesBase>;

/**
 * Generic context for handling authenticated requests.
 *
 * In practice this is either a `SessionRequestContext` or a context generated
 * from `SystemRequestContext` to impersonate a specific user.
 */
export type RequestContext = Context<RequestContextModules>;

export type RequestContextModules = MergeObjectIntersection<
    RequestContextModulesBase & {
        auth: AuthenticatedAuthContextModule;
    }
>;

/**
 * Generic context for handling authenticated requests with a
 * corresponding session.
 */
export type SessionRequestContext = Context<SessionRequestContextModules>;

export type SessionRequestContextModules = MergeObjectIntersection<
    RequestContextModulesBase & {
        auth: AuthenticatedSessionAuthContextModule;
    }
>;

/**
 * Generic context for handling unauthenticated requests with an
 * associated session.
 */
export type UnauthenticatedSessionRequestContext =
    Context<UnauthenticatedSessionRequestContextModules>;

export type UnauthenticatedSessionRequestContextModules = MergeObjectIntersection<
    RequestContextModulesBase & {
        auth: UnauthenticatedSessionAuthContextModule;
    }
>;

/**
 * Generic context for a request that is not associated with any actor but is
 * instead some background system action.
 *
 * For example, when we process items from a queue we use a system request
 * context.
 */
export type SystemRequestContext = Context<SystemRequestContextModules>;

export type SystemRequestContextModules = Omit<
    RequestContextModulesBase,
    // Do not include a cache at the system request level! When the system context
    // impersonates accounts we do not want to share a cache across accounts.
    "cache"
> & {
    system: SystemContextModule;
};
