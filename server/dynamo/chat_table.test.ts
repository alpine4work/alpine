import {SessionItem, getAccountsTableForTest} from "~/server/dynamo/accounts_table";
import {
    backfillChatMessages,
    createChatForTest,
    deleteChatMessage,
    getChat,
    getChatMessage,
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    getOptimisticChatId,
    getSharedChats,
    sendChatMessage,
    sendChatMessageToAccounts,
    sendChatMessageToAccountsBeforeCreateChatTestCheckpoint,
    updateChatMessageContent,
} from "~/server/dynamo/chat_table";
import {getSpacesTableForTest} from "~/server/dynamo/spaces_table";
import {testMessagingImplementation} from "~/server/dynamo/test_helpers/jest/test_messaging_implementation";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error";
import {compareArrays} from "~/shared/helpers/array/compare_arrays";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings";
import {generateId} from "~/shared/id/id";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types";
import {ChatMessageModel} from "~/shared/models/chat_model";

const context = createTestContext();

const content1 = createSimpleMessageContent("test1");
const content2 = createSimpleMessageContent("test2");
const content3 = createSimpleMessageContent("test3");

// We create a new scenario for every test because chats are keyed off space +
// account ids. So to get a new chat we need new space + account ids.
async function createScenario() {
    const SpacesTable = getSpacesTableForTest();
    const AccountsTable = getAccountsTableForTest();

    const createdTime = new Date();

    const spaceAId = generateId<SpaceId>();
    const spaceBId = generateId<SpaceId>();

    const accountA1Id = generateId<AccountId>();
    const accountA2Id = generateId<AccountId>();
    const accountA3Id = generateId<AccountId>();

    const accountB1Id = generateId<AccountId>();
    const accountB2Id = generateId<AccountId>();
    const accountB3Id = generateId<AccountId>();

    // X in this case stands for "shared" since these accounts are part of
    // both spaces.
    const accountX1Id = generateId<AccountId>();
    const accountX2Id = generateId<AccountId>();
    const accountX3Id = generateId<AccountId>();

    const accountA1SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: accountA1Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const accountA2SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: accountA2Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const accountA3SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: accountA3Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const accountB1SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: accountB1Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const accountB2SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: accountB2Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const accountB3SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: accountB3Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const accountX1SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: accountX1Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const accountX2SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: accountX2Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const accountX3SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: accountX3Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };

    await runAllPromises([
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId: spaceAId,
            name: "Space A",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId: spaceBId,
            name: "Space B",
            createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: accountA1Id,
            name: "Account A1",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceAId,
            accountId: accountA1Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: accountA2Id,
            name: "Account A2",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceAId,
            accountId: accountA2Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: accountA3Id,
            name: "Account A3",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceAId,
            accountId: accountA3Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: accountB1Id,
            name: "Account B1",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceBId,
            accountId: accountB1Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: accountB2Id,
            name: "Account B2",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceBId,
            accountId: accountB2Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: accountB3Id,
            name: "Account B3",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceBId,
            accountId: accountB3Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: accountX1Id,
            name: "Account X1",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceAId,
            accountId: accountX1Id,
            joinedTime: createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceBId,
            accountId: accountX1Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: accountX2Id,
            name: "Account X2",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceAId,
            accountId: accountX2Id,
            joinedTime: createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceBId,
            accountId: accountX2Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: accountX3Id,
            name: "Account X3",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceAId,
            accountId: accountX3Id,
            joinedTime: createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceBId,
            accountId: accountX3Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, accountA1SessionItem),
        AccountsTable.createItem(context, accountA2SessionItem),
        AccountsTable.createItem(context, accountA3SessionItem),
        AccountsTable.createItem(context, accountB1SessionItem),
        AccountsTable.createItem(context, accountB2SessionItem),
        AccountsTable.createItem(context, accountB3SessionItem),
        AccountsTable.createItem(context, accountX1SessionItem),
        AccountsTable.createItem(context, accountX2SessionItem),
        AccountsTable.createItem(context, accountX3SessionItem),
    ]);

    return {
        spaceA: {id: spaceAId},
        spaceB: {id: spaceBId},
        sessionA1: {accountId: accountA1Id, item: accountA1SessionItem},
        sessionA2: {accountId: accountA2Id, item: accountA2SessionItem},
        sessionA3: {accountId: accountA3Id, item: accountA3SessionItem},
        sessionB1: {accountId: accountB1Id, item: accountB1SessionItem},
        sessionB2: {accountId: accountB2Id, item: accountB2SessionItem},
        sessionB3: {accountId: accountB3Id, item: accountB3SessionItem},
        sessionX1: {accountId: accountX1Id, item: accountX1SessionItem},
        sessionX2: {accountId: accountX2Id, item: accountX2SessionItem},
        sessionX3: {accountId: accountX3Id, item: accountX3SessionItem},
    };
}

