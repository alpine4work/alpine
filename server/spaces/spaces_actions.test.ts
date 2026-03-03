import {updateOurAccountName} from "~/server/accounts/update_our_account_name.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {dynamoClientExecuteActionTestCounter} from "~/server/dynamo/core/dynamo_client_execute_action_test_counter.js";
import {dynamoClientGetItemTestCounter} from "~/server/dynamo/core/dynamo_client_get_item_test_counter.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {acceptSpaceAccountInvite} from "~/server/spaces/accept_space_account_invite.js";
import {addSpaceAccount} from "~/server/spaces/add_space_account.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {
    authorizeSpaceAccess,
    authorizeSpaceAccessIfPossible,
} from "~/server/spaces/authorize_space_access.js";
import {getSpaceAccountForTest} from "~/server/spaces/create_space_for_test.js";
import {expensivelyGetAllSpaceAccounts} from "~/server/spaces/expensively_get_all_space_accounts.js";
import {getAccount, getAccountIfExists} from "~/server/spaces/get_account.js";
import {getOurAccountInvitePendingSpaceIds} from "~/server/spaces/get_our_account_invite_pending_space_ids.js";
import {getOurAccountSpaceIds} from "~/server/spaces/get_our_account_space_ids.js";
import {getOwnAccountIfExists} from "~/server/spaces/get_own_account_if_exists.js";
import {getSpace, getSpaceIfPossible} from "~/server/spaces/get_space.js";
import {getSpaceAccountNameSearchIndex} from "~/server/spaces/get_space_account_name_search_index.js";
import {instantiateBotSpaceAccount} from "~/server/spaces/instantiate_bot_space_account.js";
import {addSpaceAccountBeforeExecuteTestCheckpoint} from "~/server/spaces/internal/get_add_space_account_transaction_entries.js";
import {spaceAccountsCache} from "~/server/spaces/internal/space_accounts_cache.js";
import {inviteEmailAddressesToSpace} from "~/server/spaces/invite_email_addresses_to_space.js";
import {isAccountMemberOfSpaceWithoutAuthorization} from "~/server/spaces/is_account_member_of_space.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {
    moveSpaceAccountOwnerRole,
    moveSpaceAccountOwnerRoleBeforeExecuteTestCheckpoint,
    moveSpaceAccountOwnerRoleForTest,
} from "~/server/spaces/move_space_account_owner_role.js";
import {rejectSpaceAccountInviteAsSpam} from "~/server/spaces/reject_space_account_invite_as_spam.js";
import {
    removeSpaceAccount,
    removeSpaceAccountBeforeExecuteTestCheckpoint,
} from "~/server/spaces/remove_space_account.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {generateEmailAddressForTest} from "~/server/spaces/test_helpers/generate_email_address_for_test.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {updateSpaceAccountRole} from "~/server/spaces/update_space_account_role.js";
import {updateSpaceName} from "~/server/spaces/update_space_name.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {
    FailedPreconditionError,
    InternalError,
    NotFoundError,
    PermissionDeniedError,
    UnauthenticatedError,
} from "~/shared/error/error.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";
import {
    createTestAccountModel,
    intoAccountModelWithoutSpaceAndAvatar,
} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection: {internalGetUpdateOurAccountNameTaskTransactionEntries: () => []},
});

const isMember = async (space: TestSpace, session: TestSession) => {
    const result1 = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        session.account.id,
    );

    // Make sure `authorizeSpaceAccess()` gives the same result as
    // `isAccountMemberOfSpaceWithoutAuthorization()`.
    const result2 = await captureResultPromise(() =>
        authorizeSpaceAccess(session.action(), space.id),
    );
    const result3 = await authorizeSpaceAccessIfPossible(session.action(), space.id);

    if (result1) {
        expect(result2).toEqual({ok: true});
        expect(result3).toEqual({ok: true});
    } else {
        expect(result2).toEqual({ok: false, error: expect.any(PermissionDeniedError)});
        expect(result2).not.toEqual({ok: false, error: expect.any(InternalError)});
        expect(result3).toEqual({ok: false, error: expect.any(PermissionDeniedError)});
        expect(result3).not.toEqual({ok: false, error: expect.any(InternalError)});
    }

    return result1;
};

const expectAccountSpaceIds = async (
    session: TestSession,
    expected: {spaceIds: ReadonlySet<SpaceId>; invitePendingSpaceIds: ReadonlySet<SpaceId>},
) => {
    expect((await getOurAccountSpaceIds(session.action())).spaceIds).toEqual(expected.spaceIds);
    expect(await getOurAccountInvitePendingSpaceIds(session.action())).toEqual(
        expected.invitePendingSpaceIds,
    );
};

test("can not get all accounts for a space we are not in", async () => {
    const spaceA = await TestSpace.create(context);
    const spaceB = await TestSpace.create(context);
    const sessionA1 = await spaceA.createSession();
    const sessionB1 = await spaceB.createSession();

    await expect(
        expensivelyGetAllSpaceAccounts(context.action(sessionA1), spaceB.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        expensivelyGetAllSpaceAccounts(context.action(sessionB1), spaceA.id),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can get all accounts for our space", async () => {
    const spaceA = await TestSpace.create(context);
    const spaceB = await TestSpace.create(context);

    const ownerSessionA = await spaceA.createSession({role: "Owner"});
    const ownerSessionB = await spaceB.createSession({role: "Owner"});

    const [sessionA1, sessionA2, sessionA3] = await spaceA.createSessions(3);
    const [sessionB1, sessionB2, sessionB3] = await spaceB.createSessions(3);

    await expect(
        expensivelyGetAllSpaceAccounts(context.action(sessionA1), spaceA.id),
    ).resolves.toEqual(
        [
            await getAccount(context.action(ownerSessionA), spaceA.id, ownerSessionA.account.id),
            await getAccount(context.action(sessionA1), spaceA.id, sessionA1.account.id),
            await getAccount(context.action(sessionA2), spaceA.id, sessionA2.account.id),
            await getAccount(context.action(sessionA3), spaceA.id, sessionA3.account.id),
        ].sort((account1, account2) => defaultCompareStrings(account1.id, account2.id)),
    );

    await expect(
        expensivelyGetAllSpaceAccounts(context.action(sessionB1), spaceB.id),
    ).resolves.toEqual(
        [
            // since we add owner account while creating the TestSpace, this adds up in the the
            // result from `expensivelyGetAllSpaceAccounts`
            await getAccount(context.action(ownerSessionB), spaceB.id, ownerSessionB.account.id),
            await getAccount(context.action(sessionB1), spaceB.id, sessionB1.account.id),
            await getAccount(context.action(sessionB2), spaceB.id, sessionB2.account.id),
            await getAccount(context.action(sessionB3), spaceB.id, sessionB3.account.id),
        ].sort((account1, account2) => defaultCompareStrings(account1.id, account2.id)),
    );
});

test("account name search matches names with slight typos", async () => {
    const space = await TestSpace.create(context);

    const session1 = await space.createSession({name: "Caleb Meredith"});
    const session2 = await space.createSession({name: "Siobahn McDonough"});
    const session3 = await space.createSession({name: "Xue Seng Tay"});
    const session4 = await space.createSession({name: "Vu Tran"});
    const session5 = await space.createSession({name: "L Lawliet"}); // https://en.wikipedia.org/wiki/L_(Death_Note)

    const accountNameIndex = await getSpaceAccountNameSearchIndex(session1.action(), space.id);

    expect(accountNameIndex.searchShortNames("Caleb")).toEqual([await session1.get()]);
    expect(accountNameIndex.searchShortNames("caleb")).toEqual([await session1.get()]);
    expect(accountNameIndex.searchShortNames("Calebs")).toEqual([await session1.get()]);
    expect(accountNameIndex.searchShortNames("Baleb")).toEqual([await session1.get()]);
    expect(accountNameIndex.searchShortNames("baleb")).toEqual([await session1.get()]);
    expect(accountNameIndex.searchShortNames("Siobahn")).toEqual([await session2.get()]);
    expect(accountNameIndex.searchShortNames("siobahn")).toEqual([await session2.get()]);
    expect(accountNameIndex.searchShortNames("Siobahns")).toEqual([await session2.get()]);
    expect(accountNameIndex.searchShortNames("Siobahnn")).toEqual([await session2.get()]);
    expect(accountNameIndex.searchShortNames("Soibahn")).toEqual([await session2.get()]);
    expect(accountNameIndex.searchShortNames("Soobahn")).toEqual([await session2.get()]);
    expect(accountNameIndex.searchShortNames("Soibann")).toEqual([]);
    expect(accountNameIndex.searchShortNames("Soobann")).toEqual([]);
    expect(accountNameIndex.searchShortNames("Floorbhan")).toEqual([]);
    expect(accountNameIndex.searchShortNames("Xue")).toEqual([await session3.get()]);
    expect(accountNameIndex.searchShortNames("Xues")).toEqual([]);
    expect(accountNameIndex.searchShortNames("Xu")).toEqual([]);
    expect(accountNameIndex.searchShortNames("Xuu")).toEqual([]);
    expect(accountNameIndex.searchShortNames("Shue")).toEqual([]);
    expect(accountNameIndex.searchShortNames("Vu")).toEqual([await session4.get()]);
    expect(accountNameIndex.searchShortNames("Xu")).toEqual([]);
    expect(accountNameIndex.searchShortNames("vut")).toEqual([]);
    expect(accountNameIndex.searchShortNames("l")).toEqual([await session5.get()]);
    expect(accountNameIndex.searchShortNames("m")).toEqual([]);
    expect(accountNameIndex.searchShortNames("k")).toEqual([]);

    expect(accountNameIndex.searchNames("Caleb")).toEqual([await session1.get()]);
    expect(accountNameIndex.searchNames("Caleb Meredith")).toEqual([await session1.get()]);
    expect(accountNameIndex.searchNames("Calebs Meredith")).toEqual([await session1.get()]);
    expect(accountNameIndex.searchNames("Caleb Merediths")).toEqual([await session1.get()]);
    expect(accountNameIndex.searchNames("Calebs Merediths")).toEqual([await session1.get()]);
    expect(accountNameIndex.searchNames("caleb meredith")).toEqual([await session1.get()]);
    expect(accountNameIndex.searchNames("Baleb Meredith")).toEqual([await session1.get()]);
    expect(accountNameIndex.searchNames("baleb meredith")).toEqual([await session1.get()]);
    expect(accountNameIndex.searchNames("Baleb Meredeth")).toEqual([await session1.get()]);
    expect(accountNameIndex.searchNames("Baleb Merideth")).toEqual([await session1.get()]);
    expect(accountNameIndex.searchNames("Siobahn McDonough")).toEqual([await session2.get()]);
    expect(accountNameIndex.searchNames("siobahn mcdonough")).toEqual([await session2.get()]);
    expect(accountNameIndex.searchNames("Siobahnn McDonough")).toEqual([await session2.get()]);
    expect(accountNameIndex.searchNames("Soibahn McDonough")).toEqual([await session2.get()]);
    expect(accountNameIndex.searchNames("Soobahn McDonough")).toEqual([await session2.get()]);
    expect(accountNameIndex.searchNames("Soibann McDonough")).toEqual([await session2.get()]);
    expect(accountNameIndex.searchNames("Soobann McDonough")).toEqual([await session2.get()]);
    expect(accountNameIndex.searchNames("Floorbhan McDonough")).toEqual([]);
    expect(accountNameIndex.searchNames("Xue Seng Tay")).toEqual([await session3.get()]);
    expect(accountNameIndex.searchNames("Xue Seng")).toEqual([await session3.get()]);
    expect(accountNameIndex.searchNames("Xue")).toEqual([]);
    expect(accountNameIndex.searchNames("Xu Seng Tay")).toEqual([await session3.get()]);
    expect(accountNameIndex.searchNames("Xuu Seng Tay")).toEqual([await session3.get()]);
    expect(accountNameIndex.searchNames("Shue Seng Tay")).toEqual([await session3.get()]);
    expect(accountNameIndex.searchNames("Vu")).toEqual([]);
    expect(accountNameIndex.searchNames("Xu")).toEqual([]);
    expect(accountNameIndex.searchNames("Vu Tran")).toEqual([await session4.get()]);
    expect(accountNameIndex.searchNames("Vu T")).toEqual([await session4.get()]);
    expect(accountNameIndex.searchNames("vut")).toEqual([]);
    expect(accountNameIndex.searchNames("Vu Tr")).toEqual([await session4.get()]);
    expect(accountNameIndex.searchNames("vutr")).toEqual([]);
    expect(accountNameIndex.searchNames("l")).toEqual([]);
    expect(accountNameIndex.searchNames("m")).toEqual([]);
    expect(accountNameIndex.searchNames("k")).toEqual([]);
    expect(accountNameIndex.searchNames("l l")).toEqual([]);
    expect(accountNameIndex.searchNames("l la")).toEqual([await session5.get()]);
    expect(accountNameIndex.searchNames("l law")).toEqual([await session5.get()]);
    expect(accountNameIndex.searchNames("l lawl")).toEqual([await session5.get()]);
});

test("account name search can do some prefix matching", async () => {
    const space = await TestSpace.create(context);

    const session1 = await space.createSession({name: "Caleb Meredith"});
    await space.createSession({name: "Siobahn McDonough"});
    const session3 = await space.createSession({name: "Emily Alpha"});
    const session4 = await space.createSession({name: "Emily Beta"});
    const session5 = await space.createSession({name: "Emily Gamma"});
    const session6 = await space.createSession({name: "Emily Delta"});

    const accountNameIndex = await getSpaceAccountNameSearchIndex(session1.action(), space.id);

    expect(accountNameIndex.searchNames("e")).toEqual([]);

    expect(accountNameIndex.searchNames("em")).toEqual([]);

    expect(
        accountNameIndex.searchNames("emily").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [
            await session3.get(),
            await session4.get(),
            await session5.get(),
            await session6.get(),
        ].sort((a, b) => defaultCompareStrings(a.id, b.id)),
    );

    // TODO(calebmer): I wish this only matched "emily alpha". Same for the other
    // prefix matches...
    expect(
        accountNameIndex.searchNames("emily a").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [
            await session3.get(),
            await session4.get(),
            await session5.get(),
            await session6.get(),
        ].sort((a, b) => defaultCompareStrings(a.id, b.id)),
    );

    expect(
        accountNameIndex.searchNames("emily b").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [
            await session3.get(),
            await session4.get(),
            await session5.get(),
            await session6.get(),
        ].sort((a, b) => defaultCompareStrings(a.id, b.id)),
    );

    expect(
        accountNameIndex.searchNames("emily g").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [
            await session3.get(),
            await session4.get(),
            await session5.get(),
            await session6.get(),
        ].sort((a, b) => defaultCompareStrings(a.id, b.id)),
    );

    expect(
        accountNameIndex.searchNames("emily d").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [
            await session3.get(),
            await session4.get(),
            await session5.get(),
            await session6.get(),
        ].sort((a, b) => defaultCompareStrings(a.id, b.id)),
    );

    expect(
        accountNameIndex.searchNames("emily be").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [await session4.get(), await session6.get()].sort((a, b) =>
            defaultCompareStrings(a.id, b.id),
        ),
    );

    expect(
        accountNameIndex.searchNames("emily ba").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [await session3.get(), await session4.get(), await session5.get()].sort((a, b) =>
            defaultCompareStrings(a.id, b.id),
        ),
    );

    expect(
        accountNameIndex.searchNames("emily bet").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [await session4.get(), await session6.get()].sort((a, b) =>
            defaultCompareStrings(a.id, b.id),
        ),
    );

    expect(
        accountNameIndex.searchNames("emily bam").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [await session3.get(), await session4.get(), await session5.get()].sort((a, b) =>
            defaultCompareStrings(a.id, b.id),
        ),
    );

    expect(
        accountNameIndex
            .searchNames("emily beta")
            .sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [await session4.get(), await session6.get()].sort((a, b) =>
            defaultCompareStrings(a.id, b.id),
        ),
    );

    expect(accountNameIndex.searchNames("emily bamma")).toEqual([await session5.get()]);

    expect(accountNameIndex.searchShortNames("e")).toEqual([]);

    expect(accountNameIndex.searchShortNames("em")).toEqual([]);

    expect(
        accountNameIndex
            .searchShortNames("emily")
            .sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [
            await session3.get(),
            await session4.get(),
            await session5.get(),
            await session6.get(),
        ].sort((a, b) => defaultCompareStrings(a.id, b.id)),
    );
});

test("`isAccountMemberOfSpace()` caches a true result in context", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    const cacheContext = context.withCache();

    const isMember = async (
        context: Context<ServerProcessContextModules & {cache: CacheContextModule}>,
        space: TestSpace,
        session: TestSession,
    ) => {
        const result1 = await isAccountMemberOfSpaceWithoutAuthorization(
            context,
            space.id,
            session.account.id,
        );

        // Make sure `authorizeSpaceAccess()` gives the same result as
        // `isAccountMemberOfSpaceWithoutAuthorization()`.
        const result2 = await captureResultPromise(() =>
            authorizeSpaceAccess(
                session.action().clone({cache: context.cache.forkForChangedActor()}),
                space.id,
            ),
        );
        const result3 = await authorizeSpaceAccessIfPossible(
            session.action().clone({cache: context.cache.forkForChangedActor()}),
            space.id,
        );

        if (result1) {
            expect(result2).toEqual({ok: true});
            expect(result3).toEqual({ok: true});
        } else {
            expect(result2).toEqual({ok: false, error: expect.any(PermissionDeniedError)});
            expect(result2).not.toEqual({ok: false, error: expect.any(InternalError)});
            expect(result3).toEqual({ok: false, error: expect.any(PermissionDeniedError)});
            expect(result3).not.toEqual({ok: false, error: expect.any(InternalError)});
        }

        return result1;
    };

    expect(await isMember(context.withCache(), space, session1)).toEqual(true);
    expect(await isMember(context.withCache(), space, session2)).toEqual(true);
    expect(await isMember(context.withCache(), space, otherSession)).toEqual(false);
    expect(await isMember(cacheContext, space, session1)).toEqual(true);
    expect(await isMember(cacheContext, space, session2)).toEqual(true);
    expect(await isMember(cacheContext, space, otherSession)).toEqual(false);

    await removeSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await isMember(context.withCache(), space, session1)).toEqual(true);
    expect(await isMember(context.withCache(), space, session2)).toEqual(false);
    expect(await isMember(context.withCache(), space, otherSession)).toEqual(false);
    expect(await isMember(cacheContext, space, session1)).toEqual(true);
    expect(await isMember(cacheContext, space, session2)).toEqual(true);
    expect(await isMember(cacheContext, space, otherSession)).toEqual(false);

    await space.addAccount(otherSession.account);

    expect(await isMember(context.withCache(), space, session1)).toEqual(true);
    expect(await isMember(context.withCache(), space, session2)).toEqual(false);
    expect(await isMember(context.withCache(), space, otherSession)).toEqual(true);
    expect(await isMember(cacheContext, space, session1)).toEqual(true);
    expect(await isMember(cacheContext, space, session2)).toEqual(true);
    expect(await isMember(cacheContext, space, otherSession)).toEqual(true);
});

