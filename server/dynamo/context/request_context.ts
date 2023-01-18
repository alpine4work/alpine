import {
    AuthenticatedAuthContextModule,
    UnauthenticatedAuthContextModule,
} from "~/server/dynamo/context/auth_context_module";
import {ProcessContextModules} from "~/server/dynamo/context/process_context";
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
 * Generic context for handling authenticated requests.
 */
export type RequestContext = Context<RequestContextModules>;

export type RequestContextModules = MergeObjectIntersection<
    RequestContextModulesBase & {
        auth: AuthenticatedAuthContextModule;
    }
>;

/**
 * Generic context for handling unauthenticated requests.
 */
export type UnauthenticatedRequestContext = Context<UnauthenticatedRequestContextModules>;

export type UnauthenticatedRequestContextModules = MergeObjectIntersection<
    RequestContextModulesBase & {
        auth: UnauthenticatedAuthContextModule;
    }
>;
