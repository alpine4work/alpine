import {getOurStripeCustomerId} from "~/server/accounts/get_our_stripe_customer_id.js";
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

describe("getOurStripeCustomerId()", () => {
    test("should return null when no Stripe customer ID is set", async () => {
        const session = await TestSession.create(await TestAccount.create(context));

        const result = await getOurStripeCustomerId(session.action());
        expect(result).toBe(null);
    });

    test("should return the Stripe customer ID when one is set", async () => {
        const session = await TestSession.create(await TestAccount.create(context));
        const stripeCustomerId = "cus_test123";

        await updateOurStripeCustomerId(session.action(), stripeCustomerId);

        const result = await getOurStripeCustomerId(session.action());
        expect(result).toBe(stripeCustomerId);
    });
});