test("`isAccountMemberOfSpace()` uses the `getAccountIfExists()` cache in context to return true", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    const cacheContext1 = session1.action();
    const cacheContext2 = session2.action();
    const cacheContext3 = otherSession.action();

    const isMember = async (
        context: ServerSessionActionContext,
        space: TestSpace,
        session: TestSession,
    ) => {
        const result1 = await isAccountMemberOfSpaceWithoutAuthorization(
            context,
            space.id,
            session.account.id,
        );

        if (context.actor.getAccountId() === session.account.id) {
            // Make sure `authorizeSpaceAccess()` gives the same result as
            // `isAccountMemberOfSpaceWithoutAuthorization()`.
            const result2 = await captureResultPromise(() =>
                authorizeSpaceAccess(context, space.id),
            );
            const result3 = await authorizeSpaceAccessIfPossible(context, space.id);

            if (result1) {
                expect(result2).toEqual({ok: true});
                expect(result3).toEqual({ok: true});
            } else {
                expect(result2).toEqual({ok: false, error: expect.any(PermissionDeniedError)});
                expect(result2).not.toEqual({ok: false, error: expect.any(InternalError)});
                expect(result3).toEqual({ok: false, error: expect.any(PermissionDeniedError)});
                expect(result3).not.toEqual({ok: false, error: expect.any(InternalError)});
            }
        }

        return result1;
    };

    await getAccountIfExists(cacheContext1, space.id, session2.account.id);
    await getAccountIfExists(cacheContext1, space.id, otherSession.account.id);

    await getAccountIfExists(cacheContext2, space.id, session2.account.id);
    await getAccountIfExists(cacheContext2, space.id, otherSession.account.id);

    await expect(getAccountIfExists(cacheContext3, space.id, session2.account.id)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        getAccountIfExists(cacheContext3, space.id, otherSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await removeSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await isMember(session1.action(), space, session1)).toEqual(true);
    expect(await isMember(session1.action(), space, session2)).toEqual(false);
    expect(await isMember(session1.action(), space, otherSession)).toEqual(false);
    expect(await isMember(cacheContext1, space, session1)).toEqual(true);
    expect(await isMember(cacheContext1, space, session2)).toEqual(true);
    expect(await isMember(cacheContext1, space, otherSession)).toEqual(false);
    expect(await isMember(cacheContext2, space, session1)).toEqual(true);
    expect(await isMember(cacheContext2, space, session2)).toEqual(true);
    expect(await isMember(cacheContext2, space, otherSession)).toEqual(false);
    expect(await isMember(cacheContext3, space, session1)).toEqual(true);
    expect(await isMember(cacheContext3, space, session2)).toEqual(false);
    expect(await isMember(cacheContext3, space, otherSession)).toEqual(false);

    await space.addAccount(otherSession.account);

    expect(await isMember(session1.action(), space, session1)).toEqual(true);
    expect(await isMember(session1.action(), space, session2)).toEqual(false);
    expect(await isMember(session1.action(), space, otherSession)).toEqual(true);
    expect(await isMember(cacheContext1, space, session1)).toEqual(true);
    expect(await isMember(cacheContext1, space, session2)).toEqual(true);
    expect(await isMember(cacheContext1, space, otherSession)).toEqual(true);
    expect(await isMember(cacheContext2, space, session1)).toEqual(true);
    expect(await isMember(cacheContext2, space, session2)).toEqual(true);
    expect(await isMember(cacheContext2, space, otherSession)).toEqual(true);
    expect(await isMember(cacheContext3, space, session1)).toEqual(true);
    expect(await isMember(cacheContext3, space, session2)).toEqual(false);
    expect(await isMember(cacheContext3, space, otherSession)).toEqual(true);
});

test("`isAccountMemberOfSpace()` uses `spaceAccountsCache` to return true", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    await spaceAccountsCache.dangerouslyGetDataWithoutAuthorizing(context.withCache(), space.id);

    await removeSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);

    await space.addAccount(otherSession.account);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(true);

    spaceAccountsCache.clearForTest();

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(false);
    expect(await isMember(space, otherSession)).toEqual(true);
});

test("`isAccountMemberOfSpace()` ignores cached false result in context", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    const cacheContext = context.withCache();

    const isMember = async (
        context: Context<ServerProcessContextModules & {cache: CacheContextModule}>,
        space: TestSpace,
        session: TestSession,
    ) => {
        const result1 = await isAccountMemberOfSpaceWithoutAuthorization(
            context,
            space.id,
            session.account.id,
        );

        // Make sure `authorizeSpaceAccess()` gives the same result as
        // `isAccountMemberOfSpaceWithoutAuthorization()`.
        const result2 = await captureResultPromise(() =>
            authorizeSpaceAccess(
                session.action().clone({cache: context.cache.forkForChangedActor()}),
                space.id,
            ),
        );
        const result3 = await authorizeSpaceAccessIfPossible(
            session.action().clone({cache: context.cache.forkForChangedActor()}),
            space.id,
        );

        if (result1) {
            expect(result2).toEqual({ok: true});
            expect(result3).toEqual({ok: true});
        } else {
            expect(result2).toEqual({ok: false, error: expect.any(PermissionDeniedError)});
            expect(result2).not.toEqual({ok: false, error: expect.any(InternalError)});
            expect(result3).toEqual({ok: false, error: expect.any(PermissionDeniedError)});
            expect(result3).not.toEqual({ok: false, error: expect.any(InternalError)});
        }

        return result1;
    };

    await removeSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await isMember(context.withCache(), space, session1)).toEqual(true);
    expect(await isMember(context.withCache(), space, session2)).toEqual(false);
    expect(await isMember(context.withCache(), space, otherSession)).toEqual(false);
    expect(await isMember(cacheContext, space, session1)).toEqual(true);
    expect(await isMember(cacheContext, space, session2)).toEqual(false);
    expect(await isMember(cacheContext, space, otherSession)).toEqual(false);

    await addSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
        withoutInviteForTest: true,
    });

    await acceptSpaceAccountInvite(session2.action(), space.id);

    expect(await isMember(context.withCache(), space, session1)).toEqual(true);
    expect(await isMember(context.withCache(), space, session2)).toEqual(true);
    expect(await isMember(context.withCache(), space, otherSession)).toEqual(false);
    expect(await isMember(cacheContext, space, session1)).toEqual(true);
    expect(await isMember(cacheContext, space, session2)).toEqual(true);
    expect(await isMember(cacheContext, space, otherSession)).toEqual(false);
});

test("`isAccountMemberOfSpace()` ignores the `getAccountIfExists()` cache if account was removed", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    const cacheContext1 = session1.action();
    const cacheContext2 = session2.action();
    const cacheContext3 = otherSession.action();

    const isMember = async (
        context: ServerSessionActionContext,
        space: TestSpace,
        session: TestSession,
    ) => {
        const result1 = await isAccountMemberOfSpaceWithoutAuthorization(
            context,
            space.id,
            session.account.id,
        );

        if (context.actor.getAccountId() === session.account.id) {
            // Make sure `authorizeSpaceAccess()` gives the same result as
            // `isAccountMemberOfSpaceWithoutAuthorization()`.
            const result2 = await captureResultPromise(() =>
                authorizeSpaceAccess(context, space.id),
            );
            const result3 = await authorizeSpaceAccessIfPossible(context, space.id);

            if (result1) {
                expect(result2).toEqual({ok: true});
                expect(result3).toEqual({ok: true});
            } else {
                expect(result2).toEqual({ok: false, error: expect.any(PermissionDeniedError)});
                expect(result2).not.toEqual({ok: false, error: expect.any(InternalError)});
                expect(result3).toEqual({ok: false, error: expect.any(PermissionDeniedError)});
                expect(result3).not.toEqual({ok: false, error: expect.any(InternalError)});
            }
        }

        return result1;
    };

    await removeSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    await getAccountIfExists(cacheContext1, space.id, session2.account.id);
    await getAccountIfExists(cacheContext1, space.id, otherSession.account.id);

    await expect(getAccountIfExists(cacheContext2, space.id, session2.account.id)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        getAccountIfExists(cacheContext2, space.id, otherSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(getAccountIfExists(cacheContext3, space.id, session2.account.id)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        getAccountIfExists(cacheContext3, space.id, otherSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await isMember(session1.action(), space, session1)).toEqual(true);
    expect(await isMember(session1.action(), space, session2)).toEqual(false);
    expect(await isMember(session1.action(), space, otherSession)).toEqual(false);
    expect(await isMember(cacheContext1, space, session1)).toEqual(true);
    expect(await isMember(cacheContext1, space, session2)).toEqual(false);
    expect(await isMember(cacheContext1, space, otherSession)).toEqual(false);
    expect(await isMember(cacheContext2, space, session1)).toEqual(true);
    expect(await isMember(cacheContext2, space, session2)).toEqual(false);
    expect(await isMember(cacheContext2, space, otherSession)).toEqual(false);
    expect(await isMember(cacheContext3, space, session1)).toEqual(true);
    expect(await isMember(cacheContext3, space, session2)).toEqual(false);
    expect(await isMember(cacheContext3, space, otherSession)).toEqual(false);

    await addSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
        withoutInviteForTest: true,
    });

    await acceptSpaceAccountInvite(session2.action(), space.id);

    expect(await isMember(session1.action(), space, session1)).toEqual(true);
    expect(await isMember(session1.action(), space, session2)).toEqual(true);
    expect(await isMember(session1.action(), space, otherSession)).toEqual(false);
    expect(await isMember(cacheContext1, space, session1)).toEqual(true);
    expect(await isMember(cacheContext1, space, session2)).toEqual(true);
    expect(await isMember(cacheContext1, space, otherSession)).toEqual(false);
    expect(await isMember(cacheContext2, space, session1)).toEqual(true);
    expect(await isMember(cacheContext2, space, session2)).toEqual(true);
    expect(await isMember(cacheContext2, space, otherSession)).toEqual(false);
    expect(await isMember(cacheContext3, space, session1)).toEqual(true);
    expect(await isMember(cacheContext3, space, session2)).toEqual(true);
    expect(await isMember(cacheContext3, space, otherSession)).toEqual(false);
});

test("`isAccountMemberOfSpace()` ignores the `spaceAccountsCache` cache if account was removed", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    await removeSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    await spaceAccountsCache.dangerouslyGetDataWithoutAuthorizing(context.withCache(), space.id);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(false);
    expect(await isMember(space, otherSession)).toEqual(false);

    await addSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
        withoutInviteForTest: true,
    });

    await acceptSpaceAccountInvite(session2.action(), space.id);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);

    spaceAccountsCache.clearForTest();

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
});

test("`getAccountIfExists()` will return a removed account", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        createTestAccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Admin",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Member",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await removeSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        createTestAccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Admin",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 1,
                addedTime: expect.any(Date),
                state: {
                    type: "Removed",
                    removedTime: expect.any(Date),
                    oldAccountData: intoAccountModelWithoutSpaceAndAvatar(
                        (await session2.account.get()).initialData,
                    ),
                    reason: "ActionByAdmin",
                },
                role: "Member",
            },
            avatar: {
                version: 1,
                avatarId: null,
                content: null,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await addSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
        withoutInviteForTest: true,
    });

    await acceptSpaceAccountInvite(session2.action(), space.id);

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        createTestAccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Admin",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 3,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Member",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );
});

test("`getAccountIfExists()` will cache eventually consistent reads in context", async () => {
    const [space] = await runAllPromises([TestSpace.create(context)]);

    const [session1, session2] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
    ]);

    const cacheContext1 = session1.action();
    const cacheContext2 = session1.action();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();

    dynamoClientExecuteActionTestCounter.resetForTest();
    expect(getCount()).toEqual(0);

    const cachedAccount1 = await getAccountIfExists(cacheContext1, space.id, session2.account.id);

    expect(getCount()).toEqual(3);

    expect(await getAccountIfExists(cacheContext1, space.id, session2.account.id)).toEqual(
        cachedAccount1,
    );

    expect(getCount()).toEqual(3);

    expect(cachedAccount1).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Member",
            },
        }),
    );

    await removeSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    dynamoClientExecuteActionTestCounter.resetForTest();
    expect(getCount()).toEqual(0);

    const cachedAccount2 = await getAccountIfExists(cacheContext2, space.id, session2.account.id);

    expect(getCount()).toEqual(4);

    expect(await getAccountIfExists(cacheContext1, space.id, session2.account.id)).toEqual(
        cachedAccount1,
    );

    expect(getCount()).toEqual(4);

    expect(cachedAccount2).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 1,
                addedTime: expect.any(Date),
                state: {
                    type: "Removed",
                    removedTime: expect.any(Date),
                    oldAccountData: intoAccountModelWithoutSpaceAndAvatar(
                        (await session2.account.get()).initialData,
                    ),
                    reason: "ActionByAdmin",
                },
                role: "Member",
            },
            avatar: {
                version: 1,
                avatarId: null,
                content: null,
            },
        }),
    );

    await addSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
        withoutInviteForTest: true,
    });

    await acceptSpaceAccountInvite(session2.action(), space.id);

    dynamoClientExecuteActionTestCounter.resetForTest();
    expect(getCount()).toEqual(0);

    expect(await getAccountIfExists(cacheContext1, space.id, session2.account.id)).toEqual(
        cachedAccount1,
    );

    expect(getCount()).toEqual(0);

    expect(await getAccountIfExists(cacheContext2, space.id, session2.account.id)).toEqual(
        cachedAccount2,
    );

    expect(getCount()).toEqual(0);

    const cachedAccount3 = await getAccountIfExists(cacheContext2, space.id, session2.account.id, {
        consistency: "Strong",
    });

    expect(cachedAccount2).not.toBe(cachedAccount3);
    expect(cachedAccount3).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 3,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Member",
            },
        }),
    );

    dynamoClientExecuteActionTestCounter.resetForTest();
    expect(getCount()).toEqual(0);

    expect(await getAccountIfExists(cacheContext1, space.id, session2.account.id)).toEqual(
        cachedAccount1,
    );

    expect(getCount()).toEqual(0);

    expect(await getAccountIfExists(cacheContext2, space.id, session2.account.id)).toEqual(
        cachedAccount3,
    );

    expect(getCount()).toEqual(0);
});

test("`getAccountIfExists()` will return cached accounts from `spaceAccountsCache`", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    await spaceAccountsCache.dangerouslyGetDataWithoutAuthorizing(context.withCache(), space.id);

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        createTestAccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Admin",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Member",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await removeSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        createTestAccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Admin",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Member",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    spaceAccountsCache.clearForTest();

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        createTestAccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Admin",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 1,
                addedTime: expect.any(Date),
                state: {
                    type: "Removed",
                    removedTime: expect.any(Date),
                    oldAccountData: intoAccountModelWithoutSpaceAndAvatar(
                        (await session2.account.get()).initialData,
                    ),
                    reason: "ActionByAdmin",
                },
                role: "Member",
            },
            avatar: {
                version: 1,
                avatarId: null,
                content: null,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await spaceAccountsCache.dangerouslyGetDataWithoutAuthorizing(context.withCache(), space.id);

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        createTestAccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Admin",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 1,
                addedTime: expect.any(Date),
                state: {
                    type: "Removed",
                    removedTime: expect.any(Date),
                    oldAccountData: intoAccountModelWithoutSpaceAndAvatar(
                        (await session2.account.get()).initialData,
                    ),
                    reason: "ActionByAdmin",
                },
                role: "Member",
            },
            avatar: {
                version: 1,
                avatarId: null,
                content: null,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await addSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
        withoutInviteForTest: true,
    });

    await acceptSpaceAccountInvite(session2.action(), space.id);

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        createTestAccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Admin",
            },
        }),
    );
    expect(
        await getAccountIfExists(session1.action(), space.id, session2.account.id, {
            consistency: "Strong",
        }),
    ).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 3,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Member",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 1,
                addedTime: expect.any(Date),
                state: {
                    type: "Removed",
                    removedTime: expect.any(Date),
                    oldAccountData: intoAccountModelWithoutSpaceAndAvatar(
                        (await session2.account.get()).initialData,
                    ),
                    reason: "ActionByAdmin",
                },
                role: "Member",
            },
            avatar: {
                version: 1,
                avatarId: null,
                content: null,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    spaceAccountsCache.clearForTest();

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        createTestAccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Admin",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 3,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Member",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );
});

