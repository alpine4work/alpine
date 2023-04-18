import {
    AuthenticatedAuthContextModule,
    AuthenticatedSessionAuthContextModule,
    UnauthenticatedSessionAuthContextModule,
} from "~/server/dynamo/context/auth_context_module";
import {ProcessContextModules} from "~/server/dynamo/context/process_context";
import {CacheContextModule} from "~/shared/context/cache_context_module";
import {Context} from "~/shared/context/context";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";

/**
 * Generic context for handling requests with unknown authentication state.
 */
export type RequestContextBase = Context<RequestContextModulesBase>;

type RequestContextModulesBase = ProcessContextModules & {
    /**
     * Request-level caching. Cached values only live for the span of the request.
     */
    cache: CacheContextModule;
};

/**
 * Generic context for handling authenticated requests.
 *
 * This could be either:
 *
 * - A session authenticated request
 * - A system impersonated request on behalf of an account
 */
export type RequestContext = Context<RequestContextModules>;

export type RequestContextModules = MergeObjectIntersection<
    RequestContextModulesBase & {
        auth: AuthenticatedAuthContextModule;
    }
>;

/**
 * Context for handling authenticated requests when the authenticated request
 * comes from the request including a session.
 */
export type SessionRequestContext = Context<SessionRequestContextModules>;

export type SessionRequestContextModules = MergeObjectIntersection<
    RequestContextModulesBase & {
        auth: AuthenticatedSessionAuthContextModule;
    }
>;

/**
 * Generic context for handling unauthenticated requests but the request may
 * have a session so we can upgrade to an authenticated context.
 */
export type UnauthenticatedSessionRequestContext =
    Context<UnauthenticatedSessionRequestContextModules>;

export type UnauthenticatedSessionRequestContextModules = MergeObjectIntersection<
    RequestContextModulesBase & {
        auth: UnauthenticatedSessionAuthContextModule;
    }
>;
