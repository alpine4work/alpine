import Stripe from "stripe";
import {getOurStripeCustomerId} from "~/server/accounts/get_our_stripe_customer_id.js";
import {getOwnAccount} from "~/server/accounts/get_own_account.js";
import {updateOurStripeCustomerId} from "~/server/accounts/update_our_stripe_customer_id.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {getLatestEmailAddressByAccountId} from "~/server/spaces/get_latest_email_address_by_account_id.js";
import {UnknownError} from "~/shared/error/error.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export async function ensureAccountHasStripeCustomerId({
    context,
    stripe,
    span,
}: {
    context: ServerSessionActionContext;
    stripe: Stripe;
    span: TracerSpan;
}): Promise<string> {
    const currentCustomerId = await getOurStripeCustomerId(context);
    if (currentCustomerId) {
        span.addData({billing: {stripeCustomerId: currentCustomerId}});
        return currentCustomerId;
    }

    const account = await getOwnAccount(context);
    const email = await getLatestEmailAddressByAccountId(context, account.id);

    // TODO: someday we should update the stripe customer when their name changes
    let stripeCustomer: Stripe.Response<Stripe.Customer>;
    try {
        stripeCustomer = await stripe.customers.create({
            name: account.initialData.name,
            email,
            metadata: {
                accountId: account.id,
            },
        });
    } catch (error) {
        throw new UnknownError(`Failed to create Stripe customer`, {cause: error});
    }

    span.addData({billing: {stripeCustomerId: stripeCustomer.id, createdStripeCustomer: true}});
    await updateOurStripeCustomerId(context, stripeCustomer.id);
    return stripeCustomer.id;
}
