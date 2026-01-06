import {authorizeInternalAccess} from "~/server/accounts/authorize_internal_access.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext();

test("can authorize internal access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({hasInternalAccess: true});
    const account1 = session1.account;
    const session2 = await space.createSession();
    const account2 = await TestAccount.create(context);

    await authorizeInternalAccess(session1.action());

    await expect(authorizeInternalAccess(session2.action())).rejects.toThrow(
        "Account does not have internal access",
    );

    await expect(authorizeInternalAccess(space.systemAction())).rejects.toThrow(
        "System actor does not have internal access",
    );

    await expect(authorizeInternalAccess(context.anonymousAction())).rejects.toThrow(
        "Unauthenticated session",
    );

    await expect(
        authorizeInternalAccess(context.impersonatedAccountAction(space.id, account1.id)),
    ).rejects.toThrow("Impersonated account actor does not have internal access");

    await expect(
        authorizeInternalAccess(context.impersonatedAccountAction(space.id, account2.id)),
    ).rejects.toThrow("Impersonated account actor does not have internal access");
});
