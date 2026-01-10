import {Stripe} from "stripe";
import {getOwnAccount} from "~/server/accounts/get_own_account.js";
import {BillingContextModuleBase} from "~/server/billing/billing_context_module_base.js";
import {ensureAccountHasStripeCustomerId} from "~/server/billing/internal/ensure_account_has_stripe_customer_id.js";
import {processStripeWebhook} from "~/server/billing/process_stripe_webhook.js";
import {stripeLifetimeAccessPriceId} from "~/server/billing/stripe_price_ids.js";
import {ServerSessionActionContextModules} from "~/server/context/server_action_context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {FailedPreconditionError, UnknownError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

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
     * Creates a Stripe Checkout session for purchasing lifetime access.
     * This is purposefully hardcoded to a specific price ID for simplicity.
     */
    async createLifetimeAccessCheckoutSessionUrl(
        this: BillingContextModule & ContextModuleBase<ServerSessionActionContextModules>,
        currentPathname: string,
    ): Promise<string> {
        return this._context.tracer.withSpan(
            "Create lifetime access checkout session",
            async (context, span) => {
                const [customerId, account] = await runAllPromises([
                    ensureAccountHasStripeCustomerId({
                        context,
                        stripe: this._stripe,
                        span,
                    }),
                    getOwnAccount(context, {consistency: "Strong"}),
                ]);

                if (account.initialData.plan === "LifetimeAccess") {
                    throw new FailedPreconditionError(
                        "Account has already purchased lifetime access",
                        {
                            displayMessage: errorDisplayMessage`You have already purchased lifetime access.`,
                        },
                    );
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
                        // TODO: https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/9e7qbd070bmrvsh5vqhhn6nc14
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

                return session.url;
            },
        );
    }

    async processStripeWebhook(
        this: BillingContextModule & ContextModuleBase<ServerSessionActionContextModules>,
        request: Request,
        span: TracerSpan,
    ): Promise<void> {
        return processStripeWebhook({
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
