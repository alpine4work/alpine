import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.js";

const context = createTestContext({
    chatInjection,
});

test("bots cannot update existing access policies", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const botAccount = await TestBot.createAndInstantiate(adminSession);
    const chat = await TestChat.get(adminSession, botAccount);
    const botAction = botAccount.action({type: "Chat", chatId: chat.id});

    const oldAccessPolicy: AccessPolicy = {
        accountGrantById: new Map([[adminSession.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    const newAccessPolicy: AccessPolicy = {
        accountGrantById: new Map([[adminSession.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: {level: "View"},
        urlGrant: null,
    };

    await expect(
        validateAccessPolicyUpdateForServer(botAction, space.id, oldAccessPolicy, newAccessPolicy),
    ).rejects.toThrow(new PermissionDeniedError("Bots can’t update access policies"));
});

test("bots can create new access policies", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const botAccount = await TestBot.createAndInstantiate(adminSession);
    const chat = await TestChat.get(adminSession, botAccount);
    const botAction = botAccount.action({type: "Chat", chatId: chat.id});

    const newAccessPolicy: AccessPolicy = {
        accountGrantById: new Map([[adminSession.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    // Should not throw - bots can create new access policies (oldAccessPolicy is null)
    await expect(
        validateAccessPolicyUpdateForServer(botAction, space.id, null, newAccessPolicy),
    ).resolves.not.toThrow();
});

test("bots can’t create new access policies if they don’t have access to the conversation", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const session = await space.createSession();

    const botAccount = await TestBot.createAndInstantiate(adminSession);
    const chat = await TestChat.get(adminSession, session);
    const botAction = botAccount.action({type: "Chat", chatId: chat.id});

    const newAccessPolicy: AccessPolicy = {
        accountGrantById: new Map([[adminSession.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    await expect(
        validateAccessPolicyUpdateForServer(botAction, space.id, null, newAccessPolicy),
    ).rejects.toThrow(
        new InvalidArgumentError(
            "Account actor must have `Manage` access level on anything they create",
        ),
    );
});
