import {BillingContextModuleBase} from "~/server/billing/billing_context_module_base.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * No-op billing context module for development environments.
 * This module is used when no environment variables are set for Stripe.
 */
export class BillingNoopDevelopmentContextModule extends BillingContextModuleBase {
    constructor() {
        super();
        assert(
            process.env.NODE_ENV !== "production",
            "BillingNoopDevelopmentContextModule should not be used in production",
        );
    }

    fork(): BillingContextModuleBase {
        return new BillingNoopDevelopmentContextModule();
    }
}
