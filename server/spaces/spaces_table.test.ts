import {ServerActionContext} from "~/server/context/server_action_context.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {
    expensivelyGetAllSpaceAccounts,
    getAccount,
    getAccountIfExists,
} from "~/server/spaces/spaces_table.js";
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
