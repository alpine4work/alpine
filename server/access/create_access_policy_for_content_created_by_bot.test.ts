import {createAccessPolicyForContentCreatedByBot} from "~/server/access/create_access_policy_for_content_created_by_bot.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext({
    chatInjection,
    documentsInjection,
});

test("creates access policy with human accounts from bot scope", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const botAccount = await TestBot.createAndInstantiate(adminSession);

    // Create a chat with both sessions and the bot
    const chat = await TestChat.get(adminSession, botAccount, session2);

    const botAction = botAccount.action({type: "Chat", chatId: chat.id});

    const accessPolicy = await createAccessPolicyForContentCreatedByBot(botAction, space.id);

    expect(accessPolicy).toStrictEqual({
        accountGrantById: new Map([
            [adminSession.account.id, {level: "Manage", generation: 0}],
            [session2.account.id, {level: "Manage", generation: 0}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    });
});

test("excludes bot accounts from access policy", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const botAccount = await TestBot.createAndInstantiate(adminSession);
    const chat = await TestChat.get(adminSession, botAccount);
    const botAction = botAccount.action({type: "Chat", chatId: chat.id});

    const accessPolicy = await createAccessPolicyForContentCreatedByBot(botAction, space.id);

    expect(accessPolicy).toStrictEqual({
        accountGrantById: new Map([[adminSession.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    });
});

test("excludes accounts that are no longer space members", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const botAccount = await TestBot.createAndInstantiate(adminSession);

    // Create a chat with both sessions and the bot
    const chat = await TestChat.get(adminSession, botAccount, session2);

    // Remove session2 from the space
    await space.removeAccount(session2);

    const botAction = botAccount.action({type: "Chat", chatId: chat.id});

    const accessPolicy = await createAccessPolicyForContentCreatedByBot(botAction, space.id);

    // adminSession should still have access
    expect(accessPolicy).toStrictEqual({
        accountGrantById: new Map([[adminSession.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    });
});

test("maintains default grant", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const document = await TestDocument.create(adminSession, {access: "Public"});
    await document.access.grantDefault(adminSession);
    await document.type(adminSession, "Hello, world!");
    await document.createCommentThread(adminSession, {from: 0, to: 11}, "comment");

    const botAccount = await TestBot.createAndInstantiate(adminSession);
    const botAction = botAccount.action({type: "Document", documentId: document.id});

    const accessPolicy = await createAccessPolicyForContentCreatedByBot(botAction, space.id);

    expect(accessPolicy).toStrictEqual({
        accountGrantById: new Map([[adminSession.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: {level: "Manage", generation: 0},
        urlGrant: null,
    });
});

test("always sets url grant to null", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const document = await TestDocument.create(adminSession, {access: "Public"});
    await document.access.grantUrl(adminSession, "View");

    const botAccount = await TestBot.createAndInstantiate(adminSession);
    const botAction = botAccount.action({type: "Document", documentId: document.id});

    const accessPolicy = await createAccessPolicyForContentCreatedByBot(botAction, space.id);

    expect(accessPolicy).toStrictEqual({
        accountGrantById: new Map([[adminSession.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: {level: "Manage", generation: 0},
        urlGrant: null,
    });
});
