import Stripe from "stripe";
import {dangerouslyAddStripePurchaseToAccountBillingAndUpdateAccount} from "~/server/accounts/dangerously_add_stripe_purchase_to_account_billing_and_update_account.js";
import {getAccountIdForStripeCustomerId} from "~/server/accounts/get_account_id_for_stripe_customer_id.js";
import {stripeLifetimeAccessPriceId} from "~/server/billing/stripe_price_ids.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {Context} from "~/shared/context/context.js";
import {DataLossError, FailedPreconditionError, UnknownError} from "~/shared/error/error.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

async function processCheckoutSessionCompletedEvent(
    context: Context<DynamoContextModules>,
    stripe: Stripe,
    event: Stripe.CheckoutSessionCompletedEvent,
    span: TracerSpan,
): Promise<void> {
    if (!event.data.object.customer) {
        throw new FailedPreconditionError("Stripe event is missing customer");
    }

    if (!event.data.object.payment_intent) {
        throw new FailedPreconditionError("Stripe event is missing payment_intent");
    }

    const customerId =
        typeof event.data.object.customer === "string"
            ? event.data.object.customer
            : event.data.object.customer.id;

    // Fetch the full checkout session to get line items
    const checkoutSessionId = event.data.object.id;
    let checkoutSession: Stripe.Checkout.Session;
    try {
        checkoutSession = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
            expand: ["line_items"],
        });
    } catch (error) {
        throw new UnknownError("Failed to retrieve Stripe checkout session", {cause: error});
    }

    const lifetimeAccessPurchase = checkoutSession.line_items?.data.find(
        item => item.price?.id === stripeLifetimeAccessPriceId,
    );

    span.addData({
        billing: {
            stripeEvent: {
                dollarAmount:
                    (checkoutSession.line_items?.data ?? []).reduce((total, item) => {
                        const amount = item.price?.unit_amount ?? 0;
                        const quantity = item.quantity ?? 1;
                        return total + amount * quantity;
                    }, 0) / 100, // convert cents to dollars
            },
        },
    });

    if (!lifetimeAccessPurchase) {
        // We only handle lifetime access purchases for now, so this is an unknown purchase.
        return;
    }

    const accountId = await getAccountIdForStripeCustomerId(context, customerId, {
        consistency: "Strong",
    });
    if (!accountId) {
        throw new DataLossError("No account found for Stripe customer ID", {
            cause: {customerId},
        });
    }

    span.addData({
        context: {accountId},
        billing: {stripeEvent: {processed: true}},
    });

    await dangerouslyAddStripePurchaseToAccountBillingAndUpdateAccount(context, accountId, {
        priceId: stripeLifetimeAccessPriceId,
        price: (lifetimeAccessPurchase.price?.unit_amount ?? 0) / 100,
        createdTime: new Date(event.data.object.created * 1000),
        accountPlan: "LifetimeAccess",
    });
}

/**
 * Handles an incoming Stripe webhook request.
 * https://docs.stripe.com/webhooks
 */
export async function processStripeWebhook(
    context: Context<DynamoContextModules>,
    request: Request,
    stripe: Stripe,
    span: TracerSpan,
    stripeSigningSecret: string,
): Promise<void> {
    const givenSigningSecret = request.headers.get("stripe-signature");
    if (!givenSigningSecret) {
        throw new FailedPreconditionError("Missing stripe-signature header");
    }

    if (!request.body) {
        throw new FailedPreconditionError("Missing request body");
    }

    const body = await request.text();

    // Construct the Stripe event and signature verification
    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(body, givenSigningSecret, stripeSigningSecret);
    } catch (error) {
        throw new FailedPreconditionError("Invalid Stripe webhook signature", {cause: error});
    }

    span.addData({billing: {stripeEvent: {type: event.type, id: event.id}}});

    const customerId =
        "customer" in event.data.object && event.data.object.customer
            ? typeof event.data.object.customer === "string"
                ? event.data.object.customer
                : event.data.object.customer.id
            : undefined;

    if (customerId) {
        // Always log our customerId if we have it so we can trace any
        // event back to a user, whether or not we handle it.
        span.addData({billing: {stripeCustomerId: customerId}});
    }

    if (event.type === "checkout.session.completed") {
        await processCheckoutSessionCompletedEvent(context, stripe, event, span);
    }

    // TODO: handle refunds - `refund.created` ?
    //   https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/3jvm0abv9qkcnxecszd6vsn2qc
}