function massageMessage(message: ChatMessageModel | null) {
    if (!message) return null;

    switch (message.payload.type) {
        case "Content": {
            return {
                authorId: message.author.id,
                parentMessageIndex: message.payload.parentMessageIndex,
                content: message.payload.content.doc,
                hasContentUpdated: message.payload.contentUpdatedTime !== null,
            };
        }
        case "Deleted": {
            return {
                author: message.author,
                isDeleted: true,
            };
        }
        default:
            throw exhaustive(message.payload);
    }
}

function massageMessages(result: {
    messageCount: number;
    messages: Array<ChatMessageModel>;
    otherReferencedMessages: Array<ChatMessageModel>;
}) {
    return {
        messageCount: result.messageCount,
        messages: result.messages.map(massageMessage),
        ...(result.otherReferencedMessages.length > 0
            ? {otherReferencedMessages: result.otherReferencedMessages.map(massageMessage)}
            : {}),
    };
}

function sortSharedChats(
    sharedChats: Array<{includesAccountIds: Array<AccountId>; chatId: ChatId}>,
) {
    return sharedChats
        .map(sharedChat => ({
            ...sharedChat,
            includesAccountIds: sharedChat.includesAccountIds.slice().sort(),
        }))
        .sort(
            (a, b) =>
                // Put shared chats with more accounts in common first
                (a.includesAccountIds.length - b.includesAccountIds.length) * -1 ||
                // Then
                compareArrays(a.includesAccountIds, b.includesAccountIds, defaultCompareStrings) ||
                // Sort by `ChatId` if the `AccountId` array is equal.
                defaultCompareStrings(a.chatId, b.chatId),
        );
}

