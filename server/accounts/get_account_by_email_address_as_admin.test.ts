import {getAccountByEmailAddressAsAdmin} from "~/server/accounts/get_account_by_email_address_as_admin.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {validateEmailAddress} from "~/shared/helpers/string/email_address.js";
import {generateId} from "~/shared/id/id.js";

const context = createTestContext();

test("can get any account by email address as admin", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const space3 = await TestSpace.create(context);

    const session1 = await space1.createSession();
    const session2 = await space2.createSession();
    const session3 = await space3.createSession();
    const session4a = await space1.createSession();
    const session4b = await space2.createSession(session4a.account);

    const emailAddress1 = await session1.account.createEmailAddress();
    const emailAddress3a = await session3.account.createEmailAddress();
    const emailAddress3b = await session3.account.createEmailAddress();
    const emailAddress4 = await session4a.account.createEmailAddress();

    const adminSession = await space1.createSession({hasInternalAccess: true});
    const adminEmailAddress = await adminSession.account.createEmailAddress();

    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), session1.account.id as any),
    ).rejects.toThrow(NotFoundError);

    await expect(
        getAccountByEmailAddressAsAdmin(
            adminSession.action(),
            validateEmailAddress(`account.${generateId()}@test.cyberworlds.dev`),
        ),
    ).rejects.toThrow(NotFoundError);

    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), adminEmailAddress),
    ).resolves.toEqual(await adminSession.account.get());
    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), emailAddress1),
    ).resolves.toEqual(await session1.account.get());
    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), emailAddress3a),
    ).resolves.toEqual(await session3.account.get());
    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), emailAddress3b),
    ).resolves.toEqual(await session3.account.get());
    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), emailAddress4),
    ).resolves.toEqual(await session4a.account.get());
    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), emailAddress4),
    ).resolves.toEqual(await session4b.account.get());

    for (const session of [session1, session2, session3, session4a, session4b]) {
        await expect(
            getAccountByEmailAddressAsAdmin(session.action(), adminEmailAddress),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            getAccountByEmailAddressAsAdmin(session.action(), emailAddress1),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            getAccountByEmailAddressAsAdmin(session.action(), emailAddress3a),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            getAccountByEmailAddressAsAdmin(session.action(), emailAddress3b),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            getAccountByEmailAddressAsAdmin(session.action(), emailAddress4),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            getAccountByEmailAddressAsAdmin(session.action(), emailAddress4),
        ).rejects.toThrow(PermissionDeniedError);
    }

    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), emailAddress3b),
    ).resolves.toEqual(await session3.account.get());
});
