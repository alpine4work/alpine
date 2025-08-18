import {getOurLastOpenedSpaceId} from "~/server/accounts/with_spaces/get_our_last_opened_space_id.js";
import {updateOurLastOpenedSpaceId} from "~/server/accounts/with_spaces/update_our_last_opened_space_id.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {removeSpaceAccount} from "~/server/spaces/spaces_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext();

describe("getOurLastOpenedSpaceId()", () => {
    test("should return the correct spaceId for a space we have access to", async () => {
        const space1 = await TestSpace.create(context);
        const session = await space1.createSession();

        await updateOurLastOpenedSpaceId(session.action(), space1.id);

        const result = await getOurLastOpenedSpaceId(session.action());
        expect(result).toBe(space1.id);
    });

    test("defaults when the lastOpenedSpaceId is set to an account we’re invited to", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});
        const session = await space1.createSession();
        const email = await session.account.createEmailAddress();

        // Add our account and update the space ID
        await space2.addAccount(session);
        await updateOurLastOpenedSpaceId(session.action(), space2.id);

        // Remove the account and re-invite it
        await removeSpaceAccount(space2OwnerSession.action(), {
            spaceId: space2.id,
            accountId: session.account.id,
        });
        await space2.inviteEmailAddress(space2OwnerSession.action(), email);

        // Should default to our first space
        const result = await getOurLastOpenedSpaceId(session.action());
        expect(result).toBe(space1.id);
    });

    test("defaults when the lastOpenedSpaceId is set to an account we’re removed from", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});
        const session = await space1.createSession();

        // Add our account and update the space ID
        await space2.addAccount(session);
        await updateOurLastOpenedSpaceId(session.action(), space2.id);

        // Remove the account and re-invite it
        await removeSpaceAccount(space2OwnerSession.action(), {
            spaceId: space2.id,
            accountId: session.account.id,
        });

        // Should default to our first space
        const result = await getOurLastOpenedSpaceId(session.action());
        expect(result).toBe(space1.id);
    });
});
