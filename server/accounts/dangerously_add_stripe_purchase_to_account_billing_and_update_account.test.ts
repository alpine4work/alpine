import {dangerouslyAddStripePurchaseToAccountBillingAndUpdateAccount} from "~/server/accounts/dangerously_add_stripe_purchase_to_account_billing_and_update_account.js";
import {getAccountBillingItemIfExists} from "~/server/accounts/internal/get_account_billing_item_if_exists.js";
import {updateOurStripeCustomerId} from "~/server/accounts/update_our_stripe_customer_id.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";

const context = createTestContext({
    notificationsInjection: {
        notifyInboxOfTimeZoneChange: asyncNoop,
    },
});

describe("dangerouslyAddStripePurchaseToAccountBillingAndUpdateAccount()", () => {
    test("should add a Stripe purchase to billing history", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        await updateOurStripeCustomerId(session.action(), "cus_test_basic");
        const priceId = "price_test123";
        const price = 99.99;
        const createdTime = new Date("2025-01-01T00:00:00Z");

        const accountBefore = await getAccount(session.action(), space.id, session.account.id);
        expect(accountBefore.initialData.plan).toBe(undefined);

        await dangerouslyAddStripePurchaseToAccountBillingAndUpdateAccount(
            session.action(),
            session.account.id,
            {
                priceId,
                price,
                createdTime,
                accountPlan: "LifetimeAccess",
            },
        );

        const billingItem = await getAccountBillingItemIfExists(
            session.action(),
            session.account.id,
        );
        expect(billingItem?.stripePurchases).toHaveLength(1);
        expect(billingItem?.stripePurchases[0]).toEqual({
            priceId,
            price,
            createdTime,
        });

        const accountAfter = await getAccount(session.action(), space.id, session.account.id);
        expect(accountAfter.initialData.plan).toBe("LifetimeAccess");
    });

    test("should add multiple purchases to billing history", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        await updateOurStripeCustomerId(session.action(), "cus_test_multiple");
        const priceId1 = "price_test123";
        const price1 = 99.99;
        const createdTime1 = new Date("2025-01-01T00:00:00Z");
        const priceId2 = "price_test456";
        const price2 = 149.99;
        const createdTime2 = new Date("2025-01-02T00:00:00Z");

        const accountBefore = await getAccount(session.action(), space.id, session.account.id);
        expect(accountBefore.initialData.plan).toBe(undefined);

        await dangerouslyAddStripePurchaseToAccountBillingAndUpdateAccount(
            session.action(),
            session.account.id,
            {
                priceId: priceId1,
                price: price1,
                createdTime: createdTime1,
                accountPlan: "LifetimeAccess",
            },
        );
        await dangerouslyAddStripePurchaseToAccountBillingAndUpdateAccount(
            session.action(),
            session.account.id,
            {
                priceId: priceId2,
                price: price2,
                createdTime: createdTime2,
                accountPlan: "LifetimeAccess",
            },
        );

        const billingItem = await getAccountBillingItemIfExists(
            session.action(),
            session.account.id,
        );
        expect(billingItem?.stripePurchases).toHaveLength(2);
        expect(billingItem?.stripePurchases).toContainEqual({
            priceId: priceId1,
            price: price1,
            createdTime: createdTime1,
        });
        expect(billingItem?.stripePurchases).toContainEqual({
            priceId: priceId2,
            price: price2,
            createdTime: createdTime2,
        });

        const accountAfter = await getAccount(session.action(), space.id, session.account.id);
        expect(accountAfter.initialData.plan).toBe("LifetimeAccess");
    });

    test("should not add duplicate purchases", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        await updateOurStripeCustomerId(session.action(), "cus_test_duplicate");
        const priceId = "price_test123";
        const price = 99.99;
        const createdTime = new Date("2025-01-01T00:00:00Z");

        const accountBefore = await getAccount(session.action(), space.id, session.account.id);
        expect(accountBefore.initialData.plan).toBe(undefined);

        await dangerouslyAddStripePurchaseToAccountBillingAndUpdateAccount(
            session.action(),
            session.account.id,
            {
                priceId,
                price,
                createdTime,
                accountPlan: "LifetimeAccess",
            },
        );
        await dangerouslyAddStripePurchaseToAccountBillingAndUpdateAccount(
            session.action(),
            session.account.id,
            {
                priceId,
                price,
                createdTime,
                accountPlan: "LifetimeAccess",
            },
        );

        const billingItem = await getAccountBillingItemIfExists(
            session.action(),
            session.account.id,
        );
        expect(billingItem?.stripePurchases).toHaveLength(1);
        expect(billingItem?.stripePurchases[0]).toEqual({
            priceId,
            price,
            createdTime,
        });

        const accountAfter = await getAccount(session.action(), space.id, session.account.id);
        expect(accountAfter.initialData.plan).toBe("LifetimeAccess");
    });

    test("should update account plan to LifetimeAccess for lifetime access purchase", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        await updateOurStripeCustomerId(session.action(), "cus_test_lifetime");
        const price = 199.99;
        const priceId = "price_test123";
        const createdTime = new Date("2025-01-01T00:00:00Z");

        const accountBefore = await getAccount(session.action(), space.id, session.account.id);
        expect(accountBefore.initialData.plan).toBe(undefined);

        await dangerouslyAddStripePurchaseToAccountBillingAndUpdateAccount(
            session.action(),
            session.account.id,
            {
                priceId,
                price,
                createdTime,
                accountPlan: "LifetimeAccess",
            },
        );

        const accountAfter = await getAccount(session.action(), space.id, session.account.id);
        expect(accountAfter.initialData.plan).toBe("LifetimeAccess");

        const billingItem = await getAccountBillingItemIfExists(
            session.action(),
            session.account.id,
        );
        expect(billingItem?.stripePurchases).toHaveLength(1);
        expect(billingItem?.stripePurchases[0]).toEqual({
            priceId,
            price,
            createdTime,
        });
    });
});
