import {getAccountByIdAsAdmin} from "~/server/accounts/get_account_by_id_as_admin.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";

const context = createTestContext();

test("can get any account by id as admin", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const space3 = await TestSpace.create(context);

    const session1 = await space1.createSession();
    const session2 = await space2.createSession();
    const session3 = await space3.createSession();
    const session4a = await space1.createSession();
    const session4b = await space2.createSession(session4a.account);

    const adminSession = await space1.createSession({hasInternalAccess: true});

    await expect(getAccountByIdAsAdmin(adminSession.action(), generateId())).rejects.toThrow(
        NotFoundError,
    );

    await expect(
        getAccountByIdAsAdmin(adminSession.action(), adminSession.account.id),
    ).resolves.toEqual(await adminSession.account.get());
    await expect(
        getAccountByIdAsAdmin(adminSession.action(), session1.account.id),
    ).resolves.toEqual(await session1.account.get());
    await expect(
        getAccountByIdAsAdmin(adminSession.action(), session2.account.id),
    ).resolves.toEqual(await session2.account.get());
    await expect(
        getAccountByIdAsAdmin(adminSession.action(), session3.account.id),
    ).resolves.toEqual(await session3.account.get());
    await expect(
        getAccountByIdAsAdmin(adminSession.action(), session4a.account.id),
    ).resolves.toEqual(await session4a.account.get());
    await expect(
        getAccountByIdAsAdmin(adminSession.action(), session4b.account.id),
    ).resolves.toEqual(await session4a.account.get());

    for (const session of [session1, session2, session3, session4a, session4b]) {
        await expect(
            getAccountByIdAsAdmin(session.action(), adminSession.account.id),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(getAccountByIdAsAdmin(session.action(), session1.account.id)).rejects.toThrow(
            PermissionDeniedError,
        );
        await expect(getAccountByIdAsAdmin(session.action(), session2.account.id)).rejects.toThrow(
            PermissionDeniedError,
        );
        await expect(getAccountByIdAsAdmin(session.action(), session3.account.id)).rejects.toThrow(
            PermissionDeniedError,
        );
        await expect(getAccountByIdAsAdmin(session.action(), session4a.account.id)).rejects.toThrow(
            PermissionDeniedError,
        );
        await expect(getAccountByIdAsAdmin(session.action(), session4b.account.id)).rejects.toThrow(
            PermissionDeniedError,
        );
    }

    await expect(
        getAccountByIdAsAdmin(adminSession.action(), session1.account.id),
    ).resolves.toEqual(await session1.account.get());
});
