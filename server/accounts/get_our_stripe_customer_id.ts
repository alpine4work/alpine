import {getAccountBillingItemIfExists} from "~/server/accounts/internal/get_account_billing_item_if_exists.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";

/**
 * Get the Stripe customer ID for our account. May or may not exist
 * if the account has not set up billing.
 */
export async function getOurStripeCustomerId(context: ServerActionContext): Promise<string | null> {
    const authorizedContext = context.actor.authorizeSession();
    const accountBillingItem = await getAccountBillingItemIfExists(
        authorizedContext,
        authorizedContext.actor.getAccountId(),
        {consistency: "Strong"},
    );

    return accountBillingItem?.stripeCustomerId || null;
}
