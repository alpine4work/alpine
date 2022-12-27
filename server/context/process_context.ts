import {createAwsClientFromEnv} from "~/server/aws/create_aws_client_from_env";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module";
import {SesEmailContextModule} from "~/server/emails/ses_email_context_module";
import {WebSocketServerProcessContextModules} from "~/server/helpers/web_socket_server";
import {Context} from "~/shared/context/context";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {TracerRoot} from "~/shared/tracer/tracer_root";

/**
 * Generic context for code running at the process level outside of the scope
 * of an individual request. Individual requests should use a `RequestContext`.
 */
export type ProcessContext = Context<WebSocketServerProcessContextModules>;

export type ProcessContextModules = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    email: EmailContextModuleBase;
};
