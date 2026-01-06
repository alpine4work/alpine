import {createSessionForTest} from "~/server/accounts/create_account_for_test.js";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {pickRandomReactionCharacterForAccount} from "~/server/accounts/pick_random_reaction_character_for_account.js";
import {updateOurAccountObservedTimeZone} from "~/server/accounts/with_spaces/update_our_account_observed_time_zone.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {addSpaceAccountForTest} from "~/server/spaces/create_space_for_test.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {TimeZone, assertTimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    notificationsInjection: {
        notifyInboxOfTimeZoneChange: asyncNoop,
    },
});

test("should allow updating the observedTimeZone for the current session", async () => {
    const account = await TestAccount.create(context);
    const session = await TestSession.create(account);

    const initialItem = await AccountsTable.getItemIfExists(session.action(), {
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId: session.account.id,
    });

    expect(initialItem?.observedTimeZone).toBe(defaultTimeZone);

    await updateOurAccountObservedTimeZone(session.action(), assertTimeZone("America/Los_Angeles"));

    const result = await AccountsTable.getItemIfExists(session.action(), {
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId: session.account.id,
    });
    expect(result?.observedTimeZone).toBe("America/Los_Angeles");
});

test("does not allow updating the observedTimeZone to an invalid time zone", async () => {
    const session = await TestSession.create(await TestAccount.create(context));

    await expect(
        updateOurAccountObservedTimeZone(session.action(), "Invalid/Time/Zone" as TimeZone),
    ).rejects.toThrow(InvalidArgumentError);
});

test("should create a new account settings item and set the observedTimeZone if it doesn’t exist", async () => {
    const space1 = await TestSpace.create(context);

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

    const initialSettingsItem = await AccountsTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId,
    });

    expect(initialSettingsItem).toBe(null);

    const sessionId = generateId<SessionId>();
    await createSessionForTest(context, {id: sessionId, accountId});

    await addSpaceAccountForTest(context, {spaceId: space1.id, accountId});

    await updateOurAccountObservedTimeZone(
        context.action({id: sessionId, account: {id: accountId}}),
        assertTimeZone("America/Los_Angeles"),
    );

    const result1 = await AccountsTable.getItemIfExists(
        context.action({id: sessionId, account: {id: accountId}}),
        {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId,
        },
    );
    expect(result1?.observedTimeZone).toBe("America/Los_Angeles");
});