test("`getAccountIfExists()` will keep returning an old name when account is removed", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        createTestAccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Admin",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Member",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await updateOurAccountName(session2.action(), "Shawn Tyson");

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        createTestAccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Admin",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 1,
            name: "Shawn Tyson",
            nameVersion: 1,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Member",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await removeSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        createTestAccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Admin",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 1,
            name: "Shawn Tyson",
            nameVersion: 1,
            space: {
                version: 1,
                addedTime: expect.any(Date),
                state: {
                    type: "Removed",
                    removedTime: expect.any(Date),
                    oldAccountData: expect.objectContaining({
                        name: "Shawn Tyson",
                        nameVersion: 1,
                    }),
                    reason: "ActionByAdmin",
                },
                role: "Member",
            },
            avatar: {
                version: 1,
                avatarId: null,
                content: null,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await updateOurAccountName(session2.action(), "Shawn Meredith");

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        createTestAccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Admin",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 1,
            name: "Shawn Tyson",
            nameVersion: 1,
            space: {
                version: 1,
                addedTime: expect.any(Date),
                state: {
                    type: "Removed",
                    removedTime: expect.any(Date),
                    oldAccountData: expect.objectContaining({
                        name: "Shawn Tyson",
                        nameVersion: 1,
                    }),
                    reason: "ActionByAdmin",
                },
                role: "Member",
            },
            avatar: {
                version: 1,
                avatarId: null,
                content: null,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await addSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        createTestAccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Admin",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 1,
            name: "Shawn Tyson",
            nameVersion: 1,
            space: {
                version: 2,
                addedTime: expect.any(Date),
                state: {
                    type: "InvitePending",
                    invitedTime: expect.any(Date),
                    pendingAccountData: expect.objectContaining({
                        name: "Shawn Tyson",
                        nameVersion: 1,
                    }),
                    wasPreviouslyRemoved: true,
                },
                role: "Member",
            },
            avatar: {
                version: 1,
                avatarId: null,
                content: null,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await acceptSpaceAccountInvite(session2.action(), space.id);

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        createTestAccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Admin",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        createTestAccountModel({
            id: session2.account.id,
            version: 2,
            name: "Shawn Meredith",
            nameVersion: 2,
            space: {
                version: 3,
                addedTime: expect.any(Date),
                state: {type: "Active", activatedTime: expect.any(Date)},
                role: "Member",
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );
});

test("`getOwnAccountIfExists()` can read own account even if an invite is pending", async () => {
    const space = await TestSpace.create(context);

    const [activeSession, removedSession, invitedSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        space.createSession(),
    ]);

    // Set up removed account
    await removeSpaceAccount(activeSession.action(), {
        spaceId: space.id,
        accountId: removedSession.account.id,
    });

    // Remove the invited account, and re-add manually to trigger an invite
    await removeSpaceAccount(activeSession.action(), {
        spaceId: space.id,
        accountId: invitedSession.account.id,
    });

    await addSpaceAccount(activeSession.action(), {
        spaceId: space.id,
        accountId: invitedSession.account.id,
        withoutInviteForTest: true,
    });

    // Should throw on removed account without flag
    await expect(
        getAccountIfExists(removedSession.action(), space.id, removedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    // Should not throw if getting own account
    await getOwnAccountIfExists(removedSession.action(), space.id, removedSession.account.id);

    // Should throw on invited account without flag
    await expect(
        getAccountIfExists(invitedSession.action(), space.id, invitedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    // Should not throw if getting own account
    await getOwnAccountIfExists(invitedSession.action(), space.id, invitedSession.account.id);

    // Cannot get other accounts when in non-active state, even with flag
    await expect(
        getOwnAccountIfExists(invitedSession.action(), space.id, removedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        getOwnAccountIfExists(invitedSession.action(), space.id, activeSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        getOwnAccountIfExists(removedSession.action(), space.id, invitedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        getOwnAccountIfExists(removedSession.action(), space.id, activeSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);
});

test("`authorizeSpaceAccess()` can\u2019t authorize space access for anonymous actor", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();

    await authorizeSpaceAccess(session.action(), space.id);
    await expect(authorizeSpaceAccess(session.action(), otherSpace.id)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(authorizeSpaceAccess(otherSession.action(), space.id)).rejects.toThrow(
        PermissionDeniedError,
    );
    await authorizeSpaceAccess(otherSession.action(), otherSpace.id);

    await authorizeSpaceAccess(space.systemAction(), space.id);
    await expect(authorizeSpaceAccess(space.systemAction(), otherSpace.id)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(authorizeSpaceAccess(otherSpace.systemAction(), space.id)).rejects.toThrow(
        PermissionDeniedError,
    );
    await authorizeSpaceAccess(otherSpace.systemAction(), otherSpace.id);

    await expect(authorizeSpaceAccess(context.anonymousAction(), space.id)).rejects.toThrow(
        UnauthenticatedError,
    );
    await expect(authorizeSpaceAccess(context.anonymousAction(), otherSpace.id)).rejects.toThrow(
        UnauthenticatedError,
    );

    expect(await authorizeSpaceAccessIfPossible(session.action(), space.id)).toEqual({ok: true});
    expect(await authorizeSpaceAccessIfPossible(session.action(), otherSpace.id)).toEqual({
        ok: false,
        error: expect.any(PermissionDeniedError),
    });

    expect(await authorizeSpaceAccessIfPossible(otherSession.action(), space.id)).toEqual({
        ok: false,
        error: expect.any(PermissionDeniedError),
    });
    expect(await authorizeSpaceAccessIfPossible(otherSession.action(), otherSpace.id)).toEqual({
        ok: true,
    });

    expect(await authorizeSpaceAccessIfPossible(space.systemAction(), space.id)).toEqual({
        ok: true,
    });
    expect(await authorizeSpaceAccessIfPossible(space.systemAction(), otherSpace.id)).toEqual({
        ok: false,
        error: expect.any(PermissionDeniedError),
    });

    expect(await authorizeSpaceAccessIfPossible(otherSpace.systemAction(), space.id)).toEqual({
        ok: false,
        error: expect.any(PermissionDeniedError),
    });
    expect(await authorizeSpaceAccessIfPossible(otherSpace.systemAction(), otherSpace.id)).toEqual({
        ok: true,
    });

    expect(await authorizeSpaceAccessIfPossible(context.anonymousAction(), space.id)).toEqual({
        ok: false,
        error: expect.any(UnauthenticatedError),
    });
    expect(await authorizeSpaceAccessIfPossible(context.anonymousAction(), otherSpace.id)).toEqual({
        ok: false,
        error: expect.any(UnauthenticatedError),
    });
});

test("can\u2019t authorize space access for impersonated actor in the wrong space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    await otherSpace.addAccount(session);

    await authorizeSpaceAccess(session.action(), space.id);
    await authorizeSpaceAccess(session.action(), otherSpace.id);

    await authorizeSpaceAccess(
        context.impersonatedAccountAction(space.id, session.account.id),
        space.id,
    );
    await authorizeSpaceAccess(
        context.impersonatedAccountAction(otherSpace.id, session.account.id),
        otherSpace.id,
    );

    await expect(
        authorizeSpaceAccess(
            context.impersonatedAccountAction(otherSpace.id, session.account.id),
            space.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        authorizeSpaceAccess(
            context.impersonatedAccountAction(space.id, session.account.id),
            otherSpace.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await authorizeSpaceAccessIfPossible(session.action(), space.id)).toEqual({ok: true});
    expect(await authorizeSpaceAccessIfPossible(session.action(), otherSpace.id)).toEqual({
        ok: true,
    });

    expect(
        await authorizeSpaceAccessIfPossible(
            context.impersonatedAccountAction(space.id, session.account.id),
            space.id,
        ),
    ).toEqual({
        ok: true,
    });
    expect(
        await authorizeSpaceAccessIfPossible(
            context.impersonatedAccountAction(otherSpace.id, session.account.id),
            otherSpace.id,
        ),
    ).toEqual({
        ok: true,
    });

    expect(
        await authorizeSpaceAccessIfPossible(
            context.impersonatedAccountAction(otherSpace.id, session.account.id),
            space.id,
        ),
    ).toEqual({
        ok: false,
        error: expect.any(PermissionDeniedError),
    });
    expect(
        await authorizeSpaceAccessIfPossible(
            context.impersonatedAccountAction(space.id, session.account.id),
            otherSpace.id,
        ),
    ).toEqual({
        ok: false,
        error: expect.any(PermissionDeniedError),
    });
});

test("allows space member to update space name", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const initialSpace = await getSpace(session.action(), space.id);

    const newName = "New Space Name";
    const updatedSpace = await updateSpaceName(session.action(), space.id, newName);

    expect(updatedSpace.name).toBe(newName);
    expect(updatedSpace.version).toBeGreaterThan(initialSpace.version);

    const spaceAfterUpdate = await getSpace(session.action(), space.id);
    expect(spaceAfterUpdate.name).toBe(newName);
    expect(updatedSpace.name).not.toBe(initialSpace.name);
    expect(spaceAfterUpdate.version).toBe(updatedSpace.version);
});

test("`updateSpaceName()` prevents non-member from updating space name", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const initialSpace = await getSpace(session.action(), space.id);
    const initialName = initialSpace.name;

    // Attempt to update space name from non-member session
    await expect(updateSpaceName(otherSession.action(), space.id, "New Name")).rejects.toThrow(
        PermissionDeniedError,
    );

    const spaceAfterAttempt = await getSpace(session.action(), space.id);

    // make sure the initial name wasn't "New Name".
    expect(spaceAfterAttempt.name).not.toBe("New Name");

    expect(spaceAfterAttempt.name).toBe(initialName);
    expect(spaceAfterAttempt.version).toBe(initialSpace.version);
});

test("`authorizeSpaceAccess()` throws PermissionDeniedError for non-existent space", async () => {
    const space = await TestSpace.create(context);
    const nonExistentSpaceId = generateId<SpaceId>();

    await expect(authorizeSpaceAccess(space.systemAction(), nonExistentSpaceId)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("`authorizeSpaceAccess()` throws correct PermissionDeniedError on role access.", async () => {
    const space = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const ownerSession2 = await space2.createSession({role: "Owner"});

    const ownerSession = await space.createSession({role: "Owner"});
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});

    await expect(authorizeSpaceAccess(ownerSession2.action(), space.id)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(authorizeSpaceAccess(ownerSession2.action(), space.id, "Owner")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(authorizeSpaceAccess(ownerSession2.action(), space.id, "Admin")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(authorizeSpaceAccess(ownerSession2.action(), space.id, "Member")).rejects.toThrow(
        PermissionDeniedError,
    );

    await authorizeSpaceAccess(ownerSession.action(), space.id);

    await authorizeSpaceAccess(ownerSession.action(), space.id, "Owner");

    await authorizeSpaceAccess(ownerSession.action(), space.id, "Admin");

    await authorizeSpaceAccess(ownerSession.action(), space.id, "Member");

    await authorizeSpaceAccess(adminSession.action(), space.id);

    await expect(authorizeSpaceAccess(adminSession.action(), space.id, "Owner")).rejects.toThrow(
        PermissionDeniedError,
    );
    await authorizeSpaceAccess(adminSession.action(), space.id, "Admin");

    await authorizeSpaceAccess(adminSession.action(), space.id, "Member");

    await authorizeSpaceAccess(memberSession.action(), space.id);

    await expect(authorizeSpaceAccess(memberSession.action(), space.id, "Owner")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(authorizeSpaceAccess(memberSession.action(), space.id, "Admin")).rejects.toThrow(
        PermissionDeniedError,
    );

    await authorizeSpaceAccess(memberSession.action(), space.id, "Member");
});

test("`updateSpaceName()` validates space name against empty name and very long name", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    // Get initial state
    const initialSpace = await getSpace(session.action(), space.id);

    // Test empty name
    await expect(updateSpaceName(session.action(), space.id, "")).rejects.toThrow();

    // Test very long name
    await expect(updateSpaceName(session.action(), space.id, "a".repeat(1000))).rejects.toThrow();

    // Verify name wasn't changed
    const spaceAfterAttempt = await getSpace(session.action(), space.id);

    expect(spaceAfterAttempt.name).toBe(initialSpace.name);
    expect(spaceAfterAttempt.version).toBe(initialSpace.version);
});

// 1. create initial data with 3 accounts in a space
// 2. load accounts first to populate cache
// 3. update account role directly in DB
// 4. get accounts with eventual consistency -> check role didn't got updated
// 5. get accounts with strong consistency -> check the role got updated
// 6. verify roles
test("`expensivelyGetAllSpaceAccounts()` should return latest data with strong consistency and bypass cache", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});

    const [session1, session2, session3] = await runAllPromises([
        space.createSession(),
        space.createSession(),
        space.createSession(),
    ]);

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await session1.get()).initialData.space.role).toBe("Member");
    expect((await session2.get()).initialData.space.role).toBe("Member");
    expect((await session3.get()).initialData.space.role).toBe("Member");

    await expensivelyGetAllSpaceAccounts(ownerSession.action(), space.id, {
        consistency: "Eventual",
    });

    await updateSpaceAccountRole(ownerSession.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
        role: "Admin",
    });

    const accountsStrong = await expensivelyGetAllSpaceAccounts(ownerSession.action(), space.id, {
        consistency: "Strong",
    });

    expect(
        accountsStrong.find(account => account.id === session2.account.id)?.initialData.space.role,
    ).toBe("Admin");

    const accountsEventual = await expensivelyGetAllSpaceAccounts(ownerSession.action(), space.id, {
        consistency: "Eventual",
    });

    expect(
        accountsEventual.find(account => account.id === session2.account.id)?.initialData.space
            .role,
    ).toBe("Member");
});

test("`expensivelyGetAllSpaceAccounts()` returns accounts with eventual consistency by default", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);

    const ownerSession1 = await space1.createSession({role: "Owner"});
    const [session1, session2] = await runAllPromises([
        space1.createSession(),
        space2.createSession(),
    ]);

    expect((await ownerSession1.get()).initialData.space.role).toBe("Owner");
    expect((await session1.get()).initialData.space.role).toBe("Member");
    expect((await session2.get()).initialData.space.role).toBe("Member");

    await expect(
        expensivelyGetAllSpaceAccounts(ownerSession1.action(), space1.id),
    ).resolves.toHaveLength(2);

    await addSpaceAccount(ownerSession1.action(), {
        spaceId: space1.id,
        accountId: session2.account.id,
        withoutInviteForTest: true,
    });

    const accounts = await expensivelyGetAllSpaceAccounts(ownerSession1.action(), space1.id);
    expect(accounts).toHaveLength(2);
});

test("`expensivelyGetAllSpaceAccounts()` should throw error if space access is not authorized", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});

    const space2 = await TestSpace.create(context);

    await expect(expensivelyGetAllSpaceAccounts(ownerSession.action(), space2.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("don\u2019t allow creating multiple owners in a single space", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const memberAccount = await TestAccount.create(context);
    const adminAccount = await TestAccount.create(context);
    const ownerAccount = await TestAccount.create(context);

    await addSpaceAccount(ownerSession.action(), {
        spaceId: space.id,
        accountId: memberAccount.id,
        role: "Member",
        withoutInviteForTest: true,
    });

    await addSpaceAccount(ownerSession.action(), {
        spaceId: space.id,
        accountId: adminAccount.id,
        role: "Admin",
        withoutInviteForTest: true,
    });

    await expect(
        addSpaceAccount(ownerSession.action(), {
            spaceId: space.id,
            accountId: ownerAccount.id,
            role: "Owner",
            withoutInviteForTest: true,
        }),
    ).rejects.toThrow("Space already has an owner");
});

test("don\u2019t allow creating multiple owners in a single space (with system actor)", async () => {
    const space = await TestSpace.create(context);
    await space.createSession({role: "Owner"});
    const memberAccount = await TestAccount.create(context);
    const adminAccount = await TestAccount.create(context);
    const ownerAccount = await TestAccount.create(context);

    await addSpaceAccount(space.systemAction(), {
        spaceId: space.id,
        accountId: memberAccount.id,
        role: "Member",
        withoutInviteForTest: true,
    });

    await addSpaceAccount(space.systemAction(), {
        spaceId: space.id,
        accountId: adminAccount.id,
        role: "Admin",
        withoutInviteForTest: true,
    });

    await expect(
        addSpaceAccount(space.systemAction(), {
            spaceId: space.id,
            accountId: ownerAccount.id,
            role: "Owner",
            withoutInviteForTest: true,
        }),
    ).rejects.toThrow("Space already has an owner");
});

test("don\u2019t allow creating multiple owners in a single space (with impersonated account actor)", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const memberAccount = await TestAccount.create(context);
    const adminAccount = await TestAccount.create(context);
    const ownerAccount = await TestAccount.create(context);

    await addSpaceAccount(space.impersonatedAction(ownerSession), {
        spaceId: space.id,
        accountId: memberAccount.id,
        role: "Member",
        withoutInviteForTest: true,
    });

    await addSpaceAccount(space.impersonatedAction(ownerSession), {
        spaceId: space.id,
        accountId: adminAccount.id,
        role: "Admin",
        withoutInviteForTest: true,
    });

    await expect(
        addSpaceAccount(space.impersonatedAction(ownerSession), {
            spaceId: space.id,
            accountId: ownerAccount.id,
            role: "Owner",
            withoutInviteForTest: true,
        }),
    ).rejects.toThrow("Space already has an owner");
});

test("don\u2019t allow creating multiple owners in a single space (with test scenario framework)", async () => {
    const space = await TestSpace.create(context);
    await space.createSession({role: "Owner"});

    // try to add a new member role again to the space which is already owned by the
    // owner
    await space.createSession({role: "Member"});

    // try to add a new member role again to the space which is already owned by the
    // owner
    await space.createSession({role: "Admin"});

    // try to add owner again to the space which is already owned by the owner
    await expect(space.createSession({role: "Owner"})).rejects.toThrow(
        "Space already has an owner",
    );
});

test("`addSpaceAccount()` should throw if anonymous account tries to add account", async () => {
    const space = await TestSpace.create(context);
    const otherAccount = await TestAccount.create(context);

    // anonymous account
    await expect(
        addSpaceAccount(context.anonymousAction(), {
            spaceId: space.id,
            accountId: otherAccount.id,
            withoutInviteForTest: true,
        }),
    ).rejects.toThrow(UnauthenticatedError);
});

test("`addSpaceAccount()` should throw if system actor for another space tries to add account", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const otherAccount = await TestAccount.create(context);

    await expect(
        addSpaceAccount(otherSpace.systemAction(), {
            spaceId: space.id,
            accountId: otherAccount.id,
            withoutInviteForTest: true,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("`addSpaceAccount()` should work if system actor for space tries to add account", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const otherAccount = await TestAccount.create(context);

    // system actor is trying top add `otherAccount.id` to `space.id`
    await addSpaceAccount(space.systemAction(), {
        spaceId: space.id,
        accountId: otherAccount.id,
        withoutInviteForTest: true,
    });

    const account = await getAccountIfExists(ownerSession.action(), space.id, otherAccount.id);
    expect(account).toBeDefined();
    expect(account?.initialData.space.role).toBe("Member");
});

test("`addSpaceAccount()` can\u2019t add the same account to the space twice", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const otherAccount = await TestAccount.create(context);

    await addSpaceAccount(ownerSession.action(), {
        spaceId: space.id,
        accountId: otherAccount.id,
        withoutInviteForTest: true,
    });

    await expect(
        addSpaceAccount(ownerSession.action(), {
            spaceId: space.id,
            accountId: otherAccount.id,
            withoutInviteForTest: true,
        }),
    ).rejects.toThrow("Account is already a member of space");

    const account = await getAccountIfExists(ownerSession.action(), space.id, otherAccount.id);
    expect(account).toBeDefined();
    expect(account?.initialData.space.role).toBe("Member");
});

test("`addSpaceAccount()` can\u2019t add an account that is already a member", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const alreadyMember = await space.createSession();

    await expect(
        addSpaceAccount(ownerSession.action(), {
            spaceId: space.id,
            accountId: alreadyMember.account.id,
        }),
    ).rejects.toThrow(FailedPreconditionError);
});

test("`addSpaceAccount()` can\u2019t add an account that is already invited", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const email = generateEmailAddressForTest();
    const invitedAccount = await ownerSession.inviteEmailAddress(email);

    await expect(
        addSpaceAccount(ownerSession.action(), {
            spaceId: space.id,
            accountId: invitedAccount.id,
        }),
    ).rejects.toThrow(FailedPreconditionError);
});

test("`addSpaceAccount()` can\u2019t add an account that doesn\u2019t exist", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});

    await expect(
        addSpaceAccount(ownerSession.action(), {
            spaceId: space.id,
            accountId: generateId(),
            withoutInviteForTest: true,
        }),
    ).rejects.toThrow("Account not found");
});

test("`addSpaceAccount()` should throw if impersonated account member in another space tries to add account", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);

    const memberSession = await otherSpace.createSession({role: "Member"});
    const otherAccount = await TestAccount.create(context);

    // impersonated account from other space tries to add account to `space.id`
    await expect(
        addSpaceAccount(
            context.impersonatedAccountAction(otherSpace.id, memberSession.account.id),
            {
                spaceId: space.id,
                accountId: otherAccount.id,
                withoutInviteForTest: true,
            },
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("`addSpaceAccount()` should throw if impersonated account (`Admin`) in another space tries to add account", async () => {
    const space = await TestSpace.create(context);

    const otherSpace = await TestSpace.create(context);
    const adminSession = await otherSpace.createSession({role: "Admin"});
    const otherAccount = await TestAccount.create(context);

    await expect(
        addSpaceAccount(context.impersonatedAccountAction(otherSpace.id, adminSession.account.id), {
            spaceId: space.id,
            accountId: otherAccount.id,
            withoutInviteForTest: true,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("`addSpaceAccount()` should throw if impersonated account (`Member`) for space tries to add account", async () => {
    const space = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});
    const otherAccount = await TestAccount.create(context);

    await expect(
        addSpaceAccount(context.impersonatedAccountAction(space.id, memberSession.account.id), {
            spaceId: space.id,
            accountId: otherAccount.id,
            withoutInviteForTest: true,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("`addSpaceAccount()`should work if impersonated account (`Admin`) for space tries to add account", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const adminSession = await space.createSession({role: "Admin"});
    const otherAccount = await TestAccount.create(context);

    await addSpaceAccount(context.impersonatedAccountAction(space.id, adminSession.account.id), {
        spaceId: space.id,
        accountId: otherAccount.id,
        withoutInviteForTest: true,
    });

    const account = await getAccountIfExists(ownerSession.action(), space.id, otherAccount.id);
    expect(account).toBeDefined();
    expect(account?.initialData.space.role).toBe("Member");
});

test("`addSpaceAccount()` should throw if account (`Member`) in another space tries to add account", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const memberSession = await otherSpace.createSession({role: "Member"});
    const otherAccount = await TestAccount.create(context);

    await expect(
        addSpaceAccount(memberSession.action(), {
            spaceId: space.id,
            accountId: otherAccount.id,
            withoutInviteForTest: true,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("`addSpaceAccount()` should throw if account (`Admin`) in another space tries to add account", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const adminSession = await otherSpace.createSession({role: "Admin"});
    const otherAccount = await TestAccount.create(context);

    await expect(
        addSpaceAccount(adminSession.action(), {
            spaceId: space.id,
            accountId: otherAccount.id,
            withoutInviteForTest: true,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("`addSpaceAccount()` should throw if account member for space tries to add account", async () => {
    const space = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});
    const otherAccount = await TestAccount.create(context);

    await expect(
        addSpaceAccount(memberSession.action(), {
            spaceId: space.id,
            accountId: otherAccount.id,
            withoutInviteForTest: true,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("`addSpaceAccount()` should work if account admin for space tries to add account", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const adminSession = await space.createSession({role: "Admin"});
    const otherAccount = await TestAccount.create(context);

    await addSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: otherAccount.id,
        withoutInviteForTest: true,
    });

    const account = await getAccountIfExists(ownerSession.action(), space.id, otherAccount.id);
    expect(account).toBeDefined();
    expect(account?.initialData.space.role).toBe("Member");
});

test("`removeSpaceAccount()` should work if account (`Admin`) for space tries to remove account", async () => {
    const space = await TestSpace.create(context);

    const [adminSession, session1, session2] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        space.createSession(),
    ]);

    expect(await isMember(space, adminSession)).toEqual(true);
    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);

    await removeSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: session1.account.id,
    });

    expect(await isMember(space, adminSession)).toEqual(true);
    expect(await isMember(space, session1)).toEqual(false);
    expect(await isMember(space, session2)).toEqual(true);

    await removeSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await isMember(space, adminSession)).toEqual(true);
    expect(await isMember(space, session1)).toEqual(false);
    expect(await isMember(space, session2)).toEqual(false);

    // remove admin account
    await expect(
        removeSpaceAccount(adminSession.action(), {
            spaceId: space.id,
            accountId: adminSession.account.id,
        }),
    ).rejects.toThrow("Can\u2019t remove your own account from space");

    expect(await isMember(space, adminSession)).toEqual(true);
    expect(await isMember(space, session1)).toEqual(false);
    expect(await isMember(space, session2)).toEqual(false);
});

test("`removeSpaceAccount()` should work if account (`Admin`) for space tries to remove admin account", async () => {
    const space = await TestSpace.create(context);

    const [adminSession, session1, session2] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession({role: "Admin"}),
        space.createSession(),
    ]);

    expect(await isMember(space, adminSession)).toEqual(true);
    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);

    await removeSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: session1.account.id,
    });

    expect(await isMember(space, adminSession)).toEqual(true);
    expect(await isMember(space, session1)).toEqual(false);
    expect(await isMember(space, session2)).toEqual(true);

    expect((await session1.get()).initialData.space.role).toEqual("Member");
});

test("`removeSpaceAccount()` should work if account (`Owner`) for space tries to remove account", async () => {
    const space = await TestSpace.create(context);

    const ownerSession = await space.createSession({role: "Owner"});
    const [adminSession, session1, session2] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        space.createSession(),
    ]);

    expect(await isMember(space, ownerSession)).toEqual(true);
    expect(await isMember(space, adminSession)).toEqual(true);
    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);

    await removeSpaceAccount(ownerSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
    });

    expect(await isMember(space, ownerSession)).toEqual(true);
    expect(await isMember(space, adminSession)).toEqual(false);
    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);

    await removeSpaceAccount(ownerSession.action(), {
        spaceId: space.id,
        accountId: session1.account.id,
    });

    expect(await isMember(space, ownerSession)).toEqual(true);
    expect(await isMember(space, adminSession)).toEqual(false);
    expect(await isMember(space, session1)).toEqual(false);
    expect(await isMember(space, session2)).toEqual(true);

    await removeSpaceAccount(ownerSession.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await isMember(space, ownerSession)).toEqual(true);
    expect(await isMember(space, adminSession)).toEqual(false);
    expect(await isMember(space, session1)).toEqual(false);
    expect(await isMember(space, session2)).toEqual(false);
});

test("`removeSpaceAccount()` should throw if account (`Member`) for space tries to remove account", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, session3, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    await expect(
        removeSpaceAccount(session2.action(), {
            spaceId: space.id,
            accountId: session3.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);
});

test("`removeSpaceAccount()` should throw if account (`Owner`) for space tries to remove account", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const ownerSession = await space.createSession({role: "Owner"});
    const [adminSession, session1, session2, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    // initial state
    expect(await isMember(space, ownerSession)).toEqual(true);
    expect(await isMember(space, adminSession)).toEqual(true);
    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, ownerSession)).toEqual(false);
    expect(await isMember(otherSpace, adminSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    // admin tries to remove owner's account
    await expect(
        removeSpaceAccount(adminSession.action(), {
            spaceId: space.id,
            accountId: ownerSession.account.id,
        }),
    ).rejects.toThrow(FailedPreconditionError);

    expect(await isMember(space, ownerSession)).toEqual(true);
    expect(await isMember(space, adminSession)).toEqual(true);
    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, ownerSession)).toEqual(false);
    expect(await isMember(otherSpace, adminSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    // member tries to remove owner's account
    await expect(
        removeSpaceAccount(session1.action(), {
            spaceId: space.id,
            accountId: ownerSession.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await isMember(space, ownerSession)).toEqual(true);
    expect(await isMember(space, adminSession)).toEqual(true);
    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, ownerSession)).toEqual(false);
    expect(await isMember(otherSpace, adminSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    // owner tries to remove owner's account
    await expect(
        removeSpaceAccount(ownerSession.action(), {
            spaceId: space.id,
            accountId: ownerSession.account.id,
        }),
    ).rejects.toThrow("Can\u2019t remove your own account from space");

    expect(await isMember(space, ownerSession)).toEqual(true);
    expect(await isMember(space, adminSession)).toEqual(true);
    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, ownerSession)).toEqual(false);
    expect(await isMember(otherSpace, adminSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);
});

test("`removeSpaceAccount()` should throw if account (`Admin`) for space tries to remove account from space that doesn\u2019t exist", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, session3, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    await expect(
        removeSpaceAccount(session1.action(), {
            spaceId: generateId(),
            accountId: session2.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);
});

test("`removeSpaceAccount()` should throw if account (`Admin`) for space tries to remove account that doesn\u2019t exist", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, session3, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    await expect(
        removeSpaceAccount(session1.action(), {
            spaceId: space.id,
            accountId: generateId(),
        }),
    ).rejects.toThrow(NotFoundError);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);
});

test("`removeSpaceAccount()` should throw if account (`Admin`) for space tries to remove account that account is not a member of", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, session3, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    await expect(
        removeSpaceAccount(session1.action(), {
            spaceId: otherSpace.id,
            accountId: session2.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);
});

test("`removeSpaceAccount()` should throw if account (`Admin`) for space tries to remove account that\u2019s already been removed", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, session3, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    await removeSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(false);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    await expect(
        removeSpaceAccount(session1.action(), {
            spaceId: space.id,
            accountId: session2.account.id,
        }),
    ).rejects.toThrow(FailedPreconditionError);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(false);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);
});

test("`removeSpaceAccount()` should update the account\u2019s space ids", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, session3, otherSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession(),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    // Initial state
    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    expect(Array.from((await getOurAccountSpaceIds(session1.action())).spaceIds)).toEqual([
        space.id,
    ]);
    expect(Array.from((await getOurAccountSpaceIds(session2.action())).spaceIds)).toEqual([
        space.id,
    ]);
    expect(Array.from((await getOurAccountSpaceIds(session3.action())).spaceIds)).toEqual([
        space.id,
    ]);
    expect(Array.from((await getOurAccountSpaceIds(otherSession.action())).spaceIds)).toEqual([
        otherSpace.id,
    ]);

    // Remove session2 from space
    await removeSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(false);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    expect(Array.from((await getOurAccountSpaceIds(session1.action())).spaceIds)).toEqual([
        space.id,
    ]);
    expect(Array.from((await getOurAccountSpaceIds(session2.action())).spaceIds)).toEqual([]);
    expect(Array.from((await getOurAccountSpaceIds(session3.action())).spaceIds)).toEqual([
        space.id,
    ]);
    expect(Array.from((await getOurAccountSpaceIds(otherSession.action())).spaceIds)).toEqual([
        otherSpace.id,
    ]);

    // Add otherSession to space
    const otherSessionEmailAddress = await otherSession.account.createEmailAddress();

    await inviteEmailAddressesToSpace(session1.action(), {
        spaceId: space.id,
        emailAddresses: [otherSessionEmailAddress],
    });

    await acceptSpaceAccountInvite(otherSession.action(), space.id);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(false);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(true);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    expect(Array.from((await getOurAccountSpaceIds(session1.action())).spaceIds)).toEqual([
        space.id,
    ]);
    expect(Array.from((await getOurAccountSpaceIds(session2.action())).spaceIds)).toEqual([]);
    expect(Array.from((await getOurAccountSpaceIds(session3.action())).spaceIds)).toEqual([
        space.id,
    ]);
    expect(Array.from((await getOurAccountSpaceIds(otherSession.action())).spaceIds)).toEqual([
        otherSpace.id,
        space.id,
    ]);

    // Remove otherSession from space
    await removeSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: otherSession.account.id,
    });

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(false);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    expect(Array.from((await getOurAccountSpaceIds(session1.action())).spaceIds)).toEqual([
        space.id,
    ]);
    expect(Array.from((await getOurAccountSpaceIds(session2.action())).spaceIds)).toEqual([]);
    expect(Array.from((await getOurAccountSpaceIds(session3.action())).spaceIds)).toEqual([
        space.id,
    ]);
    expect(Array.from((await getOurAccountSpaceIds(otherSession.action())).spaceIds)).toEqual([
        otherSpace.id,
    ]);

    // Add session2 back to space
    await addSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
        withoutInviteForTest: true,
    });

    await acceptSpaceAccountInvite(session2.action(), space.id);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    expect(Array.from((await getOurAccountSpaceIds(session1.action())).spaceIds)).toEqual([
        space.id,
    ]);
    expect(Array.from((await getOurAccountSpaceIds(session2.action())).spaceIds)).toEqual([
        space.id,
    ]);
    expect(Array.from((await getOurAccountSpaceIds(session3.action())).spaceIds)).toEqual([
        space.id,
    ]);
    expect(Array.from((await getOurAccountSpaceIds(otherSession.action())).spaceIds)).toEqual([
        otherSpace.id,
    ]);
});

