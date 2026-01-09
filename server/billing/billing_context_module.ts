import {Stripe} from "stripe";
import {BillingContextModuleBase} from "~/server/billing/billing_context_module_base.js";

/**
 * Context module for billing operations using Stripe.
 */
export class BillingContextModule extends BillingContextModuleBase {
    private readonly _stripe: Stripe;

    constructor({stripe}: {stripe: Stripe}) {
        super();
        this._stripe = stripe;
    }

    fork(): BillingContextModuleBase {
        return new BillingContextModule({stripe: this._stripe});
    }
}
