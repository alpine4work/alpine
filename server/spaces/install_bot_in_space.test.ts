import {createBotForTest} from "~/server/bots/test_helpers/create_bot_for_test.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {installBotInSpace} from "~/server/spaces/install_bot_in_space.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {BotOwnerEntity} from "~/shared/bots/owners/bot_owner_entity.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection: {internalGetUpdateOurAccountNameTaskTransactionEntries: () => []},
});

const botName = "Test Bot";

async function createBotOwnedBy(ownerEntity: BotOwnerEntity): Promise<BotId> {
    const {id} = await createBotForTest(context, {name: botName, webhook: null, ownerEntity});
    return id;
}

describe("installBotInSpace()", () => {
    test("throws when the bot does not exist", async () => {
        const space = await TestSpace.create(context);
        const adminSession = await space.createSession({role: "Admin"});

        await expect(
            installBotInSpace(adminSession.action(), {
                spaceId: space.id,
                botId: generateId<BotId>(),
            }),
        ).rejects.toThrow("Bot not found");
    });

    test("throws when the bot is already installed in the space", async () => {
        const space = await TestSpace.create(context);
        const adminSession = await space.createSession({role: "Admin"});
        const botId = await createBotOwnedBy({type: "System"});
        await installBotInSpace(adminSession.action(), {spaceId: space.id, botId});

        await expect(
            installBotInSpace(adminSession.action(), {spaceId: space.id, botId}),
        ).rejects.toThrow("Bot has already been installed in this space");
    });

    describe("a bot owned by an account", () => {
        test("installs the bot for its owner in a space they are a member of", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Member"});
            const botId = await createBotOwnedBy({
                type: "Account",
                accountId: session.account.id,
            });

            const account = await installBotInSpace(session.action(), {spaceId: space.id, botId});

            expect(account.botId).toEqual(botId);
        });

        test("throws when its owner does not belong to the space", async () => {
            const space = await TestSpace.create(context);
            const otherSpace = await TestSpace.create(context);
            const session = await space.createSession({role: "Member"});
            const botId = await createBotOwnedBy({
                type: "Account",
                accountId: session.account.id,
            });

            await expect(
                installBotInSpace(session.action(), {spaceId: otherSpace.id, botId}),
            ).rejects.toThrow("Account may not install this bot in this space");
        });

        test("throws when a space admin who does not own it installs it", async () => {
            const space = await TestSpace.create(context);
            const ownerSession = await space.createSession({role: "Member"});
            const adminSession = await space.createSession({role: "Admin"});
            const botId = await createBotOwnedBy({
                type: "Account",
                accountId: ownerSession.account.id,
            });

            await expect(
                installBotInSpace(adminSession.action(), {spaceId: space.id, botId}),
            ).rejects.toThrow("Account may not install this bot in this space");
        });
    });

    describe("a bot owned by a space", () => {
        test("installs the bot for an admin of the owning space", async () => {
            const space = await TestSpace.create(context);
            const adminSession = await space.createSession({role: "Admin"});
            const botId = await createBotOwnedBy({type: "Space", spaceId: space.id});

            const account = await installBotInSpace(adminSession.action(), {
                spaceId: space.id,
                botId,
            });

            expect(account.botId).toEqual(botId);
        });

        test("installs the bot for an owner of the owning space", async () => {
            const space = await TestSpace.create(context);
            const ownerSession = await space.createSession({role: "Owner"});
            const botId = await createBotOwnedBy({type: "Space", spaceId: space.id});

            const account = await installBotInSpace(ownerSession.action(), {
                spaceId: space.id,
                botId,
            });

            expect(account.botId).toEqual(botId);
        });

        test("throws when a member of the owning space installs it", async () => {
            const space = await TestSpace.create(context);
            const memberSession = await space.createSession({role: "Member"});
            const botId = await createBotOwnedBy({type: "Space", spaceId: space.id});

            await expect(
                installBotInSpace(memberSession.action(), {spaceId: space.id, botId}),
            ).rejects.toThrow("Account may not install this bot in this space");
        });

        test("throws when installing it in a space that does not own it", async () => {
            const space = await TestSpace.create(context);
            const otherSpace = await TestSpace.create(context);
            // The actor is an admin of `otherSpace` so the install fails because of the bot's
            // owning space and not because the actor is missing admin access.
            const adminSession = await otherSpace.createSession({role: "Admin"});
            const botId = await createBotOwnedBy({type: "Space", spaceId: space.id});

            await expect(
                installBotInSpace(adminSession.action(), {spaceId: otherSpace.id, botId}),
            ).rejects.toThrow("Account may not install this bot in this space");
        });
    });

    describe("a bot owned by the system", () => {
        test("installs the bot for a space admin", async () => {
            const space = await TestSpace.create(context);
            const adminSession = await space.createSession({role: "Admin"});
            const botId = await createBotOwnedBy({type: "System"});

            const account = await installBotInSpace(adminSession.action(), {
                spaceId: space.id,
                botId,
            });

            expect(account.botId).toEqual(botId);
        });

        test("throws when a space member installs it", async () => {
            const space = await TestSpace.create(context);
            const memberSession = await space.createSession({role: "Member"});
            const botId = await createBotOwnedBy({type: "System"});

            await expect(
                installBotInSpace(memberSession.action(), {spaceId: space.id, botId}),
            ).rejects.toThrow("Account may not install this bot in this space");
        });
    });

    describe("the installed bot account", () => {
        test("joins the space as an active member named after the bot", async () => {
            const space = await TestSpace.create(context);
            const adminSession = await space.createSession({role: "Admin"});
            const botId = await createBotOwnedBy({type: "System"});

            const account = await installBotInSpace(adminSession.action(), {
                spaceId: space.id,
                botId,
            });

            expect(account.initialData).toMatchObject({
                name: botName,
                bot: {id: botId, owner: {type: "System"}},
                avatar: null,
                space: {role: "Member", state: {type: "Active"}},
            });
        });

        test("is readable by other accounts in the space", async () => {
            const space = await TestSpace.create(context);
            const adminSession = await space.createSession({role: "Admin"});
            const memberSession = await space.createSession({role: "Member"});
            const botId = await createBotOwnedBy({type: "System"});
            const {id: accountId} = await installBotInSpace(adminSession.action(), {
                spaceId: space.id,
                botId,
            });

            const account = await getAccount(memberSession.action(), space.id, accountId);

            expect(account.initialData).toMatchObject({
                name: botName,
                bot: {id: botId, owner: {type: "System"}},
                space: {role: "Member", state: {type: "Active"}},
            });
        });

        test("uses the account ID provided by the caller", async () => {
            const space = await TestSpace.create(context);
            const adminSession = await space.createSession({role: "Admin"});
            const botId = await createBotOwnedBy({type: "System"});
            const accountId = generateId<AccountId>();

            const account = await installBotInSpace(adminSession.action(), {
                spaceId: space.id,
                botId,
                accountId,
            });

            expect(account.id).toEqual(accountId);
        });
    });
});