test("`removeSpaceAccount()` should throw if anonymous account tries to remove account", async () => {
    const space = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});

    await expect(
        removeSpaceAccount(context.anonymousAction(), {
            spaceId: space.id,
            accountId: memberSession.account.id,
        }),
    ).rejects.toThrow(UnauthenticatedError);
});

test("`removeSpaceAccount()` should throw if system actor for another space tries to remove account", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});

    await expect(
        removeSpaceAccount(otherSpace.systemAction(), {
            spaceId: space.id,
            accountId: memberSession.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("`removeSpaceAccount()` should work if system actor for space tries to remove account", async () => {
    const space = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});

    expect(await isMember(space, memberSession)).toEqual(true);

    await removeSpaceAccount(space.systemAction(), {
        spaceId: space.id,
        accountId: memberSession.account.id,
    });

    expect(await isMember(space, memberSession)).toEqual(false);
});

test("`removeSpaceAccount()` should throw if impersonated account (`Member`) in another space tries to remove account", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});
    const otherMemberSession = await otherSpace.createSession({role: "Member"});

    await expect(
        removeSpaceAccount(
            context.impersonatedAccountAction(otherSpace.id, otherMemberSession.account.id),
            {
                spaceId: space.id,
                accountId: memberSession.account.id,
            },
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("`removeSpaceAccount()` should throw if impersonated account (`Admin`) in another space tries to remove account", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});
    const otherAdminSession = await otherSpace.createSession({role: "Admin"});

    await expect(
        removeSpaceAccount(
            context.impersonatedAccountAction(otherSpace.id, otherAdminSession.account.id),
            {
                spaceId: space.id,
                accountId: memberSession.account.id,
            },
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("`removeSpaceAccount()` should throw if impersonated account (`Member`) for space tries to remove account", async () => {
    const space = await TestSpace.create(context);
    const memberSession1 = await space.createSession({role: "Member"});
    const memberSession2 = await space.createSession({role: "Member"});

    await expect(
        removeSpaceAccount(context.impersonatedAccountAction(space.id, memberSession1.account.id), {
            spaceId: space.id,
            accountId: memberSession2.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("`removeSpaceAccount()` should work if impersonated account (`Admin`) for space tries to remove account", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});

    expect(await isMember(space, memberSession)).toEqual(true);

    await removeSpaceAccount(context.impersonatedAccountAction(space.id, adminSession.account.id), {
        spaceId: space.id,
        accountId: memberSession.account.id,
    });

    expect(await isMember(space, memberSession)).toEqual(false);
});

test("`removeSpaceAccount()` should throw if account (`Member`) in another space tries to remove account", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});
    const otherMemberSession = await otherSpace.createSession({role: "Member"});

    await expect(
        removeSpaceAccount(otherMemberSession.action(), {
            spaceId: space.id,
            accountId: memberSession.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("`removeSpaceAccount()` should throw if account (`Admin`) in another space tries to remove account", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});
    const otherAdminSession = await otherSpace.createSession({role: "Admin"});

    await expect(
        removeSpaceAccount(otherAdminSession.action(), {
            spaceId: space.id,
            accountId: memberSession.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("`isAccountMemberOfSpaceWithoutAuthorization()` should fall through cache layers when expected role doesn\u2019t match", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const memberSession = await space.createSession({role: "Member"});

    // First, populate the cache by calling expensivelyGetAllSpaceAccounts
    await expensivelyGetAllSpaceAccounts(memberSession.action(), space.id);

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();

    // Verify the function works with the cached data
    const isMemberResult1 = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Member",
    );
    expect(isMemberResult1).toBe(true);

    // Now check what's in the cache - should have the Member role

    const cachedDataBefore =
        await spaceAccountsCache.dangerouslyGetDataIfExistsWithoutLoadingOrAuthorizing(
            context.withCache(),
            space.id,
        );

    const cachedAccountBefore = cachedDataBefore?.accountById.get(memberSession.account.id);
    expect(cachedAccountBefore?.initialData.space.role).toBe("Member"); // Cache has Member role

    // Update the member's role to Admin directly in the database
    await updateSpaceAccountRole(ownerSession.action(), {
        spaceId: space.id,
        accountId: memberSession.account.id,
        role: "Admin",
    });

    // Check cache again - should still have the old Member role (cache is stale)
    const cachedDataAfter =
        await spaceAccountsCache.dangerouslyGetDataIfExistsWithoutLoadingOrAuthorizing(
            context.withCache(),
            space.id,
        );

    const cachedAccountAfter = cachedDataAfter?.accountById.get(memberSession.account.id);
    expect(cachedAccountAfter?.initialData.space.role).toBe("Member"); // Cache still has old role

    dynamoClientExecuteActionTestCounter.resetForTest();
    dynamoClientGetItemTestCounter.resetForTest();

    expect(getCount()).toEqual(0);
    // Now check if the function correctly identifies the account has Admin role
    // Despite the cache showing "Member", this should return true because the function
    // falls through to more authoritative sources(i.e. strong consistency)
    const functionResult = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Admin",
    );

    // this actually shows that there was a db hit during this function call. This
    // proves the function went beyond the stale cache to find the real role
    expect(getCount()).toEqual(1);
    expect(functionResult).toBe(true);

    // Double-check: cache still shows old role, but function found new role
    expect(cachedAccountAfter?.initialData.space.role).toBe("Member");
    expect(functionResult).toBe(true);

    // Verify it also works for Member role check (Admin includes Member permissions)
    const memberCheck = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Member",
    );
    expect(memberCheck).toBe(true);

    // Should return false for Owner role check
    const ownerCheck = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Owner",
    );
    expect(ownerCheck).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization()` should return true early when role matches in cache", async () => {
    const space = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});

    // First, populate the cache by calling expensivelyGetAllSpaceAccounts
    await expensivelyGetAllSpaceAccounts(memberSession.action(), space.id);

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();
    dynamoClientGetItemTestCounter.resetForTest();

    expect(getCount()).toEqual(0);
    // This should return true from cache without hitting the database
    const isMemberResult = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Member",
    );
    expect(isMemberResult).toBe(true);

    // Should not have made additional database calls since cache hit with matching
    // role
    expect(getCount()).toEqual(0);
});

test("`isAccountMemberOfSpaceWithoutAuthorization()` should return false only after checking all cached levels for role", async () => {
    const space = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});

    // Populate cache with Member role
    await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Member",
    );

    // Try to check for Owner role - should fall through all levels and return false
    const isMemberResult = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Owner",
    );
    expect(isMemberResult).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization()` should return false only after checking all cached levels for state InvitePending", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const email = generateEmailAddressForTest();
    const invitedAccount = await ownerSession.inviteEmailAddress(email);

    // Populate cache with Member role
    await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        invitedAccount.id,
    );

    // Try to check for Owner role - should fall through all levels and return false
    const isMemberResult = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        invitedAccount.id,
    );
    expect(isMemberResult).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization()` should return false only after checking all cached levels for state Removed", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const memberSession = await space.createSession({
        role: "Member",
    });

    await removeSpaceAccount(ownerSession.action(), {
        spaceId: space.id,
        accountId: memberSession.account.id,
    });

    // Populate cache with Member role
    await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Member",
    );

    // Try to check for Owner role - should fall through all levels and return false
    const isMemberResult = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Owner",
    );
    expect(isMemberResult).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization()` should handle removed accounts correctly during fallthrough", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"}); // Automatically available!
    const memberSession = await space.createSession({role: "Member"});

    // Populate cache with active member
    await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Member",
    );

    // Remove the account from the space
    await removeSpaceAccount(ownerSession.action(), {
        spaceId: space.id,
        accountId: memberSession.account.id,
    });

    // Clear space accounts cache but keep context cache with stale data
    spaceAccountsCache.clearForTest();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();
    dynamoClientGetItemTestCounter.resetForTest();

    expect(getCount()).toEqual(0);

    const isMemberResult = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
    );
    expect(isMemberResult).toBe(false);

    // this shows that there were 2 db hits during this function call hence the
    // function did not returned stale data
    expect(getCount()).toEqual(2);
});
///

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId)` returns false for accountId that\u2019s a \u2018Member\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const memberSession = await otherSpace.createSession({role: "Member"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId)` returns false for accountId that\u2019s an \u2018Admin\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const adminSession = await otherSpace.createSession({role: "Admin"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        adminSession.account.id,
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId)` returns false for accountId that\u2019s an \u2018Owner\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const otherOwnerSession = await otherSpace.createSession({role: "Owner"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        otherOwnerSession.account.id,
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId)` returns true for accountId that\u2019s a \u2018Member\u2019 of spaceId", async () => {
    const space = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
    );
    expect(result).toBe(true);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId)` returns true for accountId that\u2019s an \u2018Admin\u2019 of spaceId", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        adminSession.account.id,
    );
    expect(result).toBe(true);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId)` returns true for accountId that\u2019s an \u2018Owner\u2019 of spaceId", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        ownerSession.account.id,
    );
    expect(result).toBe(true);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId)` returns true for accountId that\u2019s a \u2018Member\u2019 of spaceId and \u2018Member\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession({role: "Member"});
    await otherSpace.addAccount(session.account, "Member");

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        session.account.id,
    );
    expect(result).toBe(true);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId)` returns true for accountId that\u2019s a \u2018Member\u2019 of spaceId and \u2018Admin\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Member"});

    expect((await getOurAccountSpaceIds(session.action())).spaceIds).toEqual(new Set([space.id]));

    const otherSpace = await TestSpace.create(context);

    await otherSpace.addAccount(session.account, "Admin");

    expect((await getOurAccountSpaceIds(session.action())).spaceIds).toEqual(
        new Set([space.id, otherSpace.id]),
    );

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        session.account.id,
    );
    expect(result).toBe(true);

    const result2 = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        otherSpace.id,
        session.account.id,
        "Admin",
    );
    expect(result2).toBe(true);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId)` returns true for accountId that\u2019s a \u2018Member\u2019 of spaceId and \u2018Owner\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const otherOwnerSession = await otherSpace.createSession({role: "Owner"});
    const session = await space.createSession({role: "Member"});
    await otherSpace.addAccount(session.account, "Member");

    // Move ownership to session account
    await moveSpaceAccountOwnerRole(otherOwnerSession.action(), {
        spaceId: otherSpace.id,
        newOwnerAccountId: session.account.id,
    });

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        session.account.id,
    );
    expect(result).toBe(true);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Member\u2019)` returns false for accountId that\u2019s a \u2018Member\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const memberSession = await otherSpace.createSession({role: "Member"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Member",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Member\u2019)` returns false for accountId that\u2019s an \u2018Admin\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const adminSession = await otherSpace.createSession({role: "Admin"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        adminSession.account.id,
        "Member",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Member\u2019)` returns false for accountId that\u2019s an \u2018Owner\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const otherOwnerSession = await otherSpace.createSession({role: "Owner"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        otherOwnerSession.account.id,
        "Member",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Member\u2019)` returns true for accountId that\u2019s a \u2018Member\u2019 of spaceId", async () => {
    const space = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Member",
    );
    expect(result).toBe(true);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Member\u2019)` returns true for accountId that\u2019s an \u2018Admin\u2019 of spaceId", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        adminSession.account.id,
        "Member",
    );
    expect(result).toBe(true);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Member\u2019)` returns true for accountId that\u2019s an \u2018Owner\u2019 of spaceId", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        ownerSession.account.id,
        "Member",
    );
    expect(result).toBe(true);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Member\u2019)` returns true for accountId that\u2019s a \u2018Member\u2019 of spaceId and \u2018Member\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession({role: "Member"});
    await otherSpace.addAccount(session.account, "Member");

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        session.account.id,
        "Member",
    );
    expect(result).toBe(true);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Member\u2019)` returns true for accountId that\u2019s a \u2018Member\u2019 of spaceId and \u2018Admin\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession({role: "Member"});

    await otherSpace.addAccount(session.account, "Admin");

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        session.account.id,
        "Member",
    );
    expect(result).toBe(true);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Member\u2019)` returns true for accountId that\u2019s a \u2018Member\u2019 of spaceId and \u2018Owner\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const otherOwnerSession = await otherSpace.createSession({role: "Owner"});
    const session = await space.createSession({role: "Member"});
    await otherSpace.addAccount(session.account, "Member");

    // Move ownership to session account
    await moveSpaceAccountOwnerRole(otherOwnerSession.action(), {
        spaceId: otherSpace.id,
        newOwnerAccountId: session.account.id,
    });

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        session.account.id,
        "Member",
    );
    expect(result).toBe(true);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Admin\u2019)` returns false for accountId that\u2019s a \u2018Member\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const memberSession = await otherSpace.createSession({role: "Member"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Admin",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Admin\u2019)` returns false for accountId that\u2019s an \u2018Admin\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const adminSession = await otherSpace.createSession({role: "Admin"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        adminSession.account.id,
        "Admin",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Admin\u2019)` returns false for accountId that\u2019s an \u2018Owner\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const otherOwnerSession = await otherSpace.createSession({role: "Owner"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        otherOwnerSession.account.id,
        "Admin",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Admin\u2019)` returns false for accountId that\u2019s a \u2018Member\u2019 of spaceId", async () => {
    const space = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Admin",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Admin\u2019)` returns true for accountId that\u2019s an \u2018Admin\u2019 of spaceId", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        adminSession.account.id,
        "Admin",
    );
    expect(result).toBe(true);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Admin\u2019)` returns true for accountId that\u2019s an \u2018Owner\u2019 of spaceId", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        ownerSession.account.id,
        "Admin",
    );
    expect(result).toBe(true);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Admin\u2019)` returns false for accountId that\u2019s a \u2018Member\u2019 of spaceId and \u2018Member\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession({role: "Member"});
    await otherSpace.addAccount(session.account, "Member");

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        session.account.id,
        "Admin",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Admin\u2019)` returns false for accountId that\u2019s a \u2018Member\u2019 of spaceId and \u2018Admin\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession({role: "Member"});
    await otherSpace.addAccount(session.account, "Admin");

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        session.account.id,
        "Admin",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Admin\u2019)` returns false for accountId that\u2019s a \u2018Member\u2019 of spaceId and \u2018Owner\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const otherOwnerSession = await otherSpace.createSession({role: "Owner"});
    const session = await space.createSession({role: "Member"});
    await otherSpace.addAccount(session.account, "Member");

    // Move ownership to session account
    await moveSpaceAccountOwnerRole(otherOwnerSession.action(), {
        spaceId: otherSpace.id,
        newOwnerAccountId: session.account.id,
    });

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        session.account.id,
        "Admin",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Owner\u2019)` returns false for accountId that\u2019s a \u2018Member\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const memberSession = await otherSpace.createSession({role: "Member"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Owner",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Owner\u2019)` returns false for accountId that\u2019s an \u2018Admin\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const adminSession = await otherSpace.createSession({role: "Admin"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        adminSession.account.id,
        "Owner",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Owner\u2019)` returns false for accountId that\u2019s an \u2018Owner\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const otherOwnerSession = await otherSpace.createSession({role: "Owner"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        otherOwnerSession.account.id,
        "Owner",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Owner\u2019)` returns false for accountId that\u2019s a \u2018Member\u2019 of spaceId", async () => {
    const space = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        memberSession.account.id,
        "Owner",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Owner\u2019)` returns false for accountId that\u2019s an \u2018Admin\u2019 of spaceId", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        adminSession.account.id,
        "Owner",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Owner\u2019)` returns true for accountId that\u2019s an \u2018Owner\u2019 of spaceId", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        ownerSession.account.id,
        "Owner",
    );
    expect(result).toBe(true);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Owner\u2019)` returns false for accountId that\u2019s a \u2018Member\u2019 of spaceId and \u2018Member\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession({role: "Member"});
    await otherSpace.addAccount(session.account, "Member");

    expect((await getOurAccountSpaceIds(session.action())).spaceIds).toEqual(
        new Set([space.id, otherSpace.id]),
    );

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        session.account.id,
        "Owner",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Owner\u2019)` returns false for accountId that\u2019s a \u2018Member\u2019 of spaceId and \u2018Admin\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession({role: "Member"});
    await otherSpace.addAccount(session.account, "Admin");

    expect((await getOurAccountSpaceIds(session.action())).spaceIds).toEqual(
        new Set([space.id, otherSpace.id]),
    );

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        session.account.id,
        "Owner",
    );
    expect(result).toBe(false);
});

