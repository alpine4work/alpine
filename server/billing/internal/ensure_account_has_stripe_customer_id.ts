import Stripe from "stripe";
import {getOurStripeCustomerId} from "~/server/accounts/get_our_stripe_customer_id.js";
import {getOwnAccount} from "~/server/accounts/get_own_account.js";
import {updateOurStripeCustomerId} from "~/server/accounts/update_our_stripe_customer_id.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {getLatestEmailAddressByAccountId} from "~/server/spaces/get_latest_email_address_by_account_id.js";
import {UnknownError} from "~/shared/error/error.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Our IDs are all seeded for development environments. This means we can't enable
 * the idempotency key on account ID to make sure we don't create multiple
 * customers. In development, we may reset our database often, so turning this on
 * helps avoid the idempotency check in stripe's sandbox.
 *
 * We should leave this off by default to match production. If you make this true,
 * please add a NO.COMMIT comment (without the .) to disable it again.
 */
const developingWithManyResets = false;

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
    const weekSinceEpoch = Math.floor(Date.now() / 1000 / 60 / 60 / 24 / 7);
    const options =
        developingWithManyResets && process.env.NODE_ENV === "development"
            ? undefined
            : // We should only ever create one customer per account, so use an idempotency key
              // to prevent duplicates. There's an edge case here where if we were to delete a
              // stripe customer, the next time this is called we would create a new one (after a
              // week has passed). This is a bit of a hack, so we should find a better solution
              // if this becomes a real case.
              {idempotencyKey: `create-customer-for-account-${account.id}-${weekSinceEpoch}`};

    try {
        stripeCustomer = await stripe.customers.create(
            {
                name: account.initialData.name,
                email,
                metadata: {
                    accountId: account.id,
                },
            },
            options,
        );
    } catch (error) {
        throw new UnknownError(`Failed to create Stripe customer`, {cause: error});
    }

    span.addData({billing: {stripeCustomerId: stripeCustomer.id, createdStripeCustomer: true}});
    await updateOurStripeCustomerId(context, stripeCustomer.id);
    return stripeCustomer.id;
}
