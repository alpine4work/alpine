import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {sendChatMessage} from "~/server/chat/data/chat_messaging.js";
import {convertDirectChatToRoomChat} from "~/server/chat/data/convert_direct_chat_to_room_chat.js";
import {getChatAndInitialMessages} from "~/server/chat/data/get_chat_and_initial_messages.js";
import {getOrCreateChatForAccounts} from "~/server/chat/data/get_or_create_chat_for_accounts.js";
import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {AccountId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    chatInjection,
    notificationsInjection: {
        archiveInboxChatEntryAfterSetChatMessageReaction: async () => {},
    },
});

test("convertDirectChatToRoomChat derives access policy and creates subscriptions", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB, sessionC] = await space.createSessions(3);

    const chat = await TestChat.get(sessionA, sessionB, sessionC);

    await convertDirectChatToRoomChat(sessionA.action(), {
        chatId: chat.id,
        name: "Announcements",
    });

    const attributesItem = await ChatTable.getItem(context, {
        partitionType: "Chat",
        sortRangeType: "Attributes",
        chatId: chat.id,
    });

    expect(attributesItem.definition).toMatchObject({
        type: "Room",
        name: "Announcements",
        accessPolicy: {
            accountGrantById: new Map([
                [sessionA.account.id, {level: "Manage", generation: 0}],
                [sessionB.account.id, {level: "Manage", generation: 0}],
                [sessionC.account.id, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    const accountItems = await arrayFromAsyncIterable(
        ChatTable.query(context, {
            partitionKey: {partitionType: "Chat", chatId: chat.id},
            startSortKey: {
                sortRangeType: "Account",
                accountId: DynamoKeyAttributeSchema.id.getMinValue<AccountId>(),
            },
            endSortKey: {
                sortRangeType: "Account",
                accountId: DynamoKeyAttributeSchema.id.getMaxValue<AccountId>(),
            },
            limit: "All",
        }),
    );

    expect(accountItems).toHaveLength(0);

    const subscriptionItems = await arrayFromAsyncIterable(
        ChatTable.query(context, {
            partitionKey: {partitionType: "Chat", chatId: chat.id},
            startSortKey: {
                sortRangeType: "Subscription",
                accountId: DynamoKeyAttributeSchema.id.getMinValue<AccountId>(),
            },
            endSortKey: {
                sortRangeType: "Subscription",
                accountId: DynamoKeyAttributeSchema.id.getMaxValue<AccountId>(),
            },
            limit: "All",
        }),
    );

    expect(subscriptionItems).toHaveLength(3);
    const expectedSubscriptions = [
        {accountId: sessionA.account.id, isSubscribed: true},
        {accountId: sessionB.account.id, isSubscribed: true},
        {accountId: sessionC.account.id, isSubscribed: true},
    ].sort((itemA, itemB) => itemA.accountId.localeCompare(itemB.accountId));

    expect(
        subscriptionItems
            .map(item => ({accountId: item.accountId, isSubscribed: item.isSubscribed}))
            .sort((itemA, itemB) => itemA.accountId.localeCompare(itemB.accountId)),
    ).toEqual(expectedSubscriptions);
});

test("excludes bot accounts from access policy", async () => {
    const space = await TestSpace.create(context);
    const sessionA = await space.createSession({role: "Admin"});
    const [sessionB, sessionC] = await space.createSessions(2);
    const bot = await TestBot.createAndInstantiate(sessionA);

    const chat = await TestChat.get(sessionA, sessionB, sessionC, bot);

    await convertDirectChatToRoomChat(sessionA.action(), {
        chatId: chat.id,
        name: "Announcements",
    });

    const attributesItem = await ChatTable.getItem(context, {
        partitionType: "Chat",
        sortRangeType: "Attributes",
        chatId: chat.id,
    });

    const accessGrants =
        attributesItem.definition.type === "Room" &&
        attributesItem.definition.accessPolicy.type === "Local"
            ? Array.from(attributesItem.definition.accessPolicy.accountGrantById.entries())
                  .map(([accountId, grant]) => ({accountId, ...grant}))
                  .sort((grantA, grantB) => grantA.accountId.localeCompare(grantB.accountId))
            : [];

    expect({
        definition: attributesItem.definition,
        accessGrants,
    }).toEqual({
        definition: expect.objectContaining({
            type: "Room",
            name: "Announcements",
        }),
        accessGrants: [
            {accountId: sessionA.account.id, level: "Manage", generation: 0},
            {accountId: sessionB.account.id, level: "Manage", generation: 0},
            {accountId: sessionC.account.id, level: "Manage", generation: 0},
        ].sort((grantA, grantB) => grantA.accountId.localeCompare(grantB.accountId)),
    });
});

test("convertDirectChatToRoomChat is idempotent", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB, sessionC] = await space.createSessions(3);

    const chat = await TestChat.get(sessionA, sessionB, sessionC);

    await convertDirectChatToRoomChat(sessionA.action(), {
        chatId: chat.id,
        name: "Room",
    });

    await convertDirectChatToRoomChat(sessionA.action(), {
        chatId: chat.id,
        name: "Room",
    });

    const subscriptionItems = await arrayFromAsyncIterable(
        ChatTable.query(context, {
            partitionKey: {partitionType: "Chat", chatId: chat.id},
            startSortKey: {
                sortRangeType: "Subscription",
                accountId: DynamoKeyAttributeSchema.id.getMinValue<AccountId>(),
            },
            endSortKey: {
                sortRangeType: "Subscription",
                accountId: DynamoKeyAttributeSchema.id.getMaxValue<AccountId>(),
            },
            limit: "All",
        }),
    );

    expect(subscriptionItems).toHaveLength(3);
    const expectedSubscriptions = [
        {accountId: sessionA.account.id, isSubscribed: true},
        {accountId: sessionB.account.id, isSubscribed: true},
        {accountId: sessionC.account.id, isSubscribed: true},
    ].sort((itemA, itemB) => itemA.accountId.localeCompare(itemB.accountId));

    expect(
        subscriptionItems
            .map(item => ({accountId: item.accountId, isSubscribed: item.isSubscribed}))
            .sort((itemA, itemB) => itemA.accountId.localeCompare(itemB.accountId)),
    ).toEqual(expectedSubscriptions);
});

test("convertDirectChatToRoomChat rejects direct chats with two or fewer accounts", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB] = await space.createSessions(2);

    const soloChat = await TestChat.get(sessionA);
    await expect(
        convertDirectChatToRoomChat(sessionA.action(), {
            chatId: soloChat.id,
            name: "Solo",
        }),
    ).rejects.toThrow("Can only turn direct chats with more than two accounts into room chats");

    const oneOnOneChat = await TestChat.get(sessionA, sessionB);
    await expect(
        convertDirectChatToRoomChat(sessionA.action(), {
            chatId: oneOnOneChat.id,
            name: "One on one",
        }),
    ).rejects.toThrow("Can only turn direct chats with more than two accounts into room chats");
});

