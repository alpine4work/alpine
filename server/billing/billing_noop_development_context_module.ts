import {BillingContextModuleBase} from "~/server/billing/billing_context_module_base.js";
import {ServerSessionActionContextModules} from "~/server/context/server_action_context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * No-op billing context module for development environments. This module is used
 * when no environment variables are set for Stripe.
 */
export class BillingNoopDevelopmentContextModule extends BillingContextModuleBase {
    constructor() {
        super();
        assert(
            process.env.NODE_ENV !== "production",
            "BillingNoopDevelopmentContextModule should not be used in production",
        );
    }

    async createLifetimeAccessCheckoutSessionUrl(
        this: BillingNoopDevelopmentContextModule &
            ContextModuleBase<ServerSessionActionContextModules>,
    ): Promise<{ok: true; url: string} | {ok: false; reason: "AlreadyPurchased"; message: string}> {
        return {
            ok: true,
            url: `${this._context.constants.edgeServiceUrl}/#noop-checkout-session`,
        };
    }

    async processStripeWebhook(): Promise<void> {
        // No-op
    }

    fork(): BillingContextModuleBase {
        return new BillingNoopDevelopmentContextModule();
    }
}