test("`isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId, \u2018Owner\u2019)` returns false for accountId that\u2019s a \u2018Member\u2019 of spaceId and \u2018Owner\u2019 of otherSpaceId", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const otherOwnerSession = await otherSpace.createSession({role: "Owner"});
    const session = await space.createSession({role: "Member"});
    await otherSpace.addAccount(session.account, "Member");

    // Move ownership to session account
    await moveSpaceAccountOwnerRole(otherOwnerSession.action(), {
        spaceId: otherSpace.id,
        newOwnerAccountId: session.account.id,
    });

    const result = await isAccountMemberOfSpaceWithoutAuthorization(
        context.withCache(),
        space.id,
        session.account.id,
        "Owner",
    );
    expect(result).toBe(false);
});

// updateSpaceAccountRole()
test("`updateSpaceAccountRole()` successfully updates member role to admin", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const [adminSession, memberSession1, memberSession2, memberSession3] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession({role: "Member"}),
        space.createSession({role: "Member"}),
        space.createSession({role: "Member"}),
    ]);

    // Verify initial roles
    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await adminSession.get()).initialData.space.role).toBe("Admin");
    expect((await memberSession1.get()).initialData.space.role).toBe("Member");
    expect((await memberSession2.get()).initialData.space.role).toBe("Member");

    // Update member to admin by owner
    await updateSpaceAccountRole(ownerSession.action(), {
        spaceId: space.id,
        accountId: memberSession1.account.id,
        role: "Admin",
    });

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await adminSession.get()).initialData.space.role).toBe("Admin");
    expect((await memberSession1.get()).initialData.space.role).toBe("Admin");
    expect((await memberSession2.get()).initialData.space.role).toBe("Member");

    // Update member to admin by admin
    await updateSpaceAccountRole(adminSession.action(), {
        spaceId: space.id,
        accountId: memberSession2.account.id,
        role: "Admin",
    });

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await adminSession.get()).initialData.space.role).toBe("Admin");
    expect((await memberSession1.get()).initialData.space.role).toBe("Admin");
    expect((await memberSession2.get()).initialData.space.role).toBe("Admin");

    // system actor for space tries to update role of Member to Admin
    await updateSpaceAccountRole(space.systemAction(), {
        spaceId: space.id,
        accountId: memberSession3.account.id,
        role: "Admin",
    });

    expect((await memberSession3.get()).initialData.space.role).toBe("Admin");
});

test("`updateSpaceAccountRole()` successfully updates admin role to member", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const [adminSession1, adminSession2, adminSession3] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession({role: "Admin"}),
        space.createSession({role: "Admin"}),
    ]);

    // Verify initial roles
    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await adminSession1.get()).initialData.space.role).toBe("Admin");
    expect((await adminSession2.get()).initialData.space.role).toBe("Admin");

    // Update admin to member by admin
    await updateSpaceAccountRole(adminSession1.action(), {
        spaceId: space.id,
        accountId: adminSession2.account.id,
        role: "Member",
    });

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await adminSession1.get()).initialData.space.role).toBe("Admin");
    expect((await adminSession2.get()).initialData.space.role).toBe("Member");

    // Update admin to member by owner
    await updateSpaceAccountRole(ownerSession.action(), {
        spaceId: space.id,
        accountId: adminSession1.account.id,
        role: "Member",
    });

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await adminSession1.get()).initialData.space.role).toBe("Member");
    expect((await adminSession2.get()).initialData.space.role).toBe("Member");

    expect((await adminSession3.get()).initialData.space.role).toBe("Admin");

    await updateSpaceAccountRole(space.systemAction(), {
        spaceId: space.id,
        accountId: adminSession3.account.id,
        role: "Member",
    });

    expect((await adminSession3.get()).initialData.space.role).toBe("Member");
});

test("`updateSpaceAccountRole()` throws error when attempting to modify an account with state InvitePending", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const email = generateEmailAddressForTest();
    const invitedAccount = await ownerSession.inviteEmailAddress(email);

    // owner tries to update invite pending account's role
    await expect(
        updateSpaceAccountRole(ownerSession.action(), {
            spaceId: space.id,
            accountId: invitedAccount.id,
            role: "Admin",
        }),
    ).rejects.toThrow(NotFoundError);

    const invitedAccountData = await getSpaceAccountForTest(
        context.systemAction(space.id),
        space.id,
        invitedAccount.id,
    );

    expect(invitedAccountData?.role).toBe("Member");
});

