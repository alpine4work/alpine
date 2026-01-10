import {createSessionForTest} from "~/server/accounts/create_account_for_test.js";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {getUnstableReactionCharacterForNewAccountId} from "~/shared/reactions/get_unstable_reaction_character_for_new_account_id.js";
import {updateOurStripeCustomerId} from "~/server/accounts/update_our_stripe_customer_id.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {addSpaceAccountForTest} from "~/server/spaces/create_space_for_test.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    notificationsInjection: {
        notifyInboxOfTimeZoneChange: asyncNoop,
    },
});

describe("updateOurStripeCustomerId()", () => {
    test("should allow updating the Stripe customer ID for the current session", async () => {
        const session = await TestSession.create(await TestAccount.create(context));
        const stripeCustomerId1 = "cus_test123";

        await updateOurStripeCustomerId(session.action(), stripeCustomerId1);

        const result1 = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Billing",
            accountId: session.account.id,
        });

        expect(result1?.stripeCustomerId).toBe(stripeCustomerId1);
    });

    test("should create a new account billing item and set the Stripe customer ID if it doesn’t exist", async () => {
        const space1 = await TestSpace.create(context);
        const stripeCustomerId = "cus_test789";

        const accountId = generateId<AccountId>();
        await AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId,
            name: "Test Account",
            nameVersion: 0,
            createdTime: new Date(),
            hasInternalAccess: false,
            reactionCharacter: getUnstableReactionCharacterForNewAccountId(accountId),
        });

        const initialBillingItem = await AccountsTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "Billing",
            accountId,
        });

        expect(initialBillingItem).toBe(null);

        const sessionId = generateId<SessionId>();
        await createSessionForTest(context, {id: sessionId, accountId});
        await addSpaceAccountForTest(context, {spaceId: space1.id, accountId});

        await updateOurStripeCustomerId(
            context.action({id: sessionId, account: {id: accountId}}),
            stripeCustomerId,
        );

        const result = await AccountsTable.getItemIfExists(
            context.action({id: sessionId, account: {id: accountId}}),
            {
                partitionType: "Account",
                sortRangeType: "Billing",
                accountId,
            },
        );

        expect(result?.stripeCustomerId).toBe(stripeCustomerId);
    });

    test("should throw assertion error when customerId already exists on another account", async () => {
        const account1 = await TestAccount.create(context);
        const account2 = await TestAccount.create(context);
        const session1 = await TestSession.create(account1);
        const session2 = await TestSession.create(account2);
        const stripeCustomerId = "cus_duplicate123";

        // First account successfully sets the customer ID
        await updateOurStripeCustomerId(session1.action(), stripeCustomerId);

        // Second account tries to use the same customer ID and should get an assertion error
        await expect(
            updateOurStripeCustomerId(session2.action(), stripeCustomerId),
        ).rejects.toThrow(
            `Stripe customer ID ${stripeCustomerId} is already associated with a different account.`,
        );
    });
});
