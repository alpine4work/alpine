import {Stripe} from "stripe";
import {getOwnAccountWithoutSpace} from "~/server/accounts/get_own_account_without_space.js";
import {BillingContextModuleBase} from "~/server/billing/billing_context_module_base.js";
import {ensureAccountHasStripeCustomerId} from "~/server/billing/internal/ensure_account_has_stripe_customer_id.js";
import {processStripeWebhook} from "~/server/billing/process_stripe_webhook.js";
import {stripeLifetimeAccessPriceId} from "~/server/billing/stripe_price_ids.js";
import {ServerSessionActionContextModules} from "~/server/context/server_action_context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {UnknownError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

/**
 * Context module for billing operations using Stripe.
 */
export class BillingContextModule extends BillingContextModuleBase {
    private readonly _agentServiceUrl: string;
    private readonly _stripe: Stripe;
    private readonly _stripeSigningSecret: string | undefined;

    constructor({
        agentServiceUrl,
        stripe,
        stripeSigningSecret,
    }: {
        agentServiceUrl: string;
        stripe: Stripe;
        stripeSigningSecret?: string;
    }) {
        super();
        this._agentServiceUrl = agentServiceUrl;
        this._stripe = stripe;
        this._stripeSigningSecret = stripeSigningSecret;
    }

    /**
     * Creates a Stripe Checkout session for purchasing lifetime access. This is
     * purposefully hardcoded to a specific price ID for simplicity.
     */
    async createLifetimeAccessCheckoutSessionUrl(
        this: BillingContextModule & ContextModuleBase<ServerSessionActionContextModules>,
        currentPathname: string,
    ): Promise<{ok: true; url: string} | {ok: false; reason: "AlreadyPurchased"; message: string}> {
        return await this._context.tracer.withSpan(
            "Create lifetime access checkout session",
            async (context, span) => {
                const [customerId, account] = await runAllPromises([
                    ensureAccountHasStripeCustomerId({
                        context,
                        stripe: this._stripe,
                        span,
                    }),
                    getOwnAccountWithoutSpace(context, {consistency: "Strong"}),
                ]);

                if (account.initialData.plan === "LifetimeAccess") {
                    return {
                        ok: false,
                        reason: "AlreadyPurchased",
                        message: "You\u2019ve already purchased lifetime access.",
                    };
                }

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
                        success_url: `${context.constants.edgeServiceUrl}${currentPathname}?purchased=lifetime-access`,
                        cancel_url: `${context.constants.edgeServiceUrl}${currentPathname}`,
                    });
                } catch (error) {
                    throw new UnknownError(`Failed to create Stripe Checkout session`, {
                        cause: error,
                    });
                }

                if (!session.url) {
                    throw new UnknownError(`Stripe Checkout session URL is missing`);
                }

                return {ok: true, url: session.url};
            },
        );
    }

    async processStripeWebhook(
        this: BillingContextModule & ContextModuleBase<ServerSessionActionContextModules>,
        request: Request,
        span: TracerSpan,
    ): Promise<void> {
        return await processStripeWebhook({
            context: this._context,
            request,
            stripe: this._stripe,
            span,
            stripeSigningSecret: assertExists(this._stripeSigningSecret),
            agentServiceUrl: this._agentServiceUrl,
        });
    }

    fork(): BillingContextModuleBase {
        return new BillingContextModule({
            agentServiceUrl: this._agentServiceUrl,
            stripe: this._stripe,
            stripeSigningSecret: this._stripeSigningSecret,
        });
    }
}
