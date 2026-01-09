import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Base context module for billing operations.
 */
export abstract class BillingContextModuleBase<
    Modules extends {
        tracer: TracerContextModule;
    } = {
        tracer: TracerContextModule;
    },
> extends ContextModuleBase<Modules> {
    abstract createLifetimeAccessCheckoutSessionUrl(currentPathname: string): Promise<string>;
    abstract processStripeWebhook(request: Request, span: TracerSpan): Promise<void>;
    abstract fork(): ForkableContextModuleBase;
}
