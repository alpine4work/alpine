import {getAccountIdForStripeCustomerIdWithoutAuthorization} from "~/server/accounts/get_account_id_for_stripe_customer_id_without_authorization.js";
import {updateOurStripeCustomerId} from "~/server/accounts/update_our_stripe_customer_id.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";

const context = createTestContext({
    notificationsInjection: {
        notifyInboxOfTimeZoneChange: asyncNoop,
    },
});

describe("getAccountIdForStripeCustomerId()", () => {
    test("should return null when no account has the Stripe customer ID", async () => {
        const result = await getAccountIdForStripeCustomerIdWithoutAuthorization(
            context,
            "cus_nonexistent",
        );
        expect(result).toBe(null);
    });

    test("should return the account ID when an account has the Stripe customer ID", async () => {
        const session = await TestSession.create(await TestAccount.create(context));
        const stripeCustomerId = "cus_test123";

        await updateOurStripeCustomerId(session.action(), stripeCustomerId);

        const result = await getAccountIdForStripeCustomerIdWithoutAuthorization(
            context,
            stripeCustomerId,
        );
        expect(result).toBe(session.account.id);
    });

    test("should work with multiple accounts", async () => {
        const session1 = await TestSession.create(await TestAccount.create(context));
        const session2 = await TestSession.create(await TestAccount.create(context));
        const stripeCustomerId1 = "cus_test123_unique";
        const stripeCustomerId2 = "cus_test456_unique";

        await updateOurStripeCustomerId(session1.action(), stripeCustomerId1);
        await updateOurStripeCustomerId(session2.action(), stripeCustomerId2);

        const result1 = await getAccountIdForStripeCustomerIdWithoutAuthorization(
            context,
            stripeCustomerId1,
        );
        const result2 = await getAccountIdForStripeCustomerIdWithoutAuthorization(
            context,
            stripeCustomerId2,
        );

        expect(result1).toBe(session1.account.id);
        expect(result2).toBe(session2.account.id);
    });
});
