import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base";
import {Context} from "~/shared/context/context";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";

/**
 * Generic context for code running at the process level outside of the scope
 * of an individual request. Individual requests should use a `RequestContext`.
 */
export type ProcessContext = Context<ProcessContextModules>;

export type ProcessContextModules = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    email: EmailContextModuleBase;
};
