import {Stripe} from "stripe";
import {BillingContextModuleBase} from "~/server/billing/billing_context_module_base.js";
import {ensureAccountHasStripeCustomerId} from "~/server/billing/internal/ensure_account_has_stripe_customer_id.js";
import {stripeLifetimeAccessPriceId} from "~/server/billing/stripe_price_ids.js";
import {ServerSessionActionContextModules} from "~/server/context/server_action_context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {UnknownError} from "~/shared/error/error.js";

/**
 * Context module for billing operations using Stripe.
 */
export class BillingContextModule extends BillingContextModuleBase {
    private readonly _stripe: Stripe;

    constructor({stripe}: {stripe: Stripe}) {
        super();
        this._stripe = stripe;
    }

    /**
     * Creates a Stripe Checkout session for purchasing lifetime access.
     * This is purposefully hardcoded to a specific price ID for simplicity.
     */
    async createLifetimeAccessCheckoutSessionUrl(
        this: BillingContextModule & ContextModuleBase<ServerSessionActionContextModules>,
    ): Promise<string> {
        return this._context.tracer.withSpan(
            "Create lifetime access checkout session",
            async (context, span) => {
                const customerId: string = await ensureAccountHasStripeCustomerId({
                    context,
                    stripe: this._stripe,
                    span,
                });

                let session: Stripe.Response<Stripe.Checkout.Session>;
                try {
                    session = await this._stripe.checkout.sessions.create({
                        customer: customerId,
                        line_items: [
                            {
                                price: stripeLifetimeAccessPriceId,
                                quantity: 1,
                            },
                        ],
                        mode: "payment",
                        // TODO: https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/9e7qbd070bmrvsh5vqhhn6nc14
                        success_url: `${context.constants.edgeServiceUrl}/TODO`,
                        cancel_url: `${context.constants.edgeServiceUrl}/TODO`,
                    });
                } catch (error) {
                    throw new UnknownError(`Failed to create Stripe Checkout session`, {
                        cause: error,
                    });
                }

                if (!session.url) {
                    throw new UnknownError(`Stripe Checkout session URL is missing`);
                }

                return session.url;
            },
        );
    }

    fork(): BillingContextModuleBase {
        return new BillingContextModule({stripe: this._stripe});
    }
}
