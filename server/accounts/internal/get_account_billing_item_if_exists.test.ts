import {getAccountBillingItemIfExists} from "~/server/accounts/internal/get_account_billing_item_if_exists.js";
import {updateOurStripeCustomerId} from "~/server/accounts/update_our_stripe_customer_id.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.open_source.js";

const context = createTestContext({
    notificationsInjection: {
        notifyInboxOfTimeZoneChange: asyncNoop,
    },
});

describe("getAccountBillingItemIfExists()", () => {
    test("should return null when no billing data exists", async () => {
        const session = await TestSession.create(await TestAccount.create(context));

        const result = await getAccountBillingItemIfExists(session.action(), session.account.id);
        expect(result).toBe(null);
    });

    test("should return billing item when billing data exists", async () => {
        const session = await TestSession.create(await TestAccount.create(context));
        const stripeCustomerId = "cus_test123";

        await updateOurStripeCustomerId(session.action(), stripeCustomerId);

        const result = await getAccountBillingItemIfExists(session.action(), session.account.id);
        expect(result).not.toBe(null);
        expect(result?.stripeCustomerId).toBe(stripeCustomerId);
        expect(result?.stripePurchases).toEqual([]);
    });
});