test("can send initial messages to other accounts", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA3.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA3.accountId,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send initial messages to same account", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA1.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA2.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA3), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA1.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA3.accountId,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA3.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send message to self", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.accountId]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message1.chatId).toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can not get messages in a chat you don't have access to", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
    );

    await expect(
        getChatMessagesFromStart(context.request(scenario.sessionA3), {
            chatId: message1.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to chat"));

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA3.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA3.accountId,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    await expect(
        getChatMessagesFromStart(context.request(scenario.sessionA2), {
            chatId: message2.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to chat"));

    const message3 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [],
        parentMessageIndex: null,
        content: content3,
    });

    expect(message3.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.accountId]),
    );

    expect(message1.chatId).not.toEqual(message3.chatId);

    await expect(
        getChatMessagesFromStart(context.request(scenario.sessionA2), {
            chatId: message3.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to chat"));
});

test("can reply to message by sending to account", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA1.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
    );

    expect(message1.chatId).toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA2.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can not send messages to accounts in a different space", async () => {
    const scenario = await createScenario();

    await expect(
        sendChatMessageToAccounts(context.request(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            accountIds: [scenario.sessionB1.accountId],
            parentMessageIndex: null,
            content: content1,
        }),
    ).rejects.toThrow(new NotFoundError("Can not find account in space"));

    await expect(
        sendChatMessageToAccounts(context.request(scenario.sessionA1), {
            spaceId: scenario.spaceB.id,
            accountIds: [scenario.sessionB1.accountId],
            parentMessageIndex: null,
            content: content1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to space"));

    await expect(
        sendChatMessageToAccounts(context.request(scenario.sessionB1), {
            spaceId: scenario.spaceB.id,
            accountIds: [scenario.sessionA1.accountId],
            parentMessageIndex: null,
            content: content1,
        }),
    ).rejects.toThrow(new NotFoundError("Can not find account in space"));

    await expect(
        sendChatMessageToAccounts(context.request(scenario.sessionB1), {
            spaceId: scenario.spaceA.id,
            accountIds: [scenario.sessionA1.accountId],
            parentMessageIndex: null,
            content: content1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to space"));
});

test("can not send messages to self in a different space", async () => {
    const scenario = await createScenario();

    await expect(
        sendChatMessageToAccounts(context.request(scenario.sessionA1), {
            spaceId: scenario.spaceB.id,
            accountIds: [],
            parentMessageIndex: null,
            content: content1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to space"));

    await expect(
        sendChatMessageToAccounts(context.request(scenario.sessionB1), {
            spaceId: scenario.spaceA.id,
            accountIds: [],
            parentMessageIndex: null,
            content: content1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to space"));
});

test("can send message to account in multiple spaces", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX1.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionX1.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionX1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionX1), {
        spaceId: scenario.spaceB.id,
        accountIds: [scenario.sessionB1.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceB.id, [
            scenario.sessionB1.accountId,
            scenario.sessionX1.accountId,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionB1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionX1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("same accounts will have different chats in different spaces", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionX1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionX1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionX1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionX1), {
        spaceId: scenario.spaceB.id,
        accountIds: [scenario.sessionX2.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceB.id, [
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionX1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionX1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send messages to multiple accounts", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX3.accountId,
        ],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX3.accountId,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("anyone the message was sent to can read the message", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA2), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionX1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionX2), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await expect(
        getChatMessagesFromStart(context.request(scenario.sessionA3), {
            chatId: message1.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to chat"));

    await expect(
        getChatMessagesFromStart(context.request(scenario.sessionX3), {
            chatId: message1.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to chat"));
});

test("can reply to a message sent to multiple accounts", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionX1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionX2.accountId,
        ],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
    );

    expect(message1.chatId).toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionX1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("race condition where two accounts try to create the same chat at the same time", async () => {
    const scenario = await createScenario();

    const pausePromise = sendChatMessageToAccountsBeforeCreateChatTestCheckpoint.pauseForTest(
        scenario.sessionA1.item.sessionId,
    );

    const message1Promise = sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    const {unpause} = await pausePromise;

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA1.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA2.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    unpause();

    const message1 = await message1Promise;

    expect(message1.chatId).toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA2.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send initial messages to other accounts (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [scenario.sessionB2.accountId],
    });

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await createChatForTest(context.request(scenario.sessionA1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA3.accountId,
        ]),
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA3.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA3.accountId,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    await createChatForTest(context.request(scenario.sessionA2), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionX1.accountId,
        ]),
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA1.accountId, scenario.sessionX1.accountId],
    });

    const message3 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX1.accountId],
        parentMessageIndex: null,
        content: content3,
    });

    expect(message3.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionX1.accountId,
        ]),
    );

    expect(message1.chatId).not.toEqual(message3.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionX1), {
                chatId: message3.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content3,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send initial messages to other accounts (reusing a chat already with the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.request(scenario.sessionA1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
    });

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await createChatForTest(context.request(scenario.sessionA1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA3.accountId,
        ]),
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA3.accountId],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA3.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA3.accountId,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send initial messages to same account (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.request(scenario.sessionA1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA3.accountId],
    });

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA1.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA2.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await createChatForTest(context.request(scenario.sessionA1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA3.accountId,
        ]),
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA3), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA1.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA3.accountId,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA3.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send message to self (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.accountId]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.accountId]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message1.chatId).toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can not get messages in a chat you don't have access to (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
    );

    await expect(
        getChatMessagesFromStart(context.request(scenario.sessionA3), {
            chatId: message1.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to chat"));

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA3.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA3.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA3.accountId,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    await expect(
        getChatMessagesFromStart(context.request(scenario.sessionA2), {
            chatId: message2.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to chat"));

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.accountId]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    const message3 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [],
        parentMessageIndex: null,
        content: content3,
    });

    expect(message3.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.accountId]),
    );

    expect(message1.chatId).not.toEqual(message3.chatId);

    await expect(
        getChatMessagesFromStart(context.request(scenario.sessionA2), {
            chatId: message3.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to chat"));
});

test("can reply to message by sending to account (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA1.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
    );

    expect(message1.chatId).toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA2.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send message to account in multiple spaces (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionX1.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX1.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionX1.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionX1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceB.id, [
            scenario.sessionB1.accountId,
            scenario.sessionX1.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionX1), {
        spaceId: scenario.spaceB.id,
        accountIds: [scenario.sessionB1.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceB.id, [
            scenario.sessionB1.accountId,
            scenario.sessionX1.accountId,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionB1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionX1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("same accounts will have different chats in different spaces (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionX1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionX1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionX1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceB.id, [
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionX1), {
        spaceId: scenario.spaceB.id,
        accountIds: [scenario.sessionX2.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceB.id, [
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionX1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionX1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send messages to multiple accounts (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX3.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX3.accountId,
        ],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX3.accountId,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("anyone the message was sent to can read the message (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA2), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionX1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionX2), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await expect(
        getChatMessagesFromStart(context.request(scenario.sessionA3), {
            chatId: message1.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to chat"));

    await expect(
        getChatMessagesFromStart(context.request(scenario.sessionX3), {
            chatId: message1.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to chat"));
});

test("can reply to a message sent to multiple accounts (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionX1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionX2.accountId,
        ],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ]),
    );

    expect(message1.chatId).toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionX1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("race condition where two accounts try to create the same chat at the same time (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    const pausePromise = sendChatMessageToAccountsBeforeCreateChatTestCheckpoint.pauseForTest(
        scenario.sessionA1.item.sessionId,
    );

    const message1Promise = sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    const {unpause} = await pausePromise;

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA1.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 1,
        messages: [
            {
                authorId: scenario.sessionA2.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    unpause();

    const message1 = await message1Promise;

    expect(message1.chatId).toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA2.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can find correct chat to send message to when account has a lot of chats", async () => {
    const scenario = await createScenario();

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA3.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX1.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX3.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId, scenario.sessionA3.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX1.accountId, scenario.sessionX2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA2.accountId,
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA2.accountId,
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [],
        parentMessageIndex: null,
        content: content2,
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    const message3 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX1.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    const message4 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId, scenario.sessionA3.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    const message5 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA2.accountId,
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
        ],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message1.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.accountId]),
    );

    expect(message2.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
    );

    expect(message3.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionX1.accountId,
        ]),
    );

    expect(message4.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionA3.accountId,
        ]),
    );

    expect(message5.chatId).toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message3.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message4.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message5.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can find correct chat to send message to when account has a lot of chats (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.accountId]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionX1.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionA3.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    await createChatForTest(context.request(scenario.sessionB1), {
        id: await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
        ]),
        spaceId: scenario.spaceB.id,
        accountIds: [],
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA3.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX1.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX3.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId, scenario.sessionA3.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX1.accountId, scenario.sessionX2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA2.accountId,
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA2.accountId,
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [],
        parentMessageIndex: null,
        content: content2,
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    const message3 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX1.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    const message4 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId, scenario.sessionA3.accountId],
        parentMessageIndex: null,
        content: content2,
    });

    const message5 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA2.accountId,
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
        ],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message1.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.accountId]),
    );

    expect(message2.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
        ]),
    );

    expect(message3.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionX1.accountId,
        ]),
    );

    expect(message4.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionA3.accountId,
        ]),
    );

    expect(message5.chatId).not.toEqual(
        await getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.accountId,
            scenario.sessionA2.accountId,
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message1.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message2.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message3.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message4.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.request(scenario.sessionA1), {
                chatId: message5.chatId,
                limit: 100,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ).toEqual({
        messageCount: 2,
        messages: [
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.accountId,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can get chats shared between an account and other accounts", async () => {
    const scenario = await createScenario();

    expect(
        await getSharedChats(context.request(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            accountIds: [],
        }),
    ).toEqual(sortSharedChats([]));

    const message1 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [],
        parentMessageIndex: null,
        content: content1,
    });

    const message2 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    const message3 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA3.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    const message4 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX1.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    const message5 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    const message6 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX3.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    const message7 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId, scenario.sessionA3.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    const message8 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionX1.accountId, scenario.sessionX2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    const message9 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA2.accountId,
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    const message10 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [
            scenario.sessionA2.accountId,
            scenario.sessionA3.accountId,
            scenario.sessionX1.accountId,
            scenario.sessionX2.accountId,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    const message11 = await sendChatMessageToAccounts(context.request(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        accountIds: [scenario.sessionA2.accountId, scenario.sessionX1.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    const message12 = await sendChatMessageToAccounts(context.request(scenario.sessionB1), {
        spaceId: scenario.spaceB.id,
        accountIds: [scenario.sessionX1.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    const message13 = await sendChatMessageToAccounts(context.request(scenario.sessionB1), {
        spaceId: scenario.spaceB.id,
        accountIds: [scenario.sessionX1.accountId, scenario.sessionX2.accountId],
        parentMessageIndex: null,
        content: content1,
    });

    expect(
        await getSharedChats(context.request(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            accountIds: [],
        }),
    ).toEqual(
        sortSharedChats([
            {includesAccountIds: [], chatId: message1.chatId},
            {includesAccountIds: [], chatId: message2.chatId},
            {includesAccountIds: [], chatId: message3.chatId},
            {includesAccountIds: [], chatId: message4.chatId},
            {includesAccountIds: [], chatId: message5.chatId},
            {includesAccountIds: [], chatId: message6.chatId},
            {includesAccountIds: [], chatId: message7.chatId},
            {includesAccountIds: [], chatId: message8.chatId},
            {includesAccountIds: [], chatId: message9.chatId},
            {includesAccountIds: [], chatId: message10.chatId},
            {includesAccountIds: [], chatId: message11.chatId},
        ]),
    );

    expect(
        await getSharedChats(context.request(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            accountIds: [scenario.sessionA2.accountId],
        }),
    ).toEqual(
        sortSharedChats([
            {includesAccountIds: [scenario.sessionA2.accountId], chatId: message2.chatId},
            {includesAccountIds: [scenario.sessionA2.accountId], chatId: message7.chatId},
            {includesAccountIds: [scenario.sessionA2.accountId], chatId: message9.chatId},
            {includesAccountIds: [scenario.sessionA2.accountId], chatId: message10.chatId},
            {includesAccountIds: [scenario.sessionA2.accountId], chatId: message11.chatId},
        ]),
    );

    expect(
        await getSharedChats(context.request(scenario.sessionA2), {
            spaceId: scenario.spaceA.id,
            accountIds: [scenario.sessionA1.accountId],
        }),
    ).toEqual(
        sortSharedChats([
            {includesAccountIds: [scenario.sessionA1.accountId], chatId: message2.chatId},
            {includesAccountIds: [scenario.sessionA1.accountId], chatId: message7.chatId},
            {includesAccountIds: [scenario.sessionA1.accountId], chatId: message9.chatId},
            {includesAccountIds: [scenario.sessionA1.accountId], chatId: message10.chatId},
            {includesAccountIds: [scenario.sessionA1.accountId], chatId: message11.chatId},
        ]),
    );

    expect(
        await getSharedChats(context.request(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            accountIds: [scenario.sessionA3.accountId],
        }),
    ).toEqual(
        sortSharedChats([
            {includesAccountIds: [scenario.sessionA3.accountId], chatId: message3.chatId},
            {includesAccountIds: [scenario.sessionA3.accountId], chatId: message7.chatId},
            {includesAccountIds: [scenario.sessionA3.accountId], chatId: message9.chatId},
            {includesAccountIds: [scenario.sessionA3.accountId], chatId: message10.chatId},
        ]),
    );

    expect(
        await getSharedChats(context.request(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            accountIds: [scenario.sessionA2.accountId, scenario.sessionA3.accountId],
        }),
    ).toEqual(
        sortSharedChats([
            {includesAccountIds: [scenario.sessionA2.accountId], chatId: message2.chatId},
            {includesAccountIds: [scenario.sessionA3.accountId], chatId: message3.chatId},
            {
                includesAccountIds: [scenario.sessionA2.accountId, scenario.sessionA3.accountId],
                chatId: message7.chatId,
            },
            {
                includesAccountIds: [scenario.sessionA2.accountId, scenario.sessionA3.accountId],
                chatId: message9.chatId,
            },
            {
                includesAccountIds: [scenario.sessionA2.accountId, scenario.sessionA3.accountId],
                chatId: message10.chatId,
            },
            {includesAccountIds: [scenario.sessionA2.accountId], chatId: message11.chatId},
        ]),
    );

    expect(
        await getSharedChats(context.request(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            accountIds: [
                scenario.sessionA2.accountId,
                scenario.sessionA3.accountId,
                scenario.sessionX1.accountId,
            ],
        }),
    ).toEqual(
        sortSharedChats([
            {includesAccountIds: [scenario.sessionA2.accountId], chatId: message2.chatId},
            {includesAccountIds: [scenario.sessionA3.accountId], chatId: message3.chatId},
            {includesAccountIds: [scenario.sessionX1.accountId], chatId: message4.chatId},
            {
                includesAccountIds: [scenario.sessionA2.accountId, scenario.sessionA3.accountId],
                chatId: message7.chatId,
            },
            {includesAccountIds: [scenario.sessionX1.accountId], chatId: message8.chatId},
            {
                includesAccountIds: [
                    scenario.sessionA2.accountId,
                    scenario.sessionA3.accountId,
                    scenario.sessionX1.accountId,
                ],
                chatId: message9.chatId,
            },
            {
                includesAccountIds: [
                    scenario.sessionA2.accountId,
                    scenario.sessionA3.accountId,
                    scenario.sessionX1.accountId,
                ],
                chatId: message10.chatId,
            },
            {
                includesAccountIds: [scenario.sessionA2.accountId, scenario.sessionX1.accountId],
                chatId: message11.chatId,
            },
        ]),
    );

    expect(
        await getSharedChats(context.request(scenario.sessionX1), {
            spaceId: scenario.spaceA.id,
            accountIds: [],
        }),
    ).toEqual(
        sortSharedChats([
            {includesAccountIds: [], chatId: message4.chatId},
            {includesAccountIds: [], chatId: message8.chatId},
            {includesAccountIds: [], chatId: message9.chatId},
            {includesAccountIds: [], chatId: message10.chatId},
            {includesAccountIds: [], chatId: message11.chatId},
        ]),
    );

    expect(
        await getSharedChats(context.request(scenario.sessionX1), {
            spaceId: scenario.spaceB.id,
            accountIds: [],
        }),
    ).toEqual(
        sortSharedChats([
            {includesAccountIds: [], chatId: message12.chatId},
            {includesAccountIds: [], chatId: message13.chatId},
        ]),
    );

    expect(
        await getSharedChats(context.request(scenario.sessionX1), {
            spaceId: scenario.spaceA.id,
            accountIds: [scenario.sessionX2.accountId],
        }),
    ).toEqual(
        sortSharedChats([
            {includesAccountIds: [scenario.sessionX2.accountId], chatId: message8.chatId},
            {includesAccountIds: [scenario.sessionX2.accountId], chatId: message10.chatId},
        ]),
    );

    expect(
        await getSharedChats(context.request(scenario.sessionX1), {
            spaceId: scenario.spaceB.id,
            accountIds: [scenario.sessionX2.accountId],
        }),
    ).toEqual(
        sortSharedChats([
            {includesAccountIds: [scenario.sessionX2.accountId], chatId: message13.chatId},
        ]),
    );

    expect(
        await getSharedChats(context.request(scenario.sessionX1), {
            spaceId: scenario.spaceB.id,
            accountIds: [scenario.sessionA1.accountId],
        }),
    ).toEqual(sortSharedChats([]));
});

testMessagingImplementation<ChatId>(context, {
    async createRoom(context, spaceId, sessions) {
        const chat = await createChatForTest(context, {
            spaceId,
            accountIds: sessions.map(session => session.accountId),
        });

        return {
            key: chat.id,
            spaceId,
            createdTime: chat.createdTime,
            messageCount: 0,
        };
    },
    async createPrivateRoom(context, spaceId, sessions) {
        const chat = await createChatForTest(context, {
            spaceId,
            accountIds: sessions.map(session => session.accountId),
        });

        return {
            key: chat.id,
            spaceId,
            createdTime: chat.createdTime,
            messageCount: 0,
        };
    },
    async getRoom(context, chatId) {
        const post = await getChat(context, chatId);
        if (!post) return null;

        return {
            key: post.id,
            spaceId: post.spaceId,
            createdTime: post.createdTime,
            messageCount: post.messageCount,
        };
    },
    getMissingRoomKey() {
        return generateId();
    },
    async createMessage(context, {roomKey: chatId, parentMessageIndex, content}) {
        const message = await sendChatMessage(context, {
            chatId,
            parentMessageIndex,
            content,
        });

        return {
            index: message.index,
            createdTime: message.createdTime,
        };
    },
    async getMessage(context, {roomKey: chatId, messageIndex}) {
        return getChatMessage(context, {chatId, messageIndex});
    },
    async updateMessageContent(context, {roomKey: chatId, messageIndex, content}) {
        return updateChatMessageContent(context, {
            chatId,
            messageIndex,
            content,
        });
    },
    async deleteMessage(context, {roomKey: chatId, messageIndex}) {
        return deleteChatMessage(context, {chatId, messageIndex});
    },
    async getMessagesFromStart(
        context,
        {roomKey: chatId, limit, afterMessageIndex, beforeMessageIndex},
    ) {
        return getChatMessagesFromStart(context, {
            chatId,
            limit,
            afterMessageIndex,
            beforeMessageIndex,
        });
    },
    async getMessagesFromEnd(
        context,
        {roomKey: chatId, limit, afterMessageIndex, beforeMessageIndex},
    ) {
        return getChatMessagesFromEnd(context, {
            chatId,
            limit,
            afterMessageIndex,
            beforeMessageIndex,
        });
    },
    async backfillMessages(
        context,
        {roomKey: chatId, clientMessageCount, clientLastMessageChangeTime, newMessageLimit},
    ) {
        return backfillChatMessages(context, {
            chatId,
            clientMessageCount,
            clientLastMessageChangeTime,
            newMessageLimit,
        });
    },
});
