import {NotificationsContextModuleBase} from "~/server/dynamo/context/notifications_context_module.js";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

/**
 * Generic context for code running at the process level of our app service
 * outside of the scope of an individual request. Individual requests should
 * use an `AppActionContext`.
 */
export type AppProcessContext = Context<AppProcessContextModules>;

export type AppProcessContextModules = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    email: EmailContextModuleBase;
    notifications: NotificationsContextModuleBase;
};