test("`updateSpaceAccountRole()` throws error when attempting to modify an account with state Removed", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const removedAccount = await space.createSession();

    await removeSpaceAccount(ownerSession.action(), {
        spaceId: space.id,
        accountId: removedAccount.account.id,
    });

    // owner tries to update invite pending account's role
    await expect(
        updateSpaceAccountRole(ownerSession.action(), {
            spaceId: space.id,
            accountId: removedAccount.account.id,
            role: "Admin",
        }),
    ).rejects.toThrow(NotFoundError);

    expect((await removedAccount.get()).initialData.space.role).toBe("Member");
});

test("`updateSpaceAccountRole()` throws error when attempting to modify owner\u2019s role", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const adminSession = await space.createSession({role: "Admin"});

    // Verify initial role
    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await adminSession.get()).initialData.space.role).toBe("Admin");

    // admin tries to update owner's role
    await expect(
        updateSpaceAccountRole(adminSession.action(), {
            spaceId: space.id,
            accountId: ownerSession.account.id,
            role: "Admin",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await adminSession.get()).initialData.space.role).toBe("Admin");

    // owner tries to update owner's role
    await expect(
        updateSpaceAccountRole(ownerSession.action(), {
            spaceId: space.id,
            accountId: ownerSession.account.id,
            role: "Admin",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await adminSession.get()).initialData.space.role).toBe("Admin");
});

test("`updateSpaceAccountRole()` throws error when space does not exist", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const memberSession = await space.createSession({role: "Member"});

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await memberSession.get()).initialData.space.role).toBe("Member");

    await expect(
        updateSpaceAccountRole(ownerSession.action(), {
            spaceId: generateId<SpaceId>(),
            accountId: memberSession.account.id,
            role: "Admin",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await memberSession.get()).initialData.space.role).toBe("Member");
});

test("`updateSpaceAccountRole()` throws error when accountId is not a member of spaceId", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const nonMemberAccountId = generateId<AccountId>();

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");

    // when accountId is not a member of spaceId
    await expect(
        updateSpaceAccountRole(ownerSession.action(), {
            spaceId: space.id,
            accountId: nonMemberAccountId,
            role: "Admin",
        }),
    ).rejects.toThrow(NotFoundError);

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
});

test("`updateSpaceAccountRole()` throws error when non member account tries to update role of another space", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const memberSession = await space.createSession({role: "Member"});

    const otherSpace = await TestSpace.create(context);
    const [otherMemberSession, otherAdminSession] = await runAllPromises([
        otherSpace.createSession({role: "Member"}),
        otherSpace.createSession({role: "Admin"}),
    ]);

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await memberSession.get()).initialData.space.role).toBe("Member");

    // if system actor for another space tries to update role
    await expect(
        updateSpaceAccountRole(otherSpace.systemAction(), {
            spaceId: space.id,
            accountId: memberSession.account.id,
            role: "Admin",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await memberSession.get()).initialData.space.role).toBe("Member");

    // if impersonated account member in another space tries to update role
    await expect(
        updateSpaceAccountRole(
            context.impersonatedAccountAction(otherSpace.id, otherMemberSession.account.id),
            {
                spaceId: space.id,
                accountId: memberSession.account.id,
                role: "Admin",
            },
        ),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await memberSession.get()).initialData.space.role).toBe("Member");

    // if impersonated account admin in another space tries to update role

    await expect(
        updateSpaceAccountRole(
            context.impersonatedAccountAction(otherSpace.id, otherAdminSession.account.id),
            {
                spaceId: space.id,
                accountId: memberSession.account.id,
                role: "Admin",
            },
        ),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await memberSession.get()).initialData.space.role).toBe("Member");

    // if account member in another space tries to update role

    await expect(
        updateSpaceAccountRole(otherMemberSession.action(), {
            spaceId: space.id,
            accountId: memberSession.account.id,
            role: "Admin",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await memberSession.get()).initialData.space.role).toBe("Member");

    // if account admin in another space tries to update role

    await expect(
        updateSpaceAccountRole(otherAdminSession.action(), {
            spaceId: space.id,
            accountId: memberSession.account.id,
            role: "Admin",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await memberSession.get()).initialData.space.role).toBe("Member");
});

test("`updateSpaceAccountRole()` throws error when non-admin tries to update roles", async () => {
    const space = await TestSpace.create(context);
    const [memberSession, memberSession2] = await runAllPromises([
        space.createSession({role: "Member"}),
        space.createSession({role: "Member"}),
    ]);

    // Verify initial roles
    expect((await memberSession.get()).initialData.space.role).toBe("Member");
    expect((await memberSession2.get()).initialData.space.role).toBe("Member");

    await expect(
        updateSpaceAccountRole(memberSession.action(), {
            spaceId: space.id,
            accountId: memberSession2.account.id,
            role: "Admin",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await memberSession.get()).initialData.space.role).toBe("Member");
    expect((await memberSession2.get()).initialData.space.role).toBe("Member");
});

test("`updateSpaceAccountRole()` throws error when tries to update an account role to owner", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const memberSession = await space.createSession();
    const adminSession = await space.createSession({role: "Admin"});

    // Verify initial roles
    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await memberSession.get()).initialData.space.role).toBe("Member");

    await expect(
        updateSpaceAccountRole(ownerSession.action(), {
            spaceId: space.id,
            accountId: memberSession.account.id,
            role: "Owner",
        }),
    ).rejects.toThrow(FailedPreconditionError);

    expect((await memberSession.get()).initialData.space.role).toBe("Member");
    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");

    // if system actor for space tries to update role to Owner
    await expect(
        updateSpaceAccountRole(space.systemAction(), {
            spaceId: space.id,
            accountId: memberSession.account.id,
            role: "Owner",
        }),
    ).rejects.toThrow(FailedPreconditionError);

    expect((await memberSession.get()).initialData.space.role).toBe("Member");

    // impersonated admin account tries to update role to Owner
    await expect(
        updateSpaceAccountRole(
            context.impersonatedAccountAction(space.id, adminSession.account.id),
            {
                spaceId: space.id,
                accountId: memberSession.account.id,
                role: "Owner",
            },
        ),
    ).rejects.toThrow(FailedPreconditionError);

    expect((await memberSession.get()).initialData.space.role).toBe("Member");
});

test("`updateSpaceAccountRole()` should throw if anonymous account tries to update role", async () => {
    const space = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});

    await expect(
        updateSpaceAccountRole(context.anonymousAction(), {
            spaceId: space.id,
            accountId: memberSession.account.id,
            role: "Admin",
        }),
    ).rejects.toThrow(UnauthenticatedError);

    expect((await memberSession.get()).initialData.space.role).toBe("Member");
});

test("`updateSpaceAccountRole()` should throw if impersonated account member for space tries to update role", async () => {
    const space = await TestSpace.create(context);
    const memberSession1 = await space.createSession({role: "Member"});
    const memberSession2 = await space.createSession({role: "Member"});

    await expect(
        updateSpaceAccountRole(
            context.impersonatedAccountAction(space.id, memberSession1.account.id),
            {
                spaceId: space.id,
                accountId: memberSession2.account.id,
                role: "Admin",
            },
        ),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await memberSession2.get()).initialData.space.role).toBe("Member");
});

test("an account\u2019s spaceIds are updated after calling `acceptSpaceAccountInvite()`", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const memberAccount = await TestAccount.create(context);

    const memberAccountEmailAddress = await memberAccount.createEmailAddress();

    await inviteEmailAddressesToSpace(ownerSession.action(), {
        spaceId: space.id,
        emailAddresses: [memberAccountEmailAddress],
    });

    const memberSession = await TestSpaceSession._create(space, memberAccount);

    await expectAccountSpaceIds(memberSession, {
        spaceIds: new Set([]),
        invitePendingSpaceIds: new Set([space.id]),
    });

    await acceptSpaceAccountInvite(memberSession.action(), space.id);

    await expectAccountSpaceIds(memberSession, {
        spaceIds: new Set([space.id]),
        invitePendingSpaceIds: new Set([]),
    });
});

test("an account\u2019s spaceIds are updated after calling `rejectSpaceAccountInviteAsSpam()`", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const memberAccount = await TestAccount.create(context);

    const memberAccountEmailAddress = await memberAccount.createEmailAddress();

    await inviteEmailAddressesToSpace(ownerSession.action(), {
        spaceId: space.id,
        emailAddresses: [memberAccountEmailAddress],
    });

    const memberSession = await TestSpaceSession._create(space, memberAccount);

    await expectAccountSpaceIds(memberSession, {
        spaceIds: new Set([]),
        invitePendingSpaceIds: new Set([space.id]),
    });

    await rejectSpaceAccountInviteAsSpam(memberSession.action(), space.id);

    await expectAccountSpaceIds(memberSession, {
        spaceIds: new Set([]),
        invitePendingSpaceIds: new Set([]),
    });
});

test("`acceptSpaceAccountInvite()` should move user to Active state", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const memberAccount = await TestAccount.create(context);

    const memberAccountEmailAddress = await memberAccount.createEmailAddress();

    await inviteEmailAddressesToSpace(ownerSession.action(), {
        spaceId: space.id,
        emailAddresses: [memberAccountEmailAddress],
    });

    const memberSession = await TestSpaceSession._create(space, memberAccount);

    await acceptSpaceAccountInvite(memberSession.action(), space.id);

    const spaceAccount = await getSpaceAccountForTest(
        context.systemAction(space.id),
        space.id,
        memberAccount.id,
    );

    expect(spaceAccount?.state.type).toBe("Active");
});

test("`rejectSpaceAccountInviteAsSpam()` should move user to Removed state with reason InviteRejectedAsSpam", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const memberAccount = await TestAccount.create(context);

    const memberAccountEmailAddress = await memberAccount.createEmailAddress();

    await inviteEmailAddressesToSpace(ownerSession.action(), {
        spaceId: space.id,
        emailAddresses: [memberAccountEmailAddress],
    });

    const memberSession = await TestSpaceSession._create(space, memberAccount);

    await rejectSpaceAccountInviteAsSpam(memberSession.action(), space.id);

    const spaceAccount = await getSpaceAccountForTest(
        context.systemAction(space.id),
        space.id,
        memberAccount.id,
    );

    assert(spaceAccount?.state.type === "Removed");
    expect(spaceAccount.state.reason).toBe("InviteRejectedAsSpam");
});

const respondToSpaceAccountInviteMethods = [
    acceptSpaceAccountInvite,
    rejectSpaceAccountInviteAsSpam,
];

for (const respondToSpaceAccountInvite of respondToSpaceAccountInviteMethods) {
    test(`\`${respondToSpaceAccountInvite.name}()\` should throw if an account is removed`, async () => {
        const space = await TestSpace.create(context);
        const ownerSession = await space.createSession({role: "Owner"});
        const memberAccount = await TestAccount.create(context);

        await addSpaceAccount(ownerSession.action(), {
            spaceId: space.id,
            accountId: memberAccount.id,
            withoutInviteForTest: true,
        });

        await removeSpaceAccount(ownerSession.action(), {
            spaceId: space.id,
            accountId: memberAccount.id,
        });

        const memberSession = await TestSpaceSession._create(space, memberAccount);

        await expect(respondToSpaceAccountInvite(memberSession.action(), space.id)).rejects.toThrow(
            new FailedPreconditionError("Account invitation is not in pending state"),
        );
    });

    test(`${respondToSpaceAccountInvite.name} should throw if an account has already accept the invite`, async () => {
        const space = await TestSpace.create(context);
        const ownerSession = await space.createSession({role: "Owner"});
        const memberAccount = await TestAccount.create(context);

        const memberAccountEmailAddress = await memberAccount.createEmailAddress();

        await inviteEmailAddressesToSpace(ownerSession.action(), {
            spaceId: space.id,
            emailAddresses: [memberAccountEmailAddress],
        });

        const memberSession = await TestSpaceSession._create(space, memberAccount);

        // First accept the space
        await acceptSpaceAccountInvite(memberSession.action(), space.id);

        // Then try to respond again
        await expect(respondToSpaceAccountInvite(memberSession.action(), space.id)).rejects.toThrow(
            new FailedPreconditionError("Account invitation is not in pending state"),
        );
    });
}

test("`updateSpaceAccountRole()` should work if impersonated account admin for space tries to update role", async () => {
    // Test 1: Admin updates Member to Admin
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});

    expect((await memberSession.get()).initialData.space.role).toBe("Member");

    await updateSpaceAccountRole(
        context.impersonatedAccountAction(space.id, adminSession.account.id),
        {
            spaceId: space.id,
            accountId: memberSession.account.id,
            role: "Admin",
        },
    );

    expect((await memberSession.get()).initialData.space.role).toBe("Admin");

    // Test 2: impersonated Admin updates another Admin to Member
    const adminSession1 = await space.createSession({role: "Admin"});
    const adminSession2 = await space.createSession({role: "Admin"});

    expect((await adminSession2.get()).initialData.space.role).toBe("Admin");

    await updateSpaceAccountRole(
        context.impersonatedAccountAction(space.id, adminSession1.account.id),
        {
            spaceId: space.id,
            accountId: adminSession2.account.id,
            role: "Member",
        },
    );

    expect((await adminSession2.get()).initialData.space.role).toBe("Member");

    // Test 3: impersonated Admin updates their own role
    const space2 = await TestSpace.create(context);
    const ownerSession2 = await space2.createSession({role: "Owner"});
    const memberSession2 = await space2.createSession({role: "Member"});

    // First promote to admin so they can update their own role
    await updateSpaceAccountRole(ownerSession2.action(), {
        spaceId: space2.id,
        accountId: memberSession2.account.id,
        role: "Admin",
    });

    expect((await memberSession2.get()).initialData.space.role).toBe("Admin");

    // Admin can update their own role to Member
    await updateSpaceAccountRole(
        context.impersonatedAccountAction(space2.id, memberSession2.account.id),
        {
            spaceId: space2.id,
            accountId: memberSession2.account.id,
            role: "Member",
        },
    );

    expect((await memberSession2.get()).initialData.space.role).toBe("Member");
});

test("`updateSpaceAccountRole()` should work if account admin for space tries to update OWN role of Member to Admin", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const adminSession = await space.createSession({role: "Admin"});

    expect((await adminSession.get()).initialData.space.role).toBe("Admin");

    // First demote to member
    await updateSpaceAccountRole(ownerSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
        role: "Member",
    });

    expect((await adminSession.get()).initialData.space.role).toBe("Member");

    // Give admin role back
    await updateSpaceAccountRole(ownerSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
        role: "Admin",
    });

    // Now admin can update their own role
    await updateSpaceAccountRole(adminSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
        role: "Member",
    });

    expect((await adminSession.get()).initialData.space.role).toBe("Member");
});

test("`moveSpaceAccountOwnerRole()` successful ownership transfers", async () => {
    // Test 1: Owner to Member
    const space1 = await TestSpace.create(context);
    const ownerSession1 = await space1.createSession({role: "Owner"});
    const memberSession = await space1.createSession({role: "Member"});

    // Verify initial roles
    expect((await ownerSession1.get()).initialData.space.role).toBe("Owner");
    expect((await memberSession.get()).initialData.space.role).toBe("Member");

    // Move ownership
    await moveSpaceAccountOwnerRole(ownerSession1.action(), {
        spaceId: space1.id,
        newOwnerAccountId: memberSession.account.id,
    });

    // Verify roles changed correctly
    expect((await ownerSession1.get()).initialData.space.role).toBe("Admin");
    expect((await memberSession.get()).initialData.space.role).toBe("Owner");

    // Test 2: Owner to Admin
    const space2 = await TestSpace.create(context);
    const ownerSession2 = await space2.createSession({role: "Owner"});
    const adminSession = await space2.createSession({role: "Admin"});

    // Verify initial roles
    expect((await ownerSession2.get()).initialData.space.role).toBe("Owner");
    expect((await adminSession.get()).initialData.space.role).toBe("Admin");

    // Move ownership
    await moveSpaceAccountOwnerRole(ownerSession2.action(), {
        spaceId: space2.id,
        newOwnerAccountId: adminSession.account.id,
    });

    // Verify roles changed correctly
    expect((await ownerSession2.get()).initialData.space.role).toBe("Admin");
    expect((await adminSession.get()).initialData.space.role).toBe("Owner");

    // Test 3: Owner to self (no-op)
    const space3 = await TestSpace.create(context);
    const ownerSession3 = await space3.createSession({role: "Owner"});

    expect((await ownerSession3.get()).initialData.space.role).toBe("Owner");

    // Move ownership from current owner to themselves
    await moveSpaceAccountOwnerRole(ownerSession3.action(), {
        spaceId: space3.id,
        newOwnerAccountId: ownerSession3.account.id,
    });

    expect((await ownerSession3.get()).initialData.space.role).toBe("Owner");
});

