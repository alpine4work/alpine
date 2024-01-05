import {ServerActionContext} from "~/server/context/server_action_context.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {
    expensivelyGetAllSpaceAccounts,
    getAccount,
    getAccountIfExists,
    getSpaceAccountNameSearchIndex,
} from "~/server/spaces/spaces_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {ContentMentionAccountId, SpaceId} from "~/shared/id/types/id_types.js";

const context = createTestContext();
const spaceA = createTestSpace(context);
const sessionA1 = createTestSession(context, spaceA);
const sessionA2 = createTestSession(context, spaceA);
const sessionA3 = createTestSession(context, spaceA);
const spaceB = createTestSpace(context);
const sessionB1 = createTestSession(context, spaceB);
const sessionB2 = createTestSession(context, spaceB);
const sessionB3 = createTestSession(context, spaceB);

test("can not get all accounts for a space we are not in", async () => {
    await expect(
        expensivelyGetAllSpaceAccounts(context.action(sessionA1), spaceB.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        expensivelyGetAllSpaceAccounts(context.action(sessionB1), spaceA.id),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can get all accounts for our space", async () => {
    await expect(
        expensivelyGetAllSpaceAccounts(context.action(sessionA1), spaceA.id),
    ).resolves.toEqual(
        [sessionA1.account, sessionA2.account, sessionA3.account].sort((account1, account2) =>
            defaultCompareStrings(account1.id, account2.id),
        ),
    );

    await expect(
        expensivelyGetAllSpaceAccounts(context.action(sessionB1), spaceB.id),
    ).resolves.toEqual(
        [sessionB1.account, sessionB2.account, sessionB3.account].sort((account1, account2) =>
            defaultCompareStrings(account1.id, account2.id),
        ),
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

    expect(accountNameIndex.searchShortNames("Caleb")).toEqual([await session1.account.get()]);
    expect(accountNameIndex.searchShortNames("caleb")).toEqual([await session1.account.get()]);
    expect(accountNameIndex.searchShortNames("Calebs")).toEqual([await session1.account.get()]);
    expect(accountNameIndex.searchShortNames("Baleb")).toEqual([await session1.account.get()]);
    expect(accountNameIndex.searchShortNames("baleb")).toEqual([await session1.account.get()]);
    expect(accountNameIndex.searchShortNames("Siobahn")).toEqual([await session2.account.get()]);
    expect(accountNameIndex.searchShortNames("siobahn")).toEqual([await session2.account.get()]);
    expect(accountNameIndex.searchShortNames("Siobahns")).toEqual([await session2.account.get()]);
    expect(accountNameIndex.searchShortNames("Siobahnn")).toEqual([await session2.account.get()]);
    expect(accountNameIndex.searchShortNames("Soibahn")).toEqual([await session2.account.get()]);
    expect(accountNameIndex.searchShortNames("Soobahn")).toEqual([await session2.account.get()]);
    expect(accountNameIndex.searchShortNames("Soibann")).toEqual([]);
    expect(accountNameIndex.searchShortNames("Soobann")).toEqual([]);
    expect(accountNameIndex.searchShortNames("Floorbhan")).toEqual([]);
    expect(accountNameIndex.searchShortNames("Xue")).toEqual([await session3.account.get()]);
    expect(accountNameIndex.searchShortNames("Xues")).toEqual([]);
    expect(accountNameIndex.searchShortNames("Xu")).toEqual([]);
    expect(accountNameIndex.searchShortNames("Xuu")).toEqual([]);
    expect(accountNameIndex.searchShortNames("Shue")).toEqual([]);
    expect(accountNameIndex.searchShortNames("Vu")).toEqual([await session4.account.get()]);
    expect(accountNameIndex.searchShortNames("Xu")).toEqual([]);
    expect(accountNameIndex.searchShortNames("vut")).toEqual([]);
    expect(accountNameIndex.searchShortNames("l")).toEqual([await session5.account.get()]);
    expect(accountNameIndex.searchShortNames("m")).toEqual([]);
    expect(accountNameIndex.searchShortNames("k")).toEqual([]);

    expect(accountNameIndex.searchNames("Caleb")).toEqual([await session1.account.get()]);
    expect(accountNameIndex.searchNames("Caleb Meredith")).toEqual([await session1.account.get()]);
    expect(accountNameIndex.searchNames("Calebs Meredith")).toEqual([await session1.account.get()]);
    expect(accountNameIndex.searchNames("Caleb Merediths")).toEqual([await session1.account.get()]);
    expect(accountNameIndex.searchNames("Calebs Merediths")).toEqual([
        await session1.account.get(),
    ]);
    expect(accountNameIndex.searchNames("caleb meredith")).toEqual([await session1.account.get()]);
    expect(accountNameIndex.searchNames("Baleb Meredith")).toEqual([await session1.account.get()]);
    expect(accountNameIndex.searchNames("baleb meredith")).toEqual([await session1.account.get()]);
    expect(accountNameIndex.searchNames("Baleb Meredeth")).toEqual([await session1.account.get()]);
    expect(accountNameIndex.searchNames("Baleb Merideth")).toEqual([await session1.account.get()]);
    expect(accountNameIndex.searchNames("Siobahn McDonough")).toEqual([
        await session2.account.get(),
    ]);
    expect(accountNameIndex.searchNames("siobahn mcdonough")).toEqual([
        await session2.account.get(),
    ]);
    expect(accountNameIndex.searchNames("Siobahnn McDonough")).toEqual([
        await session2.account.get(),
    ]);
    expect(accountNameIndex.searchNames("Soibahn McDonough")).toEqual([
        await session2.account.get(),
    ]);
    expect(accountNameIndex.searchNames("Soobahn McDonough")).toEqual([
        await session2.account.get(),
    ]);
    expect(accountNameIndex.searchNames("Soibann McDonough")).toEqual([
        await session2.account.get(),
    ]);
    expect(accountNameIndex.searchNames("Soobann McDonough")).toEqual([
        await session2.account.get(),
    ]);
    expect(accountNameIndex.searchNames("Floorbhan McDonough")).toEqual([]);
    expect(accountNameIndex.searchNames("Xue Seng Tay")).toEqual([await session3.account.get()]);
    expect(accountNameIndex.searchNames("Xue Seng")).toEqual([await session3.account.get()]);
    expect(accountNameIndex.searchNames("Xue")).toEqual([]);
    expect(accountNameIndex.searchNames("Xu Seng Tay")).toEqual([await session3.account.get()]);
    expect(accountNameIndex.searchNames("Xuu Seng Tay")).toEqual([await session3.account.get()]);
    expect(accountNameIndex.searchNames("Shue Seng Tay")).toEqual([await session3.account.get()]);
    expect(accountNameIndex.searchNames("Vu")).toEqual([]);
    expect(accountNameIndex.searchNames("Xu")).toEqual([]);
    expect(accountNameIndex.searchNames("Vu Tran")).toEqual([await session4.account.get()]);
    expect(accountNameIndex.searchNames("Vu T")).toEqual([await session4.account.get()]);
    expect(accountNameIndex.searchNames("vut")).toEqual([]);
    expect(accountNameIndex.searchNames("Vu Tr")).toEqual([await session4.account.get()]);
    expect(accountNameIndex.searchNames("vutr")).toEqual([]);
    expect(accountNameIndex.searchNames("l")).toEqual([]);
    expect(accountNameIndex.searchNames("m")).toEqual([]);
    expect(accountNameIndex.searchNames("k")).toEqual([]);
    expect(accountNameIndex.searchNames("l l")).toEqual([]);
    expect(accountNameIndex.searchNames("l la")).toEqual([await session5.account.get()]);
    expect(accountNameIndex.searchNames("l law")).toEqual([await session5.account.get()]);
    expect(accountNameIndex.searchNames("l lawl")).toEqual([await session5.account.get()]);
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
            await session3.account.get(),
            await session4.account.get(),
            await session5.account.get(),
            await session6.account.get(),
        ].sort((a, b) => defaultCompareStrings(a.id, b.id)),
    );

    // TODO(calebmer): I wish this only matched "emily alpha". Same for the other
    // prefix matches...
    expect(
        accountNameIndex.searchNames("emily a").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [
            await session3.account.get(),
            await session4.account.get(),
            await session5.account.get(),
            await session6.account.get(),
        ].sort((a, b) => defaultCompareStrings(a.id, b.id)),
    );

    expect(
        accountNameIndex.searchNames("emily b").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [
            await session3.account.get(),
            await session4.account.get(),
            await session5.account.get(),
            await session6.account.get(),
        ].sort((a, b) => defaultCompareStrings(a.id, b.id)),
    );

    expect(
        accountNameIndex.searchNames("emily g").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [
            await session3.account.get(),
            await session4.account.get(),
            await session5.account.get(),
            await session6.account.get(),
        ].sort((a, b) => defaultCompareStrings(a.id, b.id)),
    );

    expect(
        accountNameIndex.searchNames("emily d").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [
            await session3.account.get(),
            await session4.account.get(),
            await session5.account.get(),
            await session6.account.get(),
        ].sort((a, b) => defaultCompareStrings(a.id, b.id)),
    );

    expect(
        accountNameIndex.searchNames("emily be").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [await session4.account.get(), await session6.account.get()].sort((a, b) =>
            defaultCompareStrings(a.id, b.id),
        ),
    );

    expect(
        accountNameIndex.searchNames("emily ba").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [
            await session3.account.get(),
            await session4.account.get(),
            await session5.account.get(),
        ].sort((a, b) => defaultCompareStrings(a.id, b.id)),
    );

    expect(
        accountNameIndex.searchNames("emily bet").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [await session4.account.get(), await session6.account.get()].sort((a, b) =>
            defaultCompareStrings(a.id, b.id),
        ),
    );

    expect(
        accountNameIndex.searchNames("emily bam").sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [
            await session3.account.get(),
            await session4.account.get(),
            await session5.account.get(),
        ].sort((a, b) => defaultCompareStrings(a.id, b.id)),
    );

    expect(
        accountNameIndex
            .searchNames("emily beta")
            .sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [await session4.account.get(), await session6.account.get()].sort((a, b) =>
            defaultCompareStrings(a.id, b.id),
        ),
    );

    expect(accountNameIndex.searchNames("emily bamma")).toEqual([await session5.account.get()]);

    expect(accountNameIndex.searchShortNames("e")).toEqual([]);

    expect(accountNameIndex.searchShortNames("em")).toEqual([]);

    expect(
        accountNameIndex
            .searchShortNames("emily")
            .sort((a, b) => defaultCompareStrings(a.id, b.id)),
    ).toEqual(
        [
            await session3.account.get(),
            await session4.account.get(),
            await session5.account.get(),
            await session6.account.get(),
        ].sort((a, b) => defaultCompareStrings(a.id, b.id)),
    );
});
