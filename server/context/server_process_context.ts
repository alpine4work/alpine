import {EdgeServiceContextModuleBase} from "~/server/context/edge_service_context_module.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {JobsContextModuleWithoutAuthorization} from "~/server/jobs/core/jobs_context_module_without_authorization.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

/**
 * Generic context for code running at the process level of our app service
 * outside of the scope of an individual request. Individual requests should
 * use a `ServerActionContext`.
 */
export type ServerProcessContext = Context<ServerProcessContextModules>;

export type ServerProcessContextModules = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    email: EmailContextModuleBase;
    opensearch: OpensearchContextModule;
    jobs: JobsContextModuleWithoutAuthorization;
    edge: EdgeServiceContextModuleBase;
};
