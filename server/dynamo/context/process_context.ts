import {NotificationsContextModuleBase} from "~/server/dynamo/context/notifications_context_module";
import {EmptySystemContextModule} from "~/server/dynamo/context/system_context_module";
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

export type ProcessContextModulesBase = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    email: EmailContextModuleBase;
    notifications: NotificationsContextModuleBase;
};

export type ProcessContextModules = ProcessContextModulesBase & {
    /**
     * Process contexts must contain an empty system context module. This stops you
     * from doing `context.clone({system: new DangerousSystemContextModule()})`
     * anywhere except the root of your code where you construct the process
     * module. Calling
     * `context.clone({system: new DangerousSystemContextModule()})` escalates
     * permissions.
     *
     * It's especially important that you can't escalate privileges in this way
     * from a `RequestContext`. Again, system access should be carefully controlled
     * starting from the top-level of your service's code.
     */
    system: EmptySystemContextModule;
};
