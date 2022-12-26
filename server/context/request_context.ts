import {
    UnauthenticatedAuthContextModule,
    AuthenticatedAuthContextModule,
} from "~/server/context/auth_context_module";
import {AwsContextModule} from "~/server/context/aws_context_module";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module";
import {Context} from "~/shared/context/context";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";

/**
 * Generic context for handling authenticated requests.
 */
export type RequestContext = Context<RequestContextModules>;

export type RequestContextModules = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
    aws: AwsContextModule;
    auth: AuthenticatedAuthContextModule;
    rpc: LocalRpcContextModule;
};

/**
 * Generic context for handling unauthenticated requests.
 */
export type UnauthenticatedRequestContext = Context<UnauthenticatedRequestContextModules>;

export type UnauthenticatedRequestContextModules = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
    aws: AwsContextModule;
    auth: UnauthenticatedAuthContextModule;
    rpc: LocalRpcContextModule;
};
