import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {impersonateAccountAsSystemContext} from "~/server/spaces/impersonate_account_as_system_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection: {internalGetUpdateOurAccountNameTaskTransactionEntries: () => []},
});

test("can impersonate an account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(
        await impersonateAccountAsSystemContext(
            space.systemAction(),
            session.account.id,
            async context => ({
                actorType: context.actor.type,
                spaceId: context.actor.getSpaceId(),
                accountId: context.actor.getAccountId(),
            }),
        ),
    ).toEqual({
        actorType: "ImpersonatedAccount",
        spaceId: space.id,
        accountId: session.account.id,
    });
});

test("can’t impersonate an account as a session actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    await expect(
        impersonateAccountAsSystemContext(
            // @ts-expect-error
            session.action(),
            session.account.id,
            async context => ({
                actorType: context.actor.type,
                spaceId: context.actor.getSpaceId(),
                accountId: context.actor.getAccountId(),
            }),
        ),
    ).rejects.toThrow("Session actor is not a system actor");
});

test("can’t impersonate an account as an impersonated account actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    await expect(
        impersonateAccountAsSystemContext(
            // @ts-expect-error
            space.impersonatedAction(session),
            session.account.id,
            async context => ({
                actorType: context.actor.type,
                spaceId: context.actor.getSpaceId(),
                accountId: context.actor.getAccountId(),
            }),
        ),
    ).rejects.toThrow("Impersonated account actor is not a system actor");
});

test("can’t impersonate an account as a bot actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const botAccount = await TestBot.createAndInstantiate(session);

    await expect(
        impersonateAccountAsSystemContext(
            // @ts-expect-error
            botAccount.action(),
            session.account.id,
            async context => ({
                actorType: context.actor.type,
                spaceId: context.actor.getSpaceId(),
                accountId: context.actor.getAccountId(),
            }),
        ),
    ).rejects.toThrow("Bot actor is not a system actor");
});

test("can’t impersonate an account as a bot actor with a scope for that account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const botAccount = await TestBot.createAndInstantiate(session);

    await expect(
        impersonateAccountAsSystemContext(
            // @ts-expect-error
            botAccount.action({type: "Account", accountId: session.account.id}),
            session.account.id,
            async context => ({
                actorType: context.actor.type,
                spaceId: context.actor.getSpaceId(),
                accountId: context.actor.getAccountId(),
            }),
        ),
    ).rejects.toThrow("Bot actor is not a system actor");
});

test("can’t impersonate an account that’s not a member of the space", async () => {
    const space = await TestSpace.create(context);

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    await expect(
        impersonateAccountAsSystemContext(
            space.systemAction(),
            otherSession.account.id,
            async context => ({
                actorType: context.actor.type,
                spaceId: context.actor.getSpaceId(),
                accountId: context.actor.getAccountId(),
            }),
        ),
    ).rejects.toThrow("Can’t impersonate account that’s not a member of system actor’s space");
});

test("can’t impersonate bot account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const botAccount = await TestBot.createAndInstantiate(session);

    await expect(
        impersonateAccountAsSystemContext(space.systemAction(), botAccount.id, async context => ({
            actorType: context.actor.type,
            spaceId: context.actor.getSpaceId(),
            accountId: context.actor.getAccountId(),
        })),
    ).rejects.toThrow("Can’t impersonate bot account");
});