test("convertDirectChatToRoomChat allows a new direct chat with fresh messages", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB, sessionC] = await space.createSessions(3);

    const originalChatId = await getOrCreateChatForAccounts(sessionA.action(), {
        spaceId: space.id,
        otherAccountIds: [sessionB.account.id, sessionC.account.id],
    });

    await sendChatMessage(sessionA.action(), {
        chatId: originalChatId,
        parent: null,
        content: createSimpleMessageContent("Test 1"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await sendChatMessage(sessionB.action(), {
        chatId: originalChatId,
        parent: null,
        content: createSimpleMessageContent("Test 2"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await convertDirectChatToRoomChat(sessionA.action(), {
        chatId: originalChatId,
        name: "Announcements",
    });

    await sendChatMessage(sessionA.action(), {
        chatId: originalChatId,
        parent: null,
        content: createSimpleMessageContent("Test 3"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    const newDirectChatId = await getOrCreateChatForAccounts(sessionA.action(), {
        spaceId: space.id,
        otherAccountIds: [sessionB.account.id, sessionC.account.id],
    });

    expect(newDirectChatId).not.toBe(originalChatId);

    await sendChatMessage(sessionA.action(), {
        chatId: newDirectChatId,
        parent: null,
        content: createSimpleMessageContent("Test 4"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    const roomMessages = await getChatAndInitialMessages(sessionA.action(), {
        chatId: originalChatId,
        messagesLimit: 10,
    });

    const directMessages = await getChatAndInitialMessages(sessionA.action(), {
        chatId: newDirectChatId,
        messagesLimit: 10,
    });

    expect(roomMessages.chat.messageCount).toBe(3);
    expect(roomMessages.initialMessages).toHaveLength(3);
    expect(directMessages.chat.messageCount).toBe(1);
    expect(directMessages.initialMessages).toHaveLength(1);

    const roomMessageDocs = roomMessages.initialMessages.map(message => {
        assert(message.payload.type === "Content");
        return message.payload.content.doc.toJSON();
    });

    const directMessageDocs = directMessages.initialMessages.map(message => {
        assert(message.payload.type === "Content");
        return message.payload.content.doc.toJSON();
    });

    expect(roomMessageDocs).toEqual([
        createSimpleMessageContent("Test 1").toJSON(),
        createSimpleMessageContent("Test 2").toJSON(),
        createSimpleMessageContent("Test 3").toJSON(),
    ]);

    expect(directMessageDocs).toEqual([createSimpleMessageContent("Test 4").toJSON()]);
});
