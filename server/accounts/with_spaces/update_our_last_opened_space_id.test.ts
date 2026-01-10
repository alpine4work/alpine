import {createSessionForTest} from "~/server/accounts/create_account_for_test.js";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {updateOurLastOpenedSpaceId} from "~/server/accounts/with_spaces/update_our_last_opened_space_id.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {addSpaceAccountForTest} from "~/server/spaces/create_space_for_test.js";
import {removeSpaceAccount} from "~/server/spaces/remove_space_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.js";
import {getUnstableReactionCharacterForNewAccountId} from "~/shared/reactions/get_unstable_reaction_character_for_new_account_id.js";

const context = createTestContext({
    notificationsInjection: {
        notifyInboxOfTimeZoneChange: asyncNoop,
    },
});

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

    await space2OwnerSession.inviteEmailAddress(email);

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
