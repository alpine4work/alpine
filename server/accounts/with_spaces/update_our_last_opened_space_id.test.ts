import {getAccountSettingsForTest} from "~/server/accounts/accounts_table.js";
import {updateOurLastOpenedSpaceId} from "~/server/accounts/with_spaces/update_our_last_opened_space_id.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {removeSpaceAccount} from "~/server/spaces/spaces_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.js";

const context = createTestContext();

describe("updateOurLastOpenedSpaceId()", () => {
    test("should allow updating the lastOpenedSpaceId for the current session", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);

        const session = await space1.createSession();
        await space2.addAccount(session);

        await updateOurLastOpenedSpaceId(session.action(), space1.id);

        const result1 = await getAccountSettingsForTest(session.action(), session.account.id);
        expect(result1.lastOpenedSpaceId).toBe(space1.id);

        await updateOurLastOpenedSpaceId(session.action(), space2.id);

        const result2 = await getAccountSettingsForTest(session.action(), session.account.id);
        expect(result2.lastOpenedSpaceId).toBe(space2.id);
    });

    test("does not allow updating the lastOpenedSpaceId to a space the session in not a member of", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);

        const session = await space1.createSession();

        await expect(updateOurLastOpenedSpaceId(session.action(), space2.id)).rejects.toThrow(
            new PermissionDeniedError("You don’t have access to this space."),
        );
    });

    test("does not allow updating the lastOpenedSpaceId to a space the session is invited to", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});

        const session = await space1.createSession();
        const email = await session.account.createEmailAddress();

        await space2.inviteEmailAddress(space2OwnerSession.action(), email);

        await expect(updateOurLastOpenedSpaceId(session.action(), space2.id)).rejects.toThrow(
            new PermissionDeniedError("You don’t have access to this space."),
        );
    });

    test("does not allow updating the lastOpenedSpaceId to a space the session is removed from", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});

        const session = await space1.createSession();
        await space2.addAccount(session);

        await removeSpaceAccount(space2OwnerSession.action(), {
            spaceId: space2.id,
            accountId: session.account.id,
        });

        await expect(updateOurLastOpenedSpaceId(session.action(), space2.id)).rejects.toThrow(
            new PermissionDeniedError("You don’t have access to this space."),
        );
    });
});
