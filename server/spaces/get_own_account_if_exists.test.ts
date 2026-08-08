import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getOwnAccountIfExists} from "~/server/spaces/get_own_account_if_exists.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";

const context = createTestContext();

test("gets own account in the same space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const result = await getOwnAccountIfExists(session.action(), space.id, session.account.id);

    expect(result?.id).toEqual(session.account.id);
    expect(result?.initialData.name).toEqual(session.account.initialName);
});

test("does not allow accessing another account", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    await expect(() =>
        getOwnAccountIfExists(session1.action(), space.id, session2.account.id),
    ).rejects.toThrow(PermissionDeniedError);
});

test("does not allow accessing own account through a different space account doesn\u2019t have access to", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const session = await space1.createSession();

    expect(await getOwnAccountIfExists(session.action(), space2.id, session.account.id)).toEqual(
        null,
    );
});

test("does not allow accessing own account through a different space account was removed from", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const session = await space1.createSession();
    await space2.addAccount(session);

    await getOwnAccountIfExists(session.action(), space2.id, session.account.id);

    await space2.removeAccount(session);

    await expect(() =>
        getOwnAccountIfExists(session.action(), space2.id, session.account.id),
    ).rejects.toThrow(PermissionDeniedError);
});
