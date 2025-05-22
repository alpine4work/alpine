import {
    deleteAccountAppleDeviceTokenIfExists,
    internalUpdateOurAccountNameWithoutUpdatingTasks,
    registerOurAccountAppleDeviceToken,
} from "~/server/accounts/accounts_table.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {dangerouslyAddSpaceAccountAsAdmin} from "~/server/spaces/add_account/dangerously_add_space_account_as_admin.js";
import {
    authorizeSpaceAccess,
    authorizeSpaceAccessIfPossible,
    expensivelyGetAllSpaceAccounts,
    getAccount,
    getAccountIfExists,
    getOurAccountSpaceIds,
    getRegisteredAccountDevices,
    getSpace,
    getSpaceAccountNameSearchIndex,
    getSpaceAccountsCacheForTest,
    isAccountMemberOfSpaceWithoutAuthorization,
    removeSpaceAccountAsAdmin,
    updateSpaceName,
} from "~/server/spaces/spaces_table.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {
    FailedPreconditionError,
    InternalError,
    NotFoundError,
    PermissionDeniedError,
    UnauthenticatedError,
} from "~/shared/error/error.js";
import {compareArrays} from "~/shared/helpers/array/compare_arrays.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {generateId} from "~/shared/id/id.js";
import {ContentMentionAccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const context = createTestContext();

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

    const [sessionA1, sessionA2, sessionA3] = await spaceA.createSessions(3);
    const [sessionB1, sessionB2, sessionB3] = await spaceB.createSessions(3);

    await expect(
        expensivelyGetAllSpaceAccounts(context.action(sessionA1), spaceA.id),
    ).resolves.toEqual(
        [
            await getAccount(context.action(sessionA1), spaceA.id, sessionA1.account.id),
            await getAccount(context.action(sessionA2), spaceA.id, sessionA2.account.id),
            await getAccount(context.action(sessionA3), spaceA.id, sessionA3.account.id),
        ].sort((account1, account2) => defaultCompareStrings(account1.id, account2.id)),
    );

    await expect(
        expensivelyGetAllSpaceAccounts(context.action(sessionB1), spaceB.id),
    ).resolves.toEqual(
        [
            await getAccount(context.action(sessionB1), spaceB.id, sessionB1.account.id),
            await getAccount(context.action(sessionB2), spaceB.id, sessionB2.account.id),
            await getAccount(context.action(sessionB3), spaceB.id, sessionB3.account.id),
        ].sort((account1, account2) => defaultCompareStrings(account1.id, account2.id)),
    );
});

test("can not call `getAccount()` with `ContentMentionAccountId`", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async function testTypes(
        context: ServerActionContext,
        spaceId: SpaceId,
        accountId: ContentMentionAccountId,
    ) {
        await getAccount(
            context,
            spaceId,
            // @ts-expect-error: Can't call with `ContentMentionId`
            accountId,
        );
    }
});

test("can call `getAccountIfExists()` with `ContentMentionAccountId`", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async function testTypes(
        context: ServerActionContext,
        spaceId: SpaceId,
        accountId: ContentMentionAccountId,
    ) {
        await getAccountIfExists(context, spaceId, accountId);
    }
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

test("can remove account from space as admin", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, session3, otherSession] = await runAllPromises([
        space.createSession({hasInternalAccess: true}),
        space.createSession(),
        space.createSession(),
        otherSpace.createSession(),
    ]);

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

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    await removeSpaceAccountAsAdmin(session1.action(), {
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

    await removeSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session1.account.id,
    });

    expect(await isMember(space, session1)).toEqual(false);
    expect(await isMember(space, session2)).toEqual(false);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    await dangerouslyAddSpaceAccountAsAdmin(session1.action(), {
        spaceId: otherSpace.id,
        accountId: session2.account.id,
    });

    expect(await isMember(space, session1)).toEqual(false);
    expect(await isMember(space, session2)).toEqual(false);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(true);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    await removeSpaceAccountAsAdmin(session1.action(), {
        spaceId: otherSpace.id,
        accountId: session2.account.id,
    });

    expect(await isMember(space, session1)).toEqual(false);
    expect(await isMember(space, session2)).toEqual(false);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);
});

