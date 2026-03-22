import {createSessionForTest} from "~/server/accounts/create_account_for_test.js";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {updateOurAccountSettings} from "~/server/accounts/update_our_account_settings.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {addSpaceAccountForTest} from "~/server/spaces/create_space_for_test.js";
import {removeSpaceAccount} from "~/server/spaces/remove_space_account.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {assertTimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.js";
import {getUnstableReactionCharacterForNewAccountId} from "~/shared/reactions/get_unstable_reaction_character_for_new_account_id.js";

const context = createTestContext({
    notificationsInjection: {
        notifyInboxOfTimeZoneChange: asyncNoop,
    },
});

describe("UpdateLastOpenedSpaceId", () => {
    test("should allow updating the lastOpenedSpaceId for the current session", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);

        const session = await space1.createSession();
        await space2.addAccount(session);

        await updateOurAccountSettings(session.action(), {
            type: "UpdateLastOpenedSpaceId",
            spaceId: space1.id,
        });

        const result1 = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });
        expect(result1?.lastOpenedSpaceId).toBe(space1.id);

        await updateOurAccountSettings(session.action(), {
            type: "UpdateLastOpenedSpaceId",
            spaceId: space2.id,
        });

        const result2 = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });
        expect(result2?.lastOpenedSpaceId).toBe(space2.id);
    });

    test("allows updating the lastOpenedSpaceId to a space the session is not a member of", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);

        const session = await space1.createSession();

        await updateOurAccountSettings(session.action(), {
            type: "UpdateLastOpenedSpaceId",
            spaceId: space2.id,
        });

        const result = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });
        expect(result?.lastOpenedSpaceId).toBe(space2.id);
    });

    test("allows updating the lastOpenedSpaceId to a space the session is invited to", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});

        const session = await space1.createSession();
        const email = await session.account.createEmailAddress();

        await space2OwnerSession.inviteEmailAddress(email);

        await updateOurAccountSettings(session.action(), {
            type: "UpdateLastOpenedSpaceId",
            spaceId: space2.id,
        });

        const result = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });
        expect(result?.lastOpenedSpaceId).toBe(space2.id);
    });

    test("allows updating the lastOpenedSpaceId to a space the session is removed from", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});

        const session = await space1.createSession();
        await space2.addAccount(session);

        await removeSpaceAccount(space2OwnerSession.action(), {
            spaceId: space2.id,
            accountId: session.account.id,
        });

        await updateOurAccountSettings(session.action(), {
            type: "UpdateLastOpenedSpaceId",
            spaceId: space2.id,
        });

        const result = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });
        expect(result?.lastOpenedSpaceId).toBe(space2.id);
    });

    test("should create a new account settings item and set the lastOpenedSpaceId if it doesn\u2019t exist", async () => {
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
            reactionCharacter: getUnstableReactionCharacterForNewAccountId(accountId),
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

        await updateOurAccountSettings(context.action({id: sessionId, account: {id: accountId}}), {
            type: "UpdateLastOpenedSpaceId",
            spaceId: space1.id,
        });

        const result1 = await AccountsTable.getItemIfExists(
            context.action({id: sessionId, account: {id: accountId}}),
            {
                partitionType: "Account",
                sortRangeType: "Settings",
                accountId,
            },
        );
        expect(result1?.lastOpenedSpaceId).toBe(space1.id);
    });
});

describe("UpdateObservedTimeZone", () => {
    test("should allow updating the observedTimeZone for the current session", async () => {
        const account = await TestAccount.create(context);
        const session = await TestSession.create(account);

        const initialItem = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });

        expect(initialItem?.observedTimeZone).toBe(defaultTimeZone);

        await updateOurAccountSettings(session.action(), {
            type: "UpdateObservedTimeZone",
            timeZone: assertTimeZone("America/Los_Angeles"),
        });

        const result = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });
        expect(result?.observedTimeZone).toBe("America/Los_Angeles");
    });

    test("should create a new account settings item and set the observedTimeZone if it doesn\u2019t exist", async () => {
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
            reactionCharacter: getUnstableReactionCharacterForNewAccountId(accountId),
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

        await updateOurAccountSettings(context.action({id: sessionId, account: {id: accountId}}), {
            type: "UpdateObservedTimeZone",
            timeZone: assertTimeZone("America/Los_Angeles"),
        });

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
});
