import {createSessionForTest} from "~/server/accounts/create_account_for_test.js";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {pickRandomReactionCharacterForAccount} from "~/server/accounts/pick_random_reaction_character_for_account.js";
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
            reactionCharacter: pickRandomReactionCharacterForAccount(),
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
});
