import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getOwnAccountAndSettingsIfExists} from "~/server/spaces/get_own_account_and_settings_if_exists.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.js";

const context = createTestContext();

test("gets own account and settings in the same space", async () => {
    const account = await TestAccount.create(context, {
        observedTimeZone: assertTimeZone("America/Los_Angeles"),
    });
    const space = await TestSpace.create(context);
    const session = await space.createSession(account);

    const result = await getOwnAccountAndSettingsIfExists(
        session.action(),
        space.id,
        session.account.id,
    );

    expect(result?.account.id).toEqual(session.account.id);
    expect(result?.account.initialData.name).toEqual(session.account.initialName);
    expect(result?.settings.observedTimeZone).toEqual("America/Los_Angeles");
});

test("does not allow accessing another account", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    await expect(() =>
        getOwnAccountAndSettingsIfExists(session1.action(), space.id, session2.account.id),
    ).rejects.toThrow(PermissionDeniedError);
});

test("does not allow accessing own account through a different space account doesn\u2019t have access to", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const session = await space1.createSession();

    expect(
        await getOwnAccountAndSettingsIfExists(session.action(), space2.id, session.account.id),
    ).toEqual(null);
});

test("does not allow accessing own account through a different space account was removed from", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const session = await space1.createSession();
    await space2.addAccount(session);

    await getOwnAccountAndSettingsIfExists(session.action(), space2.id, session.account.id);

    await space2.removeAccount(session);

    await expect(() =>
        getOwnAccountAndSettingsIfExists(session.action(), space2.id, session.account.id),
    ).rejects.toThrow(PermissionDeniedError);
});
