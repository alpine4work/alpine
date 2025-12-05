import {
    createSessionForTest,
    pickRandomReactionCharacterForAccount,
} from "~/server/accounts/accounts_actions.js";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {
    getOurLastOpenedSpaceId,
    updateOurAccountObservedTimeZone,
    updateOurLastOpenedSpaceId,
} from "~/server/accounts/with_spaces/accounts_actions_settings.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {addSpaceAccountForTest, removeSpaceAccount} from "~/server/spaces/spaces_actions.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {TimeZone, assertTimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    notificationsInjection: {
        notifyInboxOfTimeZoneChange: asyncNoop,
    },
});

describe("updateOurLastOpenedSpaceId()", () => {
    test("should allow updating the lastOpenedSpaceId for the current session", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);

        const session = await space1.createSession();
        await space2.addAccount(session);

        await updateOurLastOpenedSpaceId(session.action(), space1.id);

        const result1 = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });
        expect(result1?.lastOpenedSpaceId).toBe(space1.id);

        await updateOurLastOpenedSpaceId(session.action(), space2.id);

        const result2 = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });
        expect(result2?.lastOpenedSpaceId).toBe(space2.id);
    });

    test("does not allow updating the lastOpenedSpaceId to a space the session in not a member of", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);

        const session = await space1.createSession();

        await expect(updateOurLastOpenedSpaceId(session.action(), space2.id)).rejects.toThrow(
            PermissionDeniedError,
        );
    });

    test("does not allow updating the lastOpenedSpaceId to a space the session is invited to", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});

        const session = await space1.createSession();
        const email = await session.account.createEmailAddress();

        await space2.inviteEmailAddress(space2OwnerSession.action(), email);

        await expect(updateOurLastOpenedSpaceId(session.action(), space2.id)).rejects.toThrow(
            PermissionDeniedError,
        );
    });

    test("does not allow updating the lastOpenedSpaceId to a space the session is removed from", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});

        const session = await space1.createSession();
        await space2.addAccount(session);

        await removeSpaceAccount(space2OwnerSession.action(), {
            spaceId: space2.id,
            accountId: session.account.id,
        });

        await expect(updateOurLastOpenedSpaceId(session.action(), space2.id)).rejects.toThrow(
            PermissionDeniedError,
        );
    });

    test("should create a new account settings item and set the lastOpenedSpaceId if it doesn’t exist", async () => {
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

        await updateOurLastOpenedSpaceId(
            context.action({id: sessionId, account: {id: accountId}}),
            space1.id,
        );

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

describe("getOurLastOpenedSpaceId()", () => {
    test("should return the correct spaceId for a space we have access to", async () => {
        const space1 = await TestSpace.create(context);
        const session = await space1.createSession();

        await updateOurLastOpenedSpaceId(session.action(), space1.id);

        const result = await getOurLastOpenedSpaceId(session.action());
        expect(result).toBe(space1.id);
    });

    test("defaults when the lastOpenedSpaceId is set to an account we’re invited to", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});
        const session = await space1.createSession();
        const email = await session.account.createEmailAddress();

        // Add our account and update the space ID
        await space2.addAccount(session);
        await updateOurLastOpenedSpaceId(session.action(), space2.id);

        // Remove the account and re-invite it
        await removeSpaceAccount(space2OwnerSession.action(), {
            spaceId: space2.id,
            accountId: session.account.id,
        });
        await space2.inviteEmailAddress(space2OwnerSession.action(), email);

        // Should default to our first space
        const result = await getOurLastOpenedSpaceId(session.action());
        expect(result).toBe(space1.id);
    });

    test("defaults when the lastOpenedSpaceId is set to an account we’re removed from", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});
        const session = await space1.createSession();

        // Add our account and update the space ID
        await space2.addAccount(session);
        await updateOurLastOpenedSpaceId(session.action(), space2.id);

        // Remove the account and re-invite it
        await removeSpaceAccount(space2OwnerSession.action(), {
            spaceId: space2.id,
            accountId: session.account.id,
        });

        // Should default to our first space
        const result = await getOurLastOpenedSpaceId(session.action());
        expect(result).toBe(space1.id);
    });
});

describe("updateOurAccountObservedTimeZone()", () => {
    test("should allow updating the observedTimeZone for the current session", async () => {
        const account = await TestAccount.create(context);
        const session = await TestSession.create(account);

        const initialItem = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });

        expect(initialItem?.observedTimeZone).toBe(defaultTimeZone);

        await updateOurAccountObservedTimeZone(
            session.action(),
            assertTimeZone("America/Los_Angeles"),
        );

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
});
