import {updateOurAccountSettings} from "~/server/accounts/update_our_account_settings.js";
import {getOurLastOpenedSpaceId} from "~/server/accounts/with_spaces/get_our_last_opened_space_id.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {removeSpaceAccount} from "~/server/spaces/remove_space_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.open_source.js";

const context = createTestContext({
    notificationsInjection: {
        notifyInboxOfTimeZoneChange: asyncNoop,
    },
});

test("should return the correct spaceId for a space we have access to", async () => {
    const space1 = await TestSpace.create(context);
    const session = await space1.createSession();

    await updateOurAccountSettings(session.action(), {
        type: "UpdateLastOpenedSpaceId",
        spaceId: space1.id,
    });

    const result = await getOurLastOpenedSpaceId(session.action());
    expect(result).toBe(space1.id);
});

test("defaults when the lastOpenedSpaceId is set to an account we\u2019re invited to", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const space2OwnerSession = await space2.createSession({role: "Owner"});
    const session = await space1.createSession();
    const email = await session.account.createEmailAddress();

    // Add our account and update the space ID
    await space2.addAccount(session);
    await updateOurAccountSettings(session.action(), {
        type: "UpdateLastOpenedSpaceId",
        spaceId: space2.id,
    });

    // Remove the account and re-invite it
    await removeSpaceAccount(space2OwnerSession.action(), {
        spaceId: space2.id,
        accountId: session.account.id,
    });
    await space2OwnerSession.inviteEmailAddress(email);

    // Should default to our first space
    const result = await getOurLastOpenedSpaceId(session.action());
    expect(result).toBe(space1.id);
});

test("defaults when the lastOpenedSpaceId is set to an account we\u2019re removed from", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const space2OwnerSession = await space2.createSession({role: "Owner"});
    const session = await space1.createSession();

    // Add our account and update the space ID
    await space2.addAccount(session);
    await updateOurAccountSettings(session.action(), {
        type: "UpdateLastOpenedSpaceId",
        spaceId: space2.id,
    });

    // Remove the account and re-invite it
    await removeSpaceAccount(space2OwnerSession.action(), {
        spaceId: space2.id,
        accountId: session.account.id,
    });

    // Should default to our first space
    const result = await getOurLastOpenedSpaceId(session.action());
    expect(result).toBe(space1.id);
});
