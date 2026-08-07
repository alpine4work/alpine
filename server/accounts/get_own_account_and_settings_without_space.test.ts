import {getOwnAccountAndSettingsWithoutSpace} from "~/server/accounts/get_own_account_and_settings_without_space.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {assertTimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";

const context = createTestContext();

test("gets own account and settings", async () => {
    const account = await TestAccount.create(context, {
        observedTimeZone: assertTimeZone("America/Los_Angeles"),
    });
    const session = await TestSession.create(account);

    const result = await getOwnAccountAndSettingsWithoutSpace(session.action());

    expect(result.account).toEqual(await account.get());
    expect(result.settings.observedTimeZone).toEqual("America/Los_Angeles");
});

test("uses default settings when settings item does not exist", async () => {
    const account = await TestAccount.create(context);
    const session = await TestSession.create(account);

    const result = await getOwnAccountAndSettingsWithoutSpace(session.action());

    expect(result.account).toEqual(await account.get());
    expect(result.settings.observedTimeZone).toEqual(defaultTimeZone);
});
