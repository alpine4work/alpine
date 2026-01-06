import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getAccountIfExists} from "~/server/spaces/get_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";

const context = createTestContext();

test("can get accounts in the same space as us", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    expect(
        (await getAccountIfExists(session1.action(), space.id, session1.account.id))?.initialData
            .name,
    ).toEqual(session1.account.initialName);

    expect(
        (await getAccountIfExists(session1.action(), space.id, session2.account.id))?.initialData
            .name,
    ).toEqual(session2.account.initialName);

    expect(
        (await getAccountIfExists(session1.action(), space.id, session3.account.id))?.initialData
            .name,
    ).toEqual(session3.account.initialName);
});

test("can not get accounts that don’t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(await getAccountIfExists(session.action(), space.id, generateId())).toEqual(null);
});

test("can not get accounts in a different space than us", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const space1Session1 = await space1.createSession();
    const [space2Session1, space2Session2, space2Session3] = await space2.createSessions(3);

    expect(
        await getAccountIfExists(space1Session1.action(), space1.id, space2Session1.account.id),
    ).toEqual(null);

    expect(
        await getAccountIfExists(space1Session1.action(), space1.id, space2Session2.account.id),
    ).toEqual(null);

    expect(
        await getAccountIfExists(space1Session1.action(), space1.id, space2Session3.account.id),
    ).toEqual(null);
});

test("can not get accounts through a space we don’t have access to", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const space1Session1 = await space1.createSession();
    const [space2Session1, space2Session2, space2Session3] = await space2.createSessions(3);

    await expect(() =>
        getAccountIfExists(space1Session1.action(), space2.id, generateId()),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(() =>
        getAccountIfExists(space1Session1.action(), space2.id, space2Session1.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(() =>
        getAccountIfExists(space1Session1.action(), space2.id, space2Session2.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(() =>
        getAccountIfExists(space1Session1.action(), space2.id, space2Session3.account.id),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not get accounts through a space we don’t have access to even if we have access to the accounts through a different space", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const [space1Session1, space1Session2, space1Session3] = await space1.createSessions(3);

    await expect(() =>
        getAccountIfExists(space1Session1.action(), space2.id, space1Session1.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(() =>
        getAccountIfExists(space1Session1.action(), space2.id, space1Session2.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(() =>
        getAccountIfExists(space1Session1.action(), space2.id, space1Session3.account.id),
    ).rejects.toThrow(PermissionDeniedError);
});