test("`moveSpaceAccountOwnerRole()` throws when a non-owner tries to move ownership", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const [adminSession, memberSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession({role: "Member"}),
    ]);
    const [otherAdminSession, otherMemberSession] = await runAllPromises([
        otherSpace.createSession({role: "Admin"}),
        otherSpace.createSession({role: "Member"}),
    ]);

    // Verify initial roles
    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await adminSession.get()).initialData.space.role).toBe("Admin");
    expect((await memberSession.get()).initialData.space.role).toBe("Member");

    // Test 1: Admin in same space tries to move ownership
    await expect(
        moveSpaceAccountOwnerRole(adminSession.action(), {
            spaceId: space.id,
            newOwnerAccountId: memberSession.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    // Test 2: Member in same space tries to move ownership
    await expect(
        moveSpaceAccountOwnerRole(memberSession.action(), {
            spaceId: space.id,
            newOwnerAccountId: adminSession.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    // Test 3: Admin from another space tries to move ownership
    await expect(
        moveSpaceAccountOwnerRole(otherAdminSession.action(), {
            spaceId: space.id,
            newOwnerAccountId: memberSession.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    // Test 4: Member from another space tries to move ownership
    await expect(
        moveSpaceAccountOwnerRole(otherMemberSession.action(), {
            spaceId: space.id,
            newOwnerAccountId: memberSession.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    // Verify roles didn't change in any test
    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await adminSession.get()).initialData.space.role).toBe("Admin");
    expect((await memberSession.get()).initialData.space.role).toBe("Member");
});

test("`moveSpaceAccountOwnerRole()` fails when admin tries with incorrect owner context", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const adminSession = await space.createSession({role: "Admin"});

    // Verify initial roles
    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await adminSession.get()).initialData.space.role).toBe("Admin");

    // Try to move ownership with incorrect old owner
    await expect(
        moveSpaceAccountOwnerRole(adminSession.action(), {
            spaceId: space.id,
            newOwnerAccountId: adminSession.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    // Verify roles didn't change
    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await adminSession.get()).initialData.space.role).toBe("Admin");
});

test("`moveSpaceAccountOwnerRole()` should throw if account owner tries to change owner twice (from A to B then B to C, account A can\u2019t remove ownership from account B)", async () => {
    const space = await TestSpace.create(context);

    const [ownerSession, memberSession1, memberSession2] = await runAllPromises([
        space.createSession({role: "Owner"}),
        space.createSession({role: "Member"}),
        space.createSession({role: "Member"}),
    ]);

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await memberSession1.get()).initialData.space.role).toBe("Member");
    expect((await memberSession2.get()).initialData.space.role).toBe("Member");

    // Move ownership from original owner (A) to memberSession1 (B)
    await moveSpaceAccountOwnerRole(ownerSession.action(), {
        spaceId: space.id,
        newOwnerAccountId: memberSession1.account.id,
    });

    expect((await ownerSession.get()).initialData.space.role).toBe("Admin");
    expect((await memberSession1.get()).initialData.space.role).toBe("Owner");
    expect((await memberSession2.get()).initialData.space.role).toBe("Member");

    // Try to move ownership from memberSession1 (B) to memberSession2 (C) using
    // original owner's session (A) This should fail because A is no longer the owner
    await expect(
        moveSpaceAccountOwnerRole(ownerSession.action(), {
            spaceId: space.id,
            newOwnerAccountId: memberSession2.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await ownerSession.get()).initialData.space.role).toBe("Admin");
    expect((await memberSession1.get()).initialData.space.role).toBe("Owner");
    expect((await memberSession2.get()).initialData.space.role).toBe("Member");
});

test("`moveSpaceAccountOwnerRole()` can\u2019t move ownership to removed account", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const memberSession = await space.createSession({role: "Member"});

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await memberSession.get()).initialData.space.role).toBe("Member");

    await removeSpaceAccount(ownerSession.action(), {
        spaceId: space.id,
        accountId: memberSession.account.id,
    });

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await memberSession.get()).initialData.space.role).toBe("Member");

    await expect(
        moveSpaceAccountOwnerRole(ownerSession.action(), {
            spaceId: space.id,
            newOwnerAccountId: memberSession.account.id,
        }),
    ).rejects.toThrow("Can\u2019t move space owner role to an inactive account");

    expect((await ownerSession.get()).initialData.space.role).toBe("Owner");
    expect((await memberSession.get()).initialData.space.role).toBe("Member");
});

test("`addSpaceAccount()` shouldn\u2019t add two owners in race condition", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const account1 = await TestAccount.create(context);
    const account2 = await TestAccount.create(context);

    const pause1Promise = addSpaceAccountBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${account1.id}`,
    );
    const pause2Promise = addSpaceAccountBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${account2.id}`,
    );

    const promise1 = addSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: account1.id,
        role: "Owner",
        withoutInviteForTest: true,
    });

    const promise2 = addSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: account2.id,
        role: "Owner",
        withoutInviteForTest: true,
    });

    const {unpause: unpause1} = await pause1Promise;
    const {unpause: unpause2} = await pause2Promise;

    unpause1();
    await expect(promise1).resolves.toBeTruthy();
    unpause2();
    await expect(promise2).rejects.toThrow("Space already has an owner");

    expect(
        new Map(
            filterMapArray(
                await expensivelyGetAllSpaceAccounts(space.systemAction(), space.id),
                account =>
                    account.initialData.space.state.type === "Active"
                        ? [account.id, account.initialData.space.role]
                        : undefined,
            ),
        ),
    ).toEqual(
        new Map([
            [adminSession.account.id, "Admin"],
            [account1.id, "Owner"],
        ]),
    );
});

test("`addSpaceAccount()` shouldn\u2019t add two owners in race condition using test scenario framework", async () => {
    const space = await TestSpace.create(context);
    const account1Id = generateId<AccountId>();
    const account2Id = generateId<AccountId>();

    const pause1Promise = addSpaceAccountBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${account1Id}`,
    );
    const pause2Promise = addSpaceAccountBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${account2Id}`,
    );

    const promise1 = space.createSession({id: account1Id, role: "Owner"});

    const promise2 = space.createSession({id: account2Id, role: "Owner"});

    const {unpause: unpause1} = await pause1Promise;
    const {unpause: unpause2} = await pause2Promise;

    unpause1();
    await expect(promise1).resolves.toBeTruthy();
    unpause2();
    await expect(promise2).rejects.toThrow("Space already has an owner");

    expect(
        new Map(
            filterMapArray(
                await expensivelyGetAllSpaceAccounts(space.systemAction(), space.id),
                account =>
                    account.initialData.space.state.type === "Active"
                        ? [account.id, account.initialData.space.role]
                        : undefined,
            ),
        ),
    ).toEqual(new Map([[account1Id, "Owner"]]));
});

test("`moveSpaceAccountOwnerRole()` shouldn\u2019t add two owners in race condition", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const [session1, session2] = await space.createSessions(2);

    const pause1Promise = moveSpaceAccountOwnerRoleBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${session1.account.id}`,
    );
    const pause2Promise = moveSpaceAccountOwnerRoleBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${session2.account.id}`,
    );

    const promise1 = moveSpaceAccountOwnerRole(ownerSession.action(), {
        spaceId: space.id,
        newOwnerAccountId: session1.account.id,
    });

    const promise2 = moveSpaceAccountOwnerRole(ownerSession.action(), {
        spaceId: space.id,
        newOwnerAccountId: session2.account.id,
    });

    const {unpause: unpause1} = await pause1Promise;
    const {unpause: unpause2} = await pause2Promise;

    unpause1();
    await expect(promise1).resolves.toBeTruthy();
    unpause2();
    await expect(promise2).rejects.toThrow("Account doesn\u2019t have `Owner` access to space");

    expect(
        new Map(
            filterMapArray(
                await expensivelyGetAllSpaceAccounts(space.systemAction(), space.id),
                account =>
                    account.initialData.space.state.type === "Active"
                        ? [account.id, account.initialData.space.role]
                        : undefined,
            ),
        ),
    ).toEqual(
        new Map([
            [ownerSession.account.id, "Admin"],
            [session1.account.id, "Owner"],
            [session2.account.id, "Member"],
        ]),
    );
});

test("`addSpaceAccount()` and `moveSpaceAccountOwnerRole()` shouldn\u2019t add two owners in race condition (simple)", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const session = await space.createSession();
    const otherAccount = await TestAccount.create(context);

    const pause2Promise = moveSpaceAccountOwnerRoleBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${session.account.id}`,
    );

    const promise1 = addSpaceAccount(space.systemAction(), {
        spaceId: space.id,
        accountId: otherAccount.id,
        role: "Owner",
        withoutInviteForTest: true,
    });

    const promise2 = moveSpaceAccountOwnerRoleForTest(space.systemAction(), {
        spaceId: space.id,
        oldOwnerAccountId: ownerSession.account.id,
        newOwnerAccountId: session.account.id,
    });

    const {unpause: unpause2} = await pause2Promise;

    await expect(promise1).rejects.toThrow("Space already has an owner account");
    unpause2();
    await expect(promise2).resolves.toBeTruthy();

    expect(
        new Map(
            filterMapArray(
                await expensivelyGetAllSpaceAccounts(space.systemAction(), space.id),
                account =>
                    account.initialData.space.state.type === "Active"
                        ? [account.id, account.initialData.space.role]
                        : undefined,
            ),
        ),
    ).toEqual(
        new Map([
            [ownerSession.account.id, "Admin"],
            [session.account.id, "Owner"],
        ]),
    );
});

test("`moveSpaceAccountOwnerRole()` and `addSpaceAccount()` shouldn\u2019t add two owners in race condition (simple)", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const session = await space.createSession();
    const otherAccount = await TestAccount.create(context);

    const pause1Promise = moveSpaceAccountOwnerRoleBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${session.account.id}`,
    );

    const promise1 = moveSpaceAccountOwnerRoleForTest(space.systemAction(), {
        spaceId: space.id,
        oldOwnerAccountId: ownerSession.account.id,
        newOwnerAccountId: session.account.id,
    });

    const promise2 = addSpaceAccount(space.systemAction(), {
        spaceId: space.id,
        accountId: otherAccount.id,
        role: "Owner",
        withoutInviteForTest: true,
    });

    // Don't treat a rejection of this promise as an uncaught exception.
    //
    // NOTE(calebmer): I'm surprised this is necessary. Shouldn't
    // `await expect(promise2)` handle the promise?? But without this catch the test is
    // flaky _shrug_
    promise2.catch(() => {});

    const {unpause: unpause1} = await pause1Promise;

    unpause1();
    await expect(promise1).resolves.toBeTruthy();
    await expect(promise2).rejects.toThrow("Space already has an owner account");

    expect(
        new Map(
            filterMapArray(
                await expensivelyGetAllSpaceAccounts(space.systemAction(), space.id),
                account =>
                    account.initialData.space.state.type === "Active"
                        ? [account.id, account.initialData.space.role]
                        : undefined,
            ),
        ),
    ).toEqual(
        new Map([
            [ownerSession.account.id, "Admin"],
            [session.account.id, "Owner"],
        ]),
    );
});

test("`addSpaceAccount()` and `moveSpaceAccountOwnerRole()` shouldn\u2019t add two owners in race condition", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherAccount1 = await TestAccount.create(context);
    const otherAccount2 = await TestAccount.create(context);

    const pause1Promise = addSpaceAccountBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${otherAccount1.id}`,
    );
    const pause2Promise = moveSpaceAccountOwnerRoleBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${session.account.id}`,
    );

    const promise1 = addSpaceAccount(space.systemAction(), {
        spaceId: space.id,
        accountId: otherAccount1.id,
        role: "Owner",
        withoutInviteForTest: true,
    });

    const {unpause: unpause1} = await pause1Promise;

    await addSpaceAccount(space.systemAction(), {
        spaceId: space.id,
        accountId: otherAccount2.id,
        role: "Owner",
        withoutInviteForTest: true,
    });

    const promise2 = moveSpaceAccountOwnerRoleForTest(space.systemAction(), {
        spaceId: space.id,
        oldOwnerAccountId: otherAccount2.id,
        newOwnerAccountId: session.account.id,
    });

    const {unpause: unpause2} = await pause2Promise;

    unpause1();
    await expect(promise1).rejects.toThrow("Space already has an owner");
    unpause2();
    await expect(promise2).resolves.toBeTruthy();

    expect(
        new Map(
            filterMapArray(
                await expensivelyGetAllSpaceAccounts(space.systemAction(), space.id),
                account =>
                    account.initialData.space.state.type === "Active"
                        ? [account.id, account.initialData.space.role]
                        : undefined,
            ),
        ),
    ).toEqual(
        new Map([
            [otherAccount2.id, "Admin"],
            [session.account.id, "Owner"],
        ]),
    );
});

test("`moveSpaceAccountOwnerRole()` and `addSpaceAccount()` shouldn\u2019t add two owners in race condition", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherAccount1 = await TestAccount.create(context);
    const otherAccount2 = await TestAccount.create(context);

    const pause1Promise = addSpaceAccountBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${otherAccount1.id}`,
    );
    const pause2Promise = moveSpaceAccountOwnerRoleBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${session.account.id}`,
    );

    const promise1 = addSpaceAccount(space.systemAction(), {
        spaceId: space.id,
        accountId: otherAccount1.id,
        role: "Owner",
        withoutInviteForTest: true,
    });

    const {unpause: unpause1} = await pause1Promise;

    await addSpaceAccount(space.systemAction(), {
        spaceId: space.id,
        accountId: otherAccount2.id,
        role: "Owner",
        withoutInviteForTest: true,
    });

    const promise2 = moveSpaceAccountOwnerRoleForTest(space.systemAction(), {
        spaceId: space.id,
        oldOwnerAccountId: otherAccount2.id,
        newOwnerAccountId: session.account.id,
    });

    const {unpause: unpause2} = await pause2Promise;

    unpause2();
    await expect(promise2).resolves.toBeTruthy();
    unpause1();
    await expect(promise1).rejects.toThrow("Space already has an owner");

    expect(
        new Map(
            filterMapArray(
                await expensivelyGetAllSpaceAccounts(space.systemAction(), space.id),
                account =>
                    account.initialData.space.state.type === "Active"
                        ? [account.id, account.initialData.space.role]
                        : undefined,
            ),
        ),
    ).toEqual(
        new Map([
            [otherAccount2.id, "Admin"],
            [session.account.id, "Owner"],
        ]),
    );
});

test("`moveSpaceAccountOwnerRole()` race condition with `removeSpaceAccount()`", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const memberSession = await space.createSession({role: "Member"});

    const pause1Promise = removeSpaceAccountBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${memberSession.account.id}`,
    );

    const pause2Promise = moveSpaceAccountOwnerRoleBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${memberSession.account.id}`,
    );

    const promise1 = removeSpaceAccount(ownerSession.action(), {
        spaceId: space.id,
        accountId: memberSession.account.id,
    });

    const promise2 = moveSpaceAccountOwnerRole(ownerSession.action(), {
        spaceId: space.id,
        newOwnerAccountId: memberSession.account.id,
    });

    const {unpause: unpause1} = await pause1Promise;
    const {unpause: unpause2} = await pause2Promise;

    unpause1();
    await expect(promise1).resolves.toBeTruthy();
    unpause2();
    await expect(promise2).rejects.toThrow(
        "Can\u2019t move space owner role to an inactive account",
    );

    expect(
        new Map(
            filterMapArray(
                await expensivelyGetAllSpaceAccounts(space.systemAction(), space.id),
                account =>
                    account.initialData.space.state.type === "Active"
                        ? [account.id, account.initialData.space.role]
                        : undefined,
            ),
        ),
    ).toEqual(new Map([[ownerSession.account.id, "Owner"]]));
});