test("can't remove account from space as non-admin", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, session3, otherSession] = await runAllPromises([
        space.createSession({hasInternalAccess: true}),
        space.createSession(),
        space.createSession(),
        otherSpace.createSession(),
    ]);

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

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    await expect(
        removeSpaceAccountAsAdmin(session2.action(), {
            spaceId: space.id,
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

test("can't remove account from space that doesn't exist as admin", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, session3, otherSession] = await runAllPromises([
        space.createSession({hasInternalAccess: true}),
        space.createSession(),
        space.createSession(),
        otherSpace.createSession(),
    ]);

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

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    await expect(
        removeSpaceAccountAsAdmin(session1.action(), {
            spaceId: generateId(),
            accountId: session2.account.id,
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

test("can't remove account that doesn't exist from space as admin", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, session3, otherSession] = await runAllPromises([
        space.createSession({hasInternalAccess: true}),
        space.createSession(),
        space.createSession(),
        otherSpace.createSession(),
    ]);

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

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    await expect(
        removeSpaceAccountAsAdmin(session1.action(), {
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

test("can't remove account from space that account is not a member of as admin", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, session3, otherSession] = await runAllPromises([
        space.createSession({hasInternalAccess: true}),
        space.createSession(),
        space.createSession(),
        otherSpace.createSession(),
    ]);

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

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    await expect(
        removeSpaceAccountAsAdmin(session1.action(), {
            spaceId: otherSpace.id,
            accountId: session2.account.id,
        }),
    ).rejects.toThrow(FailedPreconditionError);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);
});

test("can't remove account from space if it's already been removed as admin", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, session3, otherSession] = await runAllPromises([
        space.createSession({hasInternalAccess: true}),
        space.createSession(),
        space.createSession(),
        otherSpace.createSession(),
    ]);

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

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(true);

    await removeSpaceAccountAsAdmin(session1.action(), {
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
        removeSpaceAccountAsAdmin(session1.action(), {
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

test("removing an account from a space updates the account's space ids", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, session3, otherSession] = await runAllPromises([
        space.createSession({hasInternalAccess: true}),
        space.createSession(),
        space.createSession(),
        otherSpace.createSession(),
    ]);

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

    await removeSpaceAccountAsAdmin(session1.action(), {
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

    await dangerouslyAddSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: otherSession.account.id,
    });

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

    await removeSpaceAccountAsAdmin(session1.action(), {
        spaceId: otherSpace.id,
        accountId: otherSession.account.id,
    });

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(false);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(true);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(false);

    expect(Array.from((await getOurAccountSpaceIds(session1.action())).spaceIds)).toEqual([
        space.id,
    ]);
    expect(Array.from((await getOurAccountSpaceIds(session2.action())).spaceIds)).toEqual([]);
    expect(Array.from((await getOurAccountSpaceIds(session3.action())).spaceIds)).toEqual([
        space.id,
    ]);
    expect(Array.from((await getOurAccountSpaceIds(otherSession.action())).spaceIds)).toEqual([
        space.id,
    ]);

    await dangerouslyAddSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, session3)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(true);
    expect(await isMember(otherSpace, session1)).toEqual(false);
    expect(await isMember(otherSpace, session2)).toEqual(false);
    expect(await isMember(otherSpace, session3)).toEqual(false);
    expect(await isMember(otherSpace, otherSession)).toEqual(false);

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
        space.id,
    ]);
});

test("`isAccountMemberOfSpace()` caches a true result in context", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, otherSession] = await runAllPromises([
        space.createSession({hasInternalAccess: true}),
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

    await removeSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await isMember(context.withCache(), space, session1)).toEqual(true);
    expect(await isMember(context.withCache(), space, session2)).toEqual(false);
    expect(await isMember(context.withCache(), space, otherSession)).toEqual(false);
    expect(await isMember(cacheContext, space, session1)).toEqual(true);
    expect(await isMember(cacheContext, space, session2)).toEqual(true);
    expect(await isMember(cacheContext, space, otherSession)).toEqual(false);

    await dangerouslyAddSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: otherSession.account.id,
    });

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
        space.createSession({hasInternalAccess: true}),
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

    await removeSpaceAccountAsAdmin(session1.action(), {
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

    await dangerouslyAddSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: otherSession.account.id,
    });

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
        space.createSession({hasInternalAccess: true}),
        space.createSession(),
        otherSpace.createSession(),
    ]);

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

    const spaceAccountsCache = getSpaceAccountsCacheForTest();
    await spaceAccountsCache.dangerouslyGetDataWithoutAuthorizing(context.withCache(), space.id);

    await removeSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(true);
    expect(await isMember(space, otherSession)).toEqual(false);

    await dangerouslyAddSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: otherSession.account.id,
    });

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
        space.createSession({hasInternalAccess: true}),
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

    await removeSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await isMember(context.withCache(), space, session1)).toEqual(true);
    expect(await isMember(context.withCache(), space, session2)).toEqual(false);
    expect(await isMember(context.withCache(), space, otherSession)).toEqual(false);
    expect(await isMember(cacheContext, space, session1)).toEqual(true);
    expect(await isMember(cacheContext, space, session2)).toEqual(false);
    expect(await isMember(cacheContext, space, otherSession)).toEqual(false);

    await dangerouslyAddSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

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
        space.createSession({hasInternalAccess: true}),
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

    await removeSpaceAccountAsAdmin(session1.action(), {
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

    await dangerouslyAddSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

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
        space.createSession({hasInternalAccess: true}),
        space.createSession(),
        otherSpace.createSession(),
    ]);

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

    await removeSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    const spaceAccountsCache = getSpaceAccountsCacheForTest();
    await spaceAccountsCache.dangerouslyGetDataWithoutAuthorizing(context.withCache(), space.id);

    expect(await isMember(space, session1)).toEqual(true);
    expect(await isMember(space, session2)).toEqual(false);
    expect(await isMember(space, otherSession)).toEqual(false);

    await dangerouslyAddSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

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
        space.createSession({hasInternalAccess: true}),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        new AccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await removeSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        new AccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 1,
                joinedTime: expect.any(Date),
                wasRemoved: true,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await dangerouslyAddSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        new AccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 2,
                joinedTime: expect.any(Date),
                wasRemoved: false,
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
        space.createSession({hasInternalAccess: true}),
        space.createSession(),
    ]);

    const cacheContext1 = session1.action();
    const cacheContext2 = session1.action();

    const cachedAccount1 = await getAccountIfExists(cacheContext1, space.id, session2.account.id);

    expect(cachedAccount1).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(cacheContext1, space.id, session2.account.id)).toBe(
        cachedAccount1,
    );

    await removeSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    const cachedAccount2 = await getAccountIfExists(cacheContext2, space.id, session2.account.id);

    expect(await getAccountIfExists(cacheContext1, space.id, session2.account.id)).toBe(
        cachedAccount1,
    );
    expect(cachedAccount2).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 1,
                joinedTime: expect.any(Date),
                wasRemoved: true,
            },
        }),
    );

    await dangerouslyAddSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await getAccountIfExists(cacheContext1, space.id, session2.account.id)).toBe(
        cachedAccount1,
    );
    expect(await getAccountIfExists(cacheContext2, space.id, session2.account.id)).toBe(
        cachedAccount2,
    );

    const cachedAccount3 = await getAccountIfExists(cacheContext2, space.id, session2.account.id, {
        consistency: "Strong",
    });

    expect(cachedAccount2).not.toBe(cachedAccount3);
    expect(cachedAccount3).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 2,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );

    expect(await getAccountIfExists(cacheContext1, space.id, session2.account.id)).toBe(
        cachedAccount1,
    );
    expect(await getAccountIfExists(cacheContext2, space.id, session2.account.id)).toBe(
        cachedAccount3,
    );
});

