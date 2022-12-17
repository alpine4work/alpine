import {
    AuthContextModule,
    AuthenticatedAuthContextModule,
} from "~/server/context/auth_context_module";
import {AwsContextModule} from "~/server/context/aws_context_module";
import {Context} from "~/server/context/context";
import {ProcessContextModule} from "~/server/context/process_context_module";

/**
 * Generic context for handling authenticated requests.
 */
export type RequestContext = Context<RequestContextModules>;

export type RequestContextModules = {
    process: ProcessContextModule;
    aws: AwsContextModule;
    auth: AuthenticatedAuthContextModule<RequestContextModules>;
};

/**
 * Generic context for handling unauthenticated requests.
 */
export type UnauthenticatedRequestContext = Context<UnauthenticatedRequestContextModules>;

export type UnauthenticatedRequestContextModules = {
    process: ProcessContextModule;
    aws: AwsContextModule;
    auth: AuthContextModule<UnauthenticatedRequestContextModules>;
};
