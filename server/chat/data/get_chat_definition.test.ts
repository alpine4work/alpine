import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {createRoomChat} from "~/server/chat/data/create_room_chat.js";
import {getChatDefinition} from "~/server/chat/data/get_chat_definition.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";

const context = createTestContext({
    chatInjection,
});

test("getChatDefinition returns direct chat account ids", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB] = await space.createSessions(2);

    const chat = await TestChat.get(sessionA, sessionB);

    expect(await getChatDefinition(sessionA.action(), chat.id)).toMatchObject({
        spaceId: space.id,
        definition: {
            type: "Direct",
            accountIds: new Set([sessionA.account.id, sessionB.account.id]),
        },
    });
});

test("getChatDefinition returns room chat definition", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {id: chatId} = await createRoomChat(session.action(), {
        spaceId: space.id,
        name: "General",
    });

    expect(await getChatDefinition(session.action(), chatId)).toMatchObject({
        spaceId: space.id,
        definition: {
            type: "Room",
            name: "General",
        },
    });
});

test("getChatDefinition enforces room chat access policies", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB] = await space.createSessions(2);

    const {id: chatId} = await createRoomChat(sessionA.action(), {
        spaceId: space.id,
        name: "Leadership",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[sessionA.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await expect(getChatDefinition(sessionB.action(), chatId)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("getChatDefinition rejects non-members for direct chats", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB, sessionC] = await space.createSessions(3);

    const chat = await TestChat.get(sessionA, sessionB);

    await expect(getChatDefinition(sessionC.action(), chat.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("getChatDefinition allows bots to access direct chats in scope", async () => {
    const space = await TestSpace.create(context);
    const sessionA = await space.createSession({role: "Admin"});
    const [sessionB] = await space.createSessions(1);
    const botAccount = await TestBot.createAndInstantiate(sessionA);

    const chat = await TestChat.get(sessionA, sessionB);

    expect(
        await getChatDefinition(botAccount.action({type: "Chat", chatId: chat.id}), chat.id),
    ).toMatchObject({
        spaceId: space.id,
        definition: {
            type: "Direct",
            accountIds: new Set([sessionA.account.id, sessionB.account.id]),
        },
    });
});

test("getChatDefinition allows bots to access room chats within scope", async () => {
    const space = await TestSpace.create(context);
    const sessionA = await space.createSession({role: "Admin"});
    const [sessionB] = await space.createSessions(1);
    const botAccount = await TestBot.createAndInstantiate(sessionA);

    const scopeChat = await TestChat.get(sessionA, sessionB);
    const {id: chatId} = await createRoomChat(sessionA.action(), {
        spaceId: space.id,
        name: "General",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([
                [sessionA.account.id, {level: "Manage", generation: 0}],
                [sessionB.account.id, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    expect(
        await getChatDefinition(botAccount.action({type: "Chat", chatId: scopeChat.id}), chatId),
    ).toMatchObject({
        spaceId: space.id,
        definition: {
            type: "Room",
            name: "General",
        },
    });
});

test("getChatDefinition rejects bots with too many accounts in scope for direct chats", async () => {
    const space = await TestSpace.create(context);
    const sessionA = await space.createSession({role: "Admin"});
    const [sessionB, sessionC] = await space.createSessions(2);
    const botAccount = await TestBot.createAndInstantiate(sessionA);

    const chatForScope = await TestChat.get(sessionA, sessionB, sessionC);
    const targetChat = await TestChat.get(sessionA, sessionB);

    await expect(
        getChatDefinition(
            botAccount.action({type: "Chat", chatId: chatForScope.id}),
            targetChat.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("getChatDefinition rejects bots with too many accounts in scope for room chats", async () => {
    const space = await TestSpace.create(context);
    const sessionA = await space.createSession({role: "Admin"});
    const [sessionB, sessionC] = await space.createSessions(2);
    const botAccount = await TestBot.createAndInstantiate(sessionA);

    const chatForScope = await TestChat.get(sessionA, sessionB, sessionC);
    const {id: chatId} = await createRoomChat(sessionA.action(), {
        spaceId: space.id,
        name: "Leadership",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([
                [sessionA.account.id, {level: "Manage", generation: 0}],
                [sessionB.account.id, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await expect(
        getChatDefinition(botAccount.action({type: "Chat", chatId: chatForScope.id}), chatId),
    ).rejects.toThrow(PermissionDeniedError);
});