test("`getAccountIfExists()` will return cached accounts from `spaceAccountsCache`", async () => {
    const [space, otherSpace] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1, session2, otherSession] = await runAllPromises([
        space.createSession({hasInternalAccess: true}),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    const spaceAccountsCache = getSpaceAccountsCacheForTest();

    await spaceAccountsCache.dangerouslyGetDataWithoutAuthorizing(context.withCache(), space.id);

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        new AccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await removeSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        new AccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    spaceAccountsCache.clearForTest();

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        new AccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 1,
                joinedTime: expect.any(Date),
                wasRemoved: true,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await spaceAccountsCache.dangerouslyGetDataWithoutAuthorizing(context.withCache(), space.id);

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        new AccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 1,
                joinedTime: expect.any(Date),
                wasRemoved: true,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await dangerouslyAddSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        new AccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(
        await getAccountIfExists(session1.action(), space.id, session2.account.id, {
            consistency: "Strong",
        }),
    ).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 2,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 1,
                joinedTime: expect.any(Date),
                wasRemoved: true,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    spaceAccountsCache.clearForTest();

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        new AccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 2,
                joinedTime: expect.any(Date),
                wasRemoved: false,
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
        space.createSession({hasInternalAccess: true}),
        space.createSession(),
        otherSpace.createSession(),
    ]);

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        new AccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 0,
            name: session2.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await internalUpdateOurAccountNameWithoutUpdatingTasks(session2.action(), "Shawn Tyson", {
        getOurAccountSpaceIds,
        getTaskTransactionEntries: () => [],
    });

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        new AccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 1,
            name: "Shawn Tyson",
            nameVersion: 1,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await removeSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        new AccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 1,
            name: "Shawn Tyson",
            nameVersion: 1,
            space: {
                version: 1,
                joinedTime: expect.any(Date),
                wasRemoved: true,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await internalUpdateOurAccountNameWithoutUpdatingTasks(session2.action(), "Shawn Meredith", {
        getOurAccountSpaceIds,
        getTaskTransactionEntries: () => [],
    });

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        new AccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 1,
            name: "Shawn Tyson",
            nameVersion: 1,
            space: {
                version: 1,
                joinedTime: expect.any(Date),
                wasRemoved: true,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );

    await dangerouslyAddSpaceAccountAsAdmin(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    expect(await getAccountIfExists(session1.action(), space.id, session1.account.id)).toEqual(
        new AccountModel({
            id: session1.account.id,
            version: 0,
            name: session1.account.initialName,
            nameVersion: 0,
            space: {
                version: 0,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, session2.account.id)).toEqual(
        new AccountModel({
            id: session2.account.id,
            version: 2,
            name: "Shawn Meredith",
            nameVersion: 2,
            space: {
                version: 2,
                joinedTime: expect.any(Date),
                wasRemoved: false,
            },
        }),
    );
    expect(await getAccountIfExists(session1.action(), space.id, otherSession.account.id)).toEqual(
        null,
    );
});

test("can get an account's registered apple devices", async () => {
    const [space1, space2] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1A, session1B, session2A, sharedSession] = await runAllPromises([
        space1.createSession(),
        space1.createSession(),
        space2.createSession(),
        space1.createSession(),
    ]);

    await space2.addAccount(sharedSession.account);

    await expect(
        getRegisteredAccountDevices(session1A.action(), session1A.account.id),
    ).resolves.toEqual([]);

    await expect(
        getRegisteredAccountDevices(session1B.action(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(session2A.action(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(sharedSession.action(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(space1.systemAction(), session1A.account.id),
    ).resolves.toEqual([]);

    await expect(
        getRegisteredAccountDevices(space2.systemAction(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(context.anonymousAction(), session1A.account.id),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(
        getRegisteredAccountDevices(session1B.action(), session1B.account.id),
    ).resolves.toEqual([]);

    await expect(
        getRegisteredAccountDevices(session1A.action(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(session2A.action(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(sharedSession.action(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(space1.systemAction(), session1B.account.id),
    ).resolves.toEqual([]);

    await expect(
        getRegisteredAccountDevices(space2.systemAction(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(context.anonymousAction(), session1B.account.id),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(
        getRegisteredAccountDevices(sharedSession.action(), sharedSession.account.id),
    ).resolves.toEqual([]);

    await expect(
        getRegisteredAccountDevices(session1A.action(), sharedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(session1B.action(), sharedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(session2A.action(), sharedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(space1.systemAction(), sharedSession.account.id),
    ).resolves.toEqual([]);

    await expect(
        getRegisteredAccountDevices(space2.systemAction(), sharedSession.account.id),
    ).resolves.toEqual([]);

    await expect(
        getRegisteredAccountDevices(context.anonymousAction(), sharedSession.account.id),
    ).rejects.toThrow(UnauthenticatedError);

    const deviceToken1A = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));
    const deviceToken1B1 = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));
    const deviceToken1B2 = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));
    const deviceToken1B3 = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));
    const sharedDeviceToken = new Uint8Array(
        createArrayWithLength(32, () => randomInteger(0, 255)),
    );

    expect(deviceToken1A).toEqual(deviceToken1A);
    expect(deviceToken1A).not.toEqual(deviceToken1B1);
    expect(deviceToken1A).not.toEqual(sharedDeviceToken);
    expect(deviceToken1B1).not.toEqual(deviceToken1B2);

    // Run twice intentionally to test idempotence.
    await registerOurAccountAppleDeviceToken(session1A.action(), deviceToken1A);
    await registerOurAccountAppleDeviceToken(session1A.action(), deviceToken1A);

    await registerOurAccountAppleDeviceToken(session1B.action(), deviceToken1B1);
    await registerOurAccountAppleDeviceToken(session1B.action(), deviceToken1B2);
    await registerOurAccountAppleDeviceToken(session1B.action(), deviceToken1B3);

    await registerOurAccountAppleDeviceToken(sharedSession.action(), sharedDeviceToken);

    await expect(
        getRegisteredAccountDevices(session1A.action(), session1A.account.id),
    ).resolves.toEqual([{type: "Apple", deviceToken: deviceToken1A}]);

    await expect(
        getRegisteredAccountDevices(session1B.action(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(session2A.action(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(sharedSession.action(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(space1.systemAction(), session1A.account.id),
    ).resolves.toEqual([{type: "Apple", deviceToken: deviceToken1A}]);

    await expect(
        getRegisteredAccountDevices(space2.systemAction(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(context.anonymousAction(), session1A.account.id),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(
        getRegisteredAccountDevices(session1B.action(), session1B.account.id).then(devices =>
            Array.from(devices).sort((a, b) =>
                compareArrays(
                    Array.from(a.deviceToken),
                    Array.from(b.deviceToken),
                    (a, b) => a - b,
                ),
            ),
        ),
    ).resolves.toEqual(
        [
            {type: "Apple", deviceToken: deviceToken1B1},
            {type: "Apple", deviceToken: deviceToken1B2},
            {type: "Apple", deviceToken: deviceToken1B3},
        ].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );

    await expect(
        getRegisteredAccountDevices(session1A.action(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(session2A.action(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(sharedSession.action(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(space1.systemAction(), session1B.account.id).then(devices =>
            Array.from(devices).sort((a, b) =>
                compareArrays(
                    Array.from(a.deviceToken),
                    Array.from(b.deviceToken),
                    (a, b) => a - b,
                ),
            ),
        ),
    ).resolves.toEqual(
        [
            {type: "Apple", deviceToken: deviceToken1B1},
            {type: "Apple", deviceToken: deviceToken1B2},
            {type: "Apple", deviceToken: deviceToken1B3},
        ].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );

    await expect(
        getRegisteredAccountDevices(space2.systemAction(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(context.anonymousAction(), session1B.account.id),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(
        getRegisteredAccountDevices(sharedSession.action(), sharedSession.account.id),
    ).resolves.toEqual([{type: "Apple", deviceToken: sharedDeviceToken}]);

    await expect(
        getRegisteredAccountDevices(session1A.action(), sharedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(session1B.action(), sharedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(session2A.action(), sharedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(space1.systemAction(), sharedSession.account.id),
    ).resolves.toEqual([{type: "Apple", deviceToken: sharedDeviceToken}]);

    await expect(
        getRegisteredAccountDevices(space2.systemAction(), sharedSession.account.id),
    ).resolves.toEqual([{type: "Apple", deviceToken: sharedDeviceToken}]);

    await expect(
        getRegisteredAccountDevices(context.anonymousAction(), sharedSession.account.id),
    ).rejects.toThrow(UnauthenticatedError);
});

test("can delete an account's registered apple devices", async () => {
    const space = await TestSpace.create(context);

    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const deviceToken1A = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));
    const deviceToken1B = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));
    const deviceToken1C = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));
    const deviceToken1D = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));

    expect(deviceToken1A).toEqual(deviceToken1A);
    expect(deviceToken1A).not.toEqual(deviceToken1B);
    expect(deviceToken1A).not.toEqual(deviceToken1C);
    expect(deviceToken1A).not.toEqual(deviceToken1D);

    await registerOurAccountAppleDeviceToken(session1.action(), deviceToken1A);
    await registerOurAccountAppleDeviceToken(session1.action(), deviceToken1B);
    await registerOurAccountAppleDeviceToken(session1.action(), deviceToken1C);
    await registerOurAccountAppleDeviceToken(session1.action(), deviceToken1D);

    await expect(
        getRegisteredAccountDevices(space.systemAction(), session1.account.id).then(devices =>
            Array.from(devices).sort((a, b) =>
                compareArrays(
                    Array.from(a.deviceToken),
                    Array.from(b.deviceToken),
                    (a, b) => a - b,
                ),
            ),
        ),
    ).resolves.toEqual(
        [
            {type: "Apple", deviceToken: deviceToken1A},
            {type: "Apple", deviceToken: deviceToken1B},
            {type: "Apple", deviceToken: deviceToken1C},
            {type: "Apple", deviceToken: deviceToken1D},
        ].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );

    await expect(
        deleteAccountAppleDeviceTokenIfExists(
            session2.action(),
            session1.account.id,
            deviceToken1A,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        deleteAccountAppleDeviceTokenIfExists(
            context.anonymousAction(),
            session1.account.id,
            deviceToken1A,
        ),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(
        deleteAccountAppleDeviceTokenIfExists(
            context.impersonatedAccountAction(space.id, session2.account.id),
            session1.account.id,
            deviceToken1A,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAccountDevices(space.systemAction(), session1.account.id).then(devices =>
            Array.from(devices).sort((a, b) =>
                compareArrays(
                    Array.from(a.deviceToken),
                    Array.from(b.deviceToken),
                    (a, b) => a - b,
                ),
            ),
        ),
    ).resolves.toEqual(
        [
            {type: "Apple", deviceToken: deviceToken1A},
            {type: "Apple", deviceToken: deviceToken1B},
            {type: "Apple", deviceToken: deviceToken1C},
            {type: "Apple", deviceToken: deviceToken1D},
        ].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );

    await deleteAccountAppleDeviceTokenIfExists(
        space.systemAction(),
        session1.account.id,
        deviceToken1A,
    );

    await expect(
        getRegisteredAccountDevices(space.systemAction(), session1.account.id).then(devices =>
            Array.from(devices).sort((a, b) =>
                compareArrays(
                    Array.from(a.deviceToken),
                    Array.from(b.deviceToken),
                    (a, b) => a - b,
                ),
            ),
        ),
    ).resolves.toEqual(
        [
            {type: "Apple", deviceToken: deviceToken1B},
            {type: "Apple", deviceToken: deviceToken1C},
            {type: "Apple", deviceToken: deviceToken1D},
        ].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );

    // Run twice to test idempotence.
    await deleteAccountAppleDeviceTokenIfExists(
        space.systemAction(),
        session1.account.id,
        deviceToken1A,
    );

    await expect(
        getRegisteredAccountDevices(space.systemAction(), session1.account.id).then(devices =>
            Array.from(devices).sort((a, b) =>
                compareArrays(
                    Array.from(a.deviceToken),
                    Array.from(b.deviceToken),
                    (a, b) => a - b,
                ),
            ),
        ),
    ).resolves.toEqual(
        [
            {type: "Apple", deviceToken: deviceToken1B},
            {type: "Apple", deviceToken: deviceToken1C},
            {type: "Apple", deviceToken: deviceToken1D},
        ].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );

    await deleteAccountAppleDeviceTokenIfExists(
        session1.action(),
        session1.account.id,
        deviceToken1B,
    );

    await expect(
        getRegisteredAccountDevices(space.systemAction(), session1.account.id).then(devices =>
            Array.from(devices).sort((a, b) =>
                compareArrays(
                    Array.from(a.deviceToken),
                    Array.from(b.deviceToken),
                    (a, b) => a - b,
                ),
            ),
        ),
    ).resolves.toEqual(
        [
            {type: "Apple", deviceToken: deviceToken1C},
            {type: "Apple", deviceToken: deviceToken1D},
        ].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );

    await deleteAccountAppleDeviceTokenIfExists(
        context.impersonatedAccountAction(space.id, session1.account.id),
        session1.account.id,
        deviceToken1C,
    );

    await expect(
        getRegisteredAccountDevices(space.systemAction(), session1.account.id).then(devices =>
            Array.from(devices).sort((a, b) =>
                compareArrays(
                    Array.from(a.deviceToken),
                    Array.from(b.deviceToken),
                    (a, b) => a - b,
                ),
            ),
        ),
    ).resolves.toEqual(
        [{type: "Apple", deviceToken: deviceToken1D}].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );
});

test("can't authorize space access for anonymous actor", async () => {
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

test("can't authorize space access for impersonated actor", async () => {
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

test("prevents non-member from updating space name", async () => {
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

    //make sure the initial name wasn't "New Name".
    expect(spaceAfterAttempt.name).not.toBe("New Name");

    expect(spaceAfterAttempt.name).toBe(initialName);
    expect(spaceAfterAttempt.version).toBe(initialSpace.version);
});

test("throws PermissionDeniedError for non-existent space", async () => {
    const space = await TestSpace.create(context);
    const nonExistentSpaceId = generateId<SpaceId>();

    await expect(authorizeSpaceAccess(space.systemAction(), nonExistentSpaceId)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("validates space name against empty name and very long name", async () => {
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