test("`removeSpaceAccount()` race condition with `moveSpaceAccountOwnerRole()`", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const memberSession = await space.createSession({role: "Member"});

    const pause1Promise = removeSpaceAccountBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${memberSession.account.id}`,
    );

    const pause2Promise = moveSpaceAccountOwnerRoleBeforeExecuteTestCheckpoint.pauseForTest(
        `${space.id}:${memberSession.account.id}`,
    );

    const promise1 = removeSpaceAccount(ownerSession.action(), {
        spaceId: space.id,
        accountId: memberSession.account.id,
    });

    const promise2 = moveSpaceAccountOwnerRole(ownerSession.action(), {
        spaceId: space.id,
        newOwnerAccountId: memberSession.account.id,
    });

    const {unpause: unpause1} = await pause1Promise;
    const {unpause: unpause2} = await pause2Promise;

    unpause2();
    await expect(promise2).resolves.toBeTruthy();
    unpause1();
    await expect(promise1).rejects.toThrow("Can\u2019t remove owner from space");

    expect(
        new Map(
            filterMapArray(
                await expensivelyGetAllSpaceAccounts(space.systemAction(), space.id),
                account =>
                    account.initialData.space.state.type === "Active"
                        ? [account.id, account.initialData.space.role]
                        : undefined,
            ),
        ),
    ).toEqual(
        new Map([
            [ownerSession.account.id, "Admin"],
            [memberSession.account.id, "Owner"],
        ]),
    );
});

test("`getSpaceIfPossible()` returns null if the space doesn\u2019t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(await getSpaceIfPossible(session.action(), generateId())).toEqual(null);
});

test("`getSpaceIfPossible()` returns an error if you don\u2019t have access to the space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const otherSpace = await TestSpace.create(context);

    expect(await getSpaceIfPossible(session.action(), otherSpace.id)).toEqual({
        ok: false,
        error: expect.any(PermissionDeniedError),
    });
});

test("`getSpaceIfPossible()` returns an error if you previously had access to the space", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const session = await space.createSession();

    expect(await getSpaceIfPossible(session.action(), space.id)).toEqual({
        ok: true,
        value: expect.any(SpaceModel),
    });

    await removeSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: session.account.id,
    });

    expect(await getSpaceIfPossible(session.action(), space.id)).toEqual({
        ok: false,
        error: expect.any(PermissionDeniedError),
    });
});

test("`getSpaceIfPossible()` works if you have access to the space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(await getSpaceIfPossible(session.action(), space.id)).toEqual({
        ok: true,
        value: expect.any(SpaceModel),
    });
});

test("`getSpaceIfPossible()` returns an error for an anonymous actor", async () => {
    const space = await TestSpace.create(context);

    expect(await getSpaceIfPossible(context.anonymousAction(), space.id)).toEqual({
        ok: false,
        error: expect.any(UnauthenticatedError),
    });
});

test("can instantiate a bot in a space as an admin", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);

    const ownerSession = await space.createSession({role: "Owner"});
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});
    const otherSession = await otherSpace.createSession({role: "Admin"});

    await expect(
        instantiateBotSpaceAccount(otherSession.action(), {spaceId: space.id, botId: bot.id}),
    ).rejects.toThrow("Account doesn\u2019t have `Admin` access to space");

    await expect(
        instantiateBotSpaceAccount(memberSession.action(), {spaceId: space.id, botId: bot.id}),
    ).rejects.toThrow("Account doesn\u2019t have `Admin` access to space");

    const {id: accountId} = await instantiateBotSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
    });

    expect((await getAccount(memberSession.action(), space.id, accountId)).initialData).toEqual(
        expect.objectContaining({
            name: "Test Bot",
            botId: bot.id,
            space: expect.objectContaining({state: expect.objectContaining({type: "Active"})}),
        }),
    );

    await expect(
        instantiateBotSpaceAccount(adminSession.action(), {spaceId: space.id, botId: bot.id}),
    ).rejects.toThrow("Can\u2019t instantiate bot twice in the same space");

    await expect(
        instantiateBotSpaceAccount(ownerSession.action(), {spaceId: space.id, botId: bot.id}),
    ).rejects.toThrow("Can\u2019t instantiate bot twice in the same space");

    const {id: otherAccountId} = await instantiateBotSpaceAccount(otherSession.action(), {
        spaceId: otherSpace.id,
        botId: bot.id,
    });

    expect(
        (await getAccount(otherSession.action(), otherSpace.id, otherAccountId)).initialData,
    ).toEqual(
        expect.objectContaining({
            name: "Test Bot",
            botId: bot.id,
            space: expect.objectContaining({state: expect.objectContaining({type: "Active"})}),
        }),
    );
});

test("can instantiate a bot in a space as an owner", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);

    const ownerSession = await space.createSession({role: "Owner"});
    const adminSession = await space.createSession({role: "Admin"});
    const memberSession = await space.createSession({role: "Member"});
    const otherSession = await otherSpace.createSession({role: "Admin"});

    await expect(
        instantiateBotSpaceAccount(otherSession.action(), {spaceId: space.id, botId: bot.id}),
    ).rejects.toThrow("Account doesn\u2019t have `Admin` access to space");

    await expect(
        instantiateBotSpaceAccount(memberSession.action(), {spaceId: space.id, botId: bot.id}),
    ).rejects.toThrow("Account doesn\u2019t have `Admin` access to space");

    const {id: accountId} = await instantiateBotSpaceAccount(ownerSession.action(), {
        spaceId: space.id,
        botId: bot.id,
    });

    expect((await getAccount(memberSession.action(), space.id, accountId)).initialData).toEqual(
        expect.objectContaining({
            name: "Test Bot",
            botId: bot.id,
            space: expect.objectContaining({state: expect.objectContaining({type: "Active"})}),
        }),
    );

    await expect(
        instantiateBotSpaceAccount(adminSession.action(), {spaceId: space.id, botId: bot.id}),
    ).rejects.toThrow("Can\u2019t instantiate bot twice in the same space");

    await expect(
        instantiateBotSpaceAccount(ownerSession.action(), {spaceId: space.id, botId: bot.id}),
    ).rejects.toThrow("Can\u2019t instantiate bot twice in the same space");
});

test("can\u2019t add a bot instantiated in one space to another space", async () => {
    const bot = await TestBot.create(context);

    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);

    const session = await space.createSession({role: "Admin"});
    const otherSession = await otherSpace.createSession({role: "Admin"});

    const {id: accountId} = await instantiateBotSpaceAccount(session.action(), {
        spaceId: space.id,
        botId: bot.id,
    });

    await expect(
        addSpaceAccount(otherSession.action(), {
            spaceId: otherSpace.id,
            accountId,
            withoutInviteForTest: true,
        }),
    ).rejects.toThrow(
        "Can\u2019t add existing bot account to space, must use `instantiateBotSpaceAccount()` to create a new bot account for the space",
    );
});

test("can remove bot from space it was instantiated in and can add it back", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);

    const session = await space.createSession({role: "Admin"});
    const otherSession = await otherSpace.createSession({role: "Admin"});

    const {id: accountId} = await instantiateBotSpaceAccount(session.action(), {
        spaceId: space.id,
        botId: bot.id,
    });

    expect((await getAccount(session.action(), space.id, accountId)).initialData).toEqual(
        expect.objectContaining({
            name: "Test Bot",
            botId: bot.id,
            space: expect.objectContaining({state: expect.objectContaining({type: "Active"})}),
        }),
    );

    await removeSpaceAccount(session.action(), {
        spaceId: space.id,
        accountId,
    });

    expect((await getAccount(session.action(), space.id, accountId)).initialData).toEqual(
        expect.objectContaining({
            name: "Test Bot",
            botId: bot.id,
            space: expect.objectContaining({
                state: expect.objectContaining({type: "Removed"}),
            }),
        }),
    );

    await expect(
        addSpaceAccount(otherSession.action(), {
            spaceId: otherSpace.id,
            accountId,
            withoutInviteForTest: true,
        }),
    ).rejects.toThrow(
        "Can\u2019t add existing bot account to space, must use `instantiateBotSpaceAccount()` to create a new bot account for the space",
    );

    expect((await getAccount(session.action(), space.id, accountId)).initialData).toEqual(
        expect.objectContaining({
            name: "Test Bot",
            botId: bot.id,
            space: expect.objectContaining({
                state: expect.objectContaining({type: "Removed"}),
            }),
        }),
    );

    await addSpaceAccount(session.action(), {
        spaceId: space.id,
        accountId,
        withoutInviteForTest: true,
    });

    expect((await getAccount(session.action(), space.id, accountId)).initialData).toEqual(
        expect.objectContaining({
            name: "Test Bot",
            botId: bot.id,
            space: expect.objectContaining({state: expect.objectContaining({type: "Active"})}),
        }),
    );
});

test("can\u2019t make a bot account a space admin", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    const space = await TestSpace.create(context);

    const session1 = await space.createSession({role: "Admin"});
    const [session2, session3] = await space.createSessions(2);

    const {id: accountId} = await instantiateBotSpaceAccount(session1.action(), {
        spaceId: space.id,
        botId: bot.id,
    });

    expect((await getAccount(session1.action(), space.id, accountId)).initialData).toEqual(
        expect.objectContaining({
            name: "Test Bot",
            botId: bot.id,
            space: expect.objectContaining({
                role: "Member",
                state: {type: "Active", activatedTime: expect.any(Date)},
            }),
        }),
    );

    await updateSpaceAccountRole(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
        role: "Admin",
    });

    await expect(
        updateSpaceAccountRole(session1.action(), {
            spaceId: space.id,
            accountId,
            role: "Admin",
        }),
    ).rejects.toThrow("Can\u2019t modify bot account\u2019s role");

    await updateSpaceAccountRole(session1.action(), {
        spaceId: space.id,
        accountId: session3.account.id,
        role: "Admin",
    });

    expect((await getAccount(session1.action(), space.id, accountId)).initialData).toEqual(
        expect.objectContaining({
            name: "Test Bot",
            botId: bot.id,
            space: expect.objectContaining({
                role: "Member",
                state: {type: "Active", activatedTime: expect.any(Date)},
            }),
        }),
    );
});

test("can\u2019t make a bot account a space owner", async () => {
    const bot = await TestBot.create(context, {name: "Test Bot"});

    const space = await TestSpace.create(context);

    const session1 = await space.createSession({role: "Owner"});
    const session2 = await space.createSession();

    const {id: accountId} = await instantiateBotSpaceAccount(session1.action(), {
        spaceId: space.id,
        botId: bot.id,
    });

    expect((await getAccount(session1.action(), space.id, accountId)).initialData).toEqual(
        expect.objectContaining({
            name: "Test Bot",
            botId: bot.id,
            space: expect.objectContaining({
                role: "Member",
                state: {type: "Active", activatedTime: expect.any(Date)},
            }),
        }),
    );

    await expect(
        moveSpaceAccountOwnerRole(session1.action(), {
            spaceId: space.id,
            newOwnerAccountId: accountId,
        }),
    ).rejects.toThrow("Can\u2019t move space owner role to bot account");

    await moveSpaceAccountOwnerRole(session1.action(), {
        spaceId: space.id,
        newOwnerAccountId: session2.account.id,
    });

    expect((await getAccount(session1.action(), space.id, accountId)).initialData).toEqual(
        expect.objectContaining({
            name: "Test Bot",
            botId: bot.id,
            space: expect.objectContaining({
                role: "Member",
                state: {type: "Active", activatedTime: expect.any(Date)},
            }),
        }),
    );
});

test("can check whether an account is a bot or not", async () => {
    const bot = await TestBot.create(context);

    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);

    const session1 = await space.createSession({role: "Owner"});
    const session2 = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const {id: accountId} = await instantiateBotSpaceAccount(session1.action(), {
        spaceId: space.id,
        botId: bot.id,
    });

    await expect(
        isBotSpaceAccount(context.anonymousAction(), space.id, session1.account.id),
    ).rejects.toThrow("Unauthenticated session");
    await expect(
        isBotSpaceAccount(context.anonymousAction(), space.id, session2.account.id),
    ).rejects.toThrow("Unauthenticated session");
    await expect(isBotSpaceAccount(context.anonymousAction(), space.id, accountId)).rejects.toThrow(
        "Unauthenticated session",
    );

    await expect(
        isBotSpaceAccount(otherSpace.systemAction(), space.id, session1.account.id),
    ).rejects.toThrow("System actor doesn\u2019t have access to space");
    await expect(
        isBotSpaceAccount(otherSpace.systemAction(), space.id, session2.account.id),
    ).rejects.toThrow("System actor doesn\u2019t have access to space");
    await expect(isBotSpaceAccount(otherSpace.systemAction(), space.id, accountId)).rejects.toThrow(
        "System actor doesn\u2019t have access to space",
    );

    await expect(
        isBotSpaceAccount(otherSession.action(), space.id, session1.account.id),
    ).rejects.toThrow("Account doesn\u2019t have access to space");
    await expect(
        isBotSpaceAccount(otherSession.action(), space.id, session2.account.id),
    ).rejects.toThrow("Account doesn\u2019t have access to space");
    await expect(isBotSpaceAccount(otherSession.action(), space.id, accountId)).rejects.toThrow(
        "Account doesn\u2019t have access to space",
    );

    expect(await isBotSpaceAccount(space.systemAction(), space.id, session1.account.id)).toEqual(
        false,
    );
    expect(await isBotSpaceAccount(space.systemAction(), space.id, session2.account.id)).toEqual(
        false,
    );
    expect(await isBotSpaceAccount(space.systemAction(), space.id, accountId)).toEqual(true);

    expect(await isBotSpaceAccount(session1.action(), space.id, session1.account.id)).toEqual(
        false,
    );
    expect(await isBotSpaceAccount(session1.action(), space.id, session2.account.id)).toEqual(
        false,
    );
    expect(await isBotSpaceAccount(session1.action(), space.id, accountId)).toEqual(true);

    expect(await isBotSpaceAccount(session2.action(), space.id, session1.account.id)).toEqual(
        false,
    );
    expect(await isBotSpaceAccount(session2.action(), space.id, session2.account.id)).toEqual(
        false,
    );
    expect(await isBotSpaceAccount(session2.action(), space.id, accountId)).toEqual(true);

    expect(
        await isBotSpaceAccount(space.impersonatedAction(accountId), space.id, session1.account.id),
    ).toEqual(false);
    expect(
        await isBotSpaceAccount(space.impersonatedAction(accountId), space.id, session2.account.id),
    ).toEqual(false);
    expect(
        await isBotSpaceAccount(space.impersonatedAction(accountId), space.id, accountId),
    ).toEqual(true);

    await expect(isBotSpaceAccount(space.systemAction(), space.id, generateId())).rejects.toThrow(
        "Account doesn\u2019t have access to space",
    );
    await expect(isBotSpaceAccount(session1.action(), space.id, generateId())).rejects.toThrow(
        "Account doesn\u2019t have access to space",
    );
});

test("`isBotSpaceAccount()` after `authorizeSpaceAccess()` is cached", async () => {
    const bot = await TestBot.create(context);

    const space = await TestSpace.create(context);

    const session1 = await space.createSession({role: "Owner"});

    const {id: accountId} = await instantiateBotSpaceAccount(session1.action(), {
        spaceId: space.id,
        botId: bot.id,
    });

    const {getCount: getCount1} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    const {getCount: getCount2} = dynamoClientGetItemTestCounter.recordAllForTest();

    dynamoClientExecuteActionTestCounter.resetForTest();
    dynamoClientGetItemTestCounter.resetForTest();

    // Establish baseline:
    {
        {
            const actionContext = session1.action();

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await expect(isBotSpaceAccount(actionContext, space.id, accountId)).resolves.toEqual(
                true,
            );

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(2);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();
        dynamoClientGetItemTestCounter.resetForTest();

        {
            const actionContext = session1.action();

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await expect(
                authorizeNotBotSpaceAccount(actionContext, space.id, accountId),
            ).rejects.toThrow(PermissionDeniedError);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(2);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();
        dynamoClientGetItemTestCounter.resetForTest();

        {
            const actionContext = session1.action();

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await expect(
                isBotSpaceAccount(actionContext, space.id, session1.account.id),
            ).resolves.toEqual(false);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();
        dynamoClientGetItemTestCounter.resetForTest();

        {
            const actionContext = session1.action();

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await expect(
                authorizeNotBotSpaceAccount(actionContext, space.id, session1.account.id),
            ).resolves.toBeUndefined();

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();
        dynamoClientGetItemTestCounter.resetForTest();

        {
            const actionContext = space.impersonatedAction(accountId);

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await expect(isBotSpaceAccount(actionContext, space.id, accountId)).resolves.toEqual(
                true,
            );

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();
        dynamoClientGetItemTestCounter.resetForTest();

        {
            const actionContext = space.impersonatedAction(accountId);

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await expect(
                authorizeNotBotSpaceAccount(actionContext, space.id, accountId),
            ).rejects.toThrow(PermissionDeniedError);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);
        }
    }

    dynamoClientExecuteActionTestCounter.resetForTest();
    dynamoClientGetItemTestCounter.resetForTest();

    // Run after `authorizeSpaceAccess()`:
    {
        {
            const actionContext = session1.action();

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await authorizeSpaceAccess(actionContext, space.id);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);

            await expect(isBotSpaceAccount(actionContext, space.id, accountId)).resolves.toEqual(
                true,
            );

            expect(getCount1()).toEqual(2);
            expect(getCount2()).toEqual(2);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();
        dynamoClientGetItemTestCounter.resetForTest();

        {
            const actionContext = session1.action();

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await authorizeSpaceAccess(actionContext, space.id);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);

            await expect(
                authorizeNotBotSpaceAccount(actionContext, space.id, accountId),
            ).rejects.toThrow(PermissionDeniedError);

            expect(getCount1()).toEqual(2);
            expect(getCount2()).toEqual(2);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();
        dynamoClientGetItemTestCounter.resetForTest();

        {
            const actionContext = session1.action();

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await authorizeSpaceAccess(actionContext, space.id);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);

            await expect(
                isBotSpaceAccount(actionContext, space.id, session1.account.id),
            ).resolves.toEqual(false);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();
        dynamoClientGetItemTestCounter.resetForTest();

        {
            const actionContext = session1.action();

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await authorizeSpaceAccess(actionContext, space.id);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);

            await expect(
                authorizeNotBotSpaceAccount(actionContext, space.id, session1.account.id),
            ).resolves.toBeUndefined();

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();
        dynamoClientGetItemTestCounter.resetForTest();

        {
            const actionContext = space.impersonatedAction(accountId);

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await authorizeSpaceAccess(actionContext, space.id);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);

            await expect(isBotSpaceAccount(actionContext, space.id, accountId)).resolves.toEqual(
                true,
            );

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();
        dynamoClientGetItemTestCounter.resetForTest();

        {
            const actionContext = space.impersonatedAction(accountId);

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await authorizeSpaceAccess(actionContext, space.id);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);

            await expect(
                authorizeNotBotSpaceAccount(actionContext, space.id, accountId),
            ).rejects.toThrow(PermissionDeniedError);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);
        }
    }

    dynamoClientExecuteActionTestCounter.resetForTest();
    dynamoClientGetItemTestCounter.resetForTest();

    // Run in parallel with `authorizeSpaceAccess()`:
    {
        {
            const actionContext = session1.action();

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await expect(
                runAllPromises([
                    authorizeSpaceAccess(actionContext, space.id),
                    isBotSpaceAccount(actionContext, space.id, accountId),
                ]),
            ).resolves.toEqual([undefined, true]);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(2);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();
        dynamoClientGetItemTestCounter.resetForTest();

        {
            const actionContext = session1.action();

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await expect(
                runAllPromises([
                    authorizeSpaceAccess(actionContext, space.id),
                    authorizeNotBotSpaceAccount(actionContext, space.id, accountId),
                ]),
            ).rejects.toThrow(PermissionDeniedError);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(2);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();
        dynamoClientGetItemTestCounter.resetForTest();

        {
            const actionContext = session1.action();

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await expect(
                runAllPromises([
                    authorizeSpaceAccess(actionContext, space.id),
                    isBotSpaceAccount(actionContext, space.id, session1.account.id),
                ]),
            ).resolves.toEqual([undefined, false]);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();
        dynamoClientGetItemTestCounter.resetForTest();

        {
            const actionContext = session1.action();

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await expect(
                runAllPromises([
                    authorizeSpaceAccess(actionContext, space.id),
                    authorizeNotBotSpaceAccount(actionContext, space.id, session1.account.id),
                ]),
            ).resolves.toEqual([undefined, undefined]);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();
        dynamoClientGetItemTestCounter.resetForTest();

        {
            const actionContext = space.impersonatedAction(accountId);

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await expect(
                runAllPromises([
                    authorizeSpaceAccess(actionContext, space.id),
                    isBotSpaceAccount(actionContext, space.id, accountId),
                ]),
            ).resolves.toEqual([undefined, true]);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();
        dynamoClientGetItemTestCounter.resetForTest();

        {
            const actionContext = space.impersonatedAction(accountId);

            expect(getCount1()).toEqual(0);
            expect(getCount2()).toEqual(0);

            await expect(
                runAllPromises([
                    authorizeSpaceAccess(actionContext, space.id),
                    authorizeNotBotSpaceAccount(actionContext, space.id, accountId),
                ]),
            ).rejects.toThrow(PermissionDeniedError);

            expect(getCount1()).toEqual(1);
            expect(getCount2()).toEqual(1);
        }
    }
});
