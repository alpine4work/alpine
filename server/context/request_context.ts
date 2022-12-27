import {
    AuthenticatedAuthContextModule,
    UnauthenticatedAuthContextModule,
} from "~/server/context/auth_context_module";
import {ProcessContextModules} from "~/server/context/process_context";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module";
import {Context} from "~/shared/context/context";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";

/**
 * Generic context for handling authenticated requests.
 */
export type RequestContext = Context<RequestContextModules>;

export type RequestContextModules = MergeObjectIntersection<
    ProcessContextModules & {
        auth: AuthenticatedAuthContextModule;
        rpc: LocalRpcContextModule;
    }
>;

/**
 * Generic context for handling unauthenticated requests.
 */
export type UnauthenticatedRequestContext = Context<UnauthenticatedRequestContextModules>;

export type UnauthenticatedRequestContextModules = MergeObjectIntersection<
    ProcessContextModules & {
        auth: UnauthenticatedAuthContextModule;
        rpc: LocalRpcContextModule;
    }
>;
