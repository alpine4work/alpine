import {
    FileChatAuthorizer,
    authorizeChatAccess,
    authorizeChatAccessForAccount,
    authorizeChatAccessIfPossible,
    backfillChatMessages,
    createChatForTest,
    deleteChatMessage,
    getChat,
    getChatAccountIds,
    getChatMessage,
    getChatMessagePayload,
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    getOptimisticChatId,
    getOrCreateChatForAccounts,
    getSharedChatsForTest,
    processSendShareNotificationJob,
    sendChatMessage,
    sendChatMessageToAccountsBeforeCreateChatTestCheckpoint,
    updateChatMessageContent,
} from "~/server/chat/data/chat_actions.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {dynamoClientExecuteActionTestCounter} from "~/server/dynamo/core/dynamo_client_execute_action_test_counter.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {testMessagingImplementation} from "~/server/messaging/test_helpers/test_messaging_implementation.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {NotFoundError, PermissionDeniedError, UnauthenticatedError} from "~/shared/error/error.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, ChatId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    MessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";

const context = createTestContext();

const content1 = createSimpleMessageContent("test1");
const content2 = createSimpleMessageContent("test2");
const content3 = createSimpleMessageContent("test3");

// We create a new scenario for every test because chats are keyed off space +
// account ids. So to get a new chat we need new space + account ids.
async function createScenario() {
    const [spaceA, spaceB] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [
        sessionA1,
        sessionA2,
        sessionA3,
        sessionB1,
        sessionB2,
        sessionB3,
        sessionX1,
        sessionX2,
        sessionX3,
    ] = await runAllPromises([
        spaceA.createSession(),
        spaceA.createSession(),
        spaceA.createSession(),
        spaceB.createSession(),
        spaceB.createSession(),
        spaceB.createSession(),
        spaceA.createSession(),
        spaceB.createSession(),
        spaceA.createSession(),
    ]);

    await runAllPromises([
        spaceB.addAccount(sessionX1.account),
        spaceA.addAccount(sessionX2.account),
        spaceB.addAccount(sessionX3.account),
    ]);

    return {
        spaceA,
        spaceB,
        sessionA1,
        sessionA2,
        sessionA3,
        sessionB1,
        sessionB2,
        sessionB3,
        sessionX1,
        sessionX2,
        sessionX3,
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
    sharedChats: Array<{
        id: ChatId;
        accountCount: number;
    }>,
) {
    return sharedChats.sort(
        (a, b) => a.accountCount - b.accountCount || defaultCompareStrings(a.id, b.id),
    );
}

// NOTE(calebmer): Initially `chat_table.ts` provided this function so we wrote
// tests against that but the function was decomposed into
// `getOrCreateChatForAccounts()` and `sendChatMessage()`. To avoid rewriting
// tests the function is reconstructed here.
async function sendChatMessageToAccounts(
    context: ServerSessionActionContext,
    {
        spaceId,
        otherAccountIds,
        parentMessageIndex,
        content,
    }: {
        spaceId: SpaceId;
        otherAccountIds: ReadonlyArray<AccountId>;
        parentMessageIndex: number | null;
        content: MessageContent;
    },
) {
    const chatId = await getOrCreateChatForAccounts(context, {
        spaceId,
        otherAccountIds,
    });

    return sendChatMessage(context, {
        chatId,
        parentMessageIndex,
        content,
        fileIds: [],
    });
}

test("can send initial messages to other accounts", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA3.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA3.account.id,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send initial messages to same account", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA1.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA2.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA3), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA1.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA3.account.id,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA3.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send message to self", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.account.id]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message1.chatId).toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can not get messages in a chat you don’t have access to", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
    );

    await expect(
        getChatMessagesFromStart(context.action(scenario.sessionA3), {
            chatId: message1.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to chat"));

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA3.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA3.account.id,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    await expect(
        getChatMessagesFromStart(context.action(scenario.sessionA2), {
            chatId: message2.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to chat"));

    const message3 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parentMessageIndex: null,
        content: content3,
    });

    expect(message3.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.account.id]),
    );

    expect(message1.chatId).not.toEqual(message3.chatId);

    await expect(
        getChatMessagesFromStart(context.action(scenario.sessionA2), {
            chatId: message3.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to chat"));
});

test("can reply to message by sending to account", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA1.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
    );

    expect(message1.chatId).toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA2.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can’t send messages to an account that doesn’t exist", async () => {
    const scenario = await createScenario();

    await expect(
        sendChatMessageToAccounts(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [generateId()],
            parentMessageIndex: null,
            content: content1,
        }),
    ).rejects.toThrow(new NotFoundError("Can’t find account in space"));
});

test("can’t send messages to accounts in a different space", async () => {
    const scenario = await createScenario();

    await expect(
        sendChatMessageToAccounts(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [scenario.sessionB1.account.id],
            parentMessageIndex: null,
            content: content1,
        }),
    ).rejects.toThrow(new NotFoundError("Can’t find account in space"));

    await expect(
        sendChatMessageToAccounts(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceB.id,
            otherAccountIds: [scenario.sessionB1.account.id],
            parentMessageIndex: null,
            content: content1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to space"));

    await expect(
        sendChatMessageToAccounts(context.action(scenario.sessionB1), {
            spaceId: scenario.spaceB.id,
            otherAccountIds: [scenario.sessionA1.account.id],
            parentMessageIndex: null,
            content: content1,
        }),
    ).rejects.toThrow(new NotFoundError("Can’t find account in space"));

    await expect(
        sendChatMessageToAccounts(context.action(scenario.sessionB1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [scenario.sessionA1.account.id],
            parentMessageIndex: null,
            content: content1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to space"));
});

test("can not send messages to self in a different space", async () => {
    const scenario = await createScenario();

    await expect(
        sendChatMessageToAccounts(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceB.id,
            otherAccountIds: [],
            parentMessageIndex: null,
            content: content1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to space"));

    await expect(
        sendChatMessageToAccounts(context.action(scenario.sessionB1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [],
            parentMessageIndex: null,
            content: content1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to space"));
});

test("can send message to account in multiple spaces", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionX1.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionX1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionX1), {
        spaceId: scenario.spaceB.id,
        otherAccountIds: [scenario.sessionB1.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        getOptimisticChatId(scenario.spaceB.id, [
            scenario.sessionB1.account.id,
            scenario.sessionX1.account.id,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionB1), {
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
                authorId: scenario.sessionX1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("same accounts will have different chats in different spaces", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionX1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionX1), {
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
                authorId: scenario.sessionX1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionX1), {
        spaceId: scenario.spaceB.id,
        otherAccountIds: [scenario.sessionX2.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        getOptimisticChatId(scenario.spaceB.id, [
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionX1), {
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
                authorId: scenario.sessionX1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send messages to multiple accounts", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX3.account.id,
        ],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX3.account.id,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("anyone the message was sent to can read the message", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA2), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionX1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionX2), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await expect(
        getChatMessagesFromStart(context.action(scenario.sessionA3), {
            chatId: message1.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to chat"));

    await expect(
        getChatMessagesFromStart(context.action(scenario.sessionX3), {
            chatId: message1.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to chat"));
});

test("can reply to a message sent to multiple accounts", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionX1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionX2.account.id,
        ],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
    );

    expect(message1.chatId).toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionX1.account.id,
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
        scenario.sessionA1.account.id,
    );

    const message1Promise = sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    const {unpause} = await pausePromise;

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA1.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA2.account.id,
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
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA2.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send initial messages to other accounts (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [scenario.sessionB2.account.id],
    });

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await createChatForTest(context.action(scenario.sessionA1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA3.account.id,
        ]),
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA3.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA3.account.id,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    await createChatForTest(context.action(scenario.sessionA2), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionX1.account.id,
        ]),
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA1.account.id, scenario.sessionX1.account.id],
    });

    const message3 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parentMessageIndex: null,
        content: content3,
    });

    expect(message3.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionX1.account.id,
        ]),
    );

    expect(message1.chatId).not.toEqual(message3.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionX1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content3,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send initial messages to other accounts (reusing a chat already with the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.action(scenario.sessionA1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
    });

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await createChatForTest(context.action(scenario.sessionA1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA3.account.id,
        ]),
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA3.account.id],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA3.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA3.account.id,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send initial messages to same account (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.action(scenario.sessionA1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA3.account.id],
    });

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA1.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA2.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await createChatForTest(context.action(scenario.sessionA1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA3.account.id,
        ]),
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA3), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA1.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA3.account.id,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA3.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send message to self (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.account.id]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.account.id]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message1.chatId).toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can not get messages in a chat you don’t have access to (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
    );

    await expect(
        getChatMessagesFromStart(context.action(scenario.sessionA3), {
            chatId: message1.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to chat"));

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA3.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA3.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA3.account.id,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    await expect(
        getChatMessagesFromStart(context.action(scenario.sessionA2), {
            chatId: message2.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to chat"));

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.account.id]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    const message3 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parentMessageIndex: null,
        content: content3,
    });

    expect(message3.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.account.id]),
    );

    expect(message1.chatId).not.toEqual(message3.chatId);

    await expect(
        getChatMessagesFromStart(context.action(scenario.sessionA2), {
            chatId: message3.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to chat"));
});

test("can reply to message by sending to account (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA1.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
    );

    expect(message1.chatId).toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA2.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send message to account in multiple spaces (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionX1.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionX1.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionX1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceB.id, [
            scenario.sessionB1.account.id,
            scenario.sessionX1.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionX1), {
        spaceId: scenario.spaceB.id,
        otherAccountIds: [scenario.sessionB1.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceB.id, [
            scenario.sessionB1.account.id,
            scenario.sessionX1.account.id,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionB1), {
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
                authorId: scenario.sessionX1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("same accounts will have different chats in different spaces (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionX1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionX1), {
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
                authorId: scenario.sessionX1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceB.id, [
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionX1), {
        spaceId: scenario.spaceB.id,
        otherAccountIds: [scenario.sessionX2.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceB.id, [
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionX1), {
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
                authorId: scenario.sessionX1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can send messages to multiple accounts (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX3.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX3.account.id,
        ],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX3.account.id,
        ]),
    );

    expect(message1.chatId).not.toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("anyone the message was sent to can read the message (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA2), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionX1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionX2), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    await expect(
        getChatMessagesFromStart(context.action(scenario.sessionA3), {
            chatId: message1.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to chat"));

    await expect(
        getChatMessagesFromStart(context.action(scenario.sessionX3), {
            chatId: message1.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to chat"));
});

test("can reply to a message sent to multiple accounts (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    expect(message1.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionX1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionX2.account.id,
        ],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ]),
    );

    expect(message1.chatId).toEqual(message2.chatId);

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionX1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("race condition where two accounts try to create the same chat at the same time (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    const pausePromise = sendChatMessageToAccountsBeforeCreateChatTestCheckpoint.pauseForTest(
        scenario.sessionA1.account.id,
    );

    const message1Promise = sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    const {unpause} = await pausePromise;

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA1.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message2.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA2.account.id,
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
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA2.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can find correct chat to send message to when account has a lot of chats", async () => {
    const scenario = await createScenario();

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA3.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX3.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionA3.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id, scenario.sessionX2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parentMessageIndex: null,
        content: content2,
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    const message3 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    const message4 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionA3.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    const message5 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
        ],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message1.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.account.id]),
    );

    expect(message2.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
    );

    expect(message3.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionX1.account.id,
        ]),
    );

    expect(message4.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
        ]),
    );

    expect(message5.chatId).toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can find correct chat to send message to when account has a lot of chats (when a chat already has the optimistic id)", async () => {
    const scenario = await createScenario();

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.account.id]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionX1.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
        ]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA3.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX3.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionA3.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id, scenario.sessionX2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parentMessageIndex: null,
        content: content2,
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    const message3 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    const message4 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionA3.account.id],
        parentMessageIndex: null,
        content: content2,
    });

    const message5 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
        ],
        parentMessageIndex: null,
        content: content2,
    });

    expect(message1.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.account.id]),
    );

    expect(message2.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
        ]),
    );

    expect(message3.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionX1.account.id,
        ]),
    );

    expect(message4.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
        ]),
    );

    expect(message5.chatId).not.toEqual(
        getOptimisticChatId(scenario.spaceA.id, [
            scenario.sessionA1.account.id,
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
        ]),
    );

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });

    expect(
        massageMessages(
            await getChatMessagesFromStart(context.action(scenario.sessionA1), {
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
                authorId: scenario.sessionA1.account.id,
                parentMessageIndex: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
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
        await getSharedChatsForTest(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [],
        }),
    ).toEqual(sortSharedChats([]));

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parentMessageIndex: null,
        content: content1,
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    const message3 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA3.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    const message4 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    const message5 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    const message6 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX3.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    const message7 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionA3.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    const message8 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id, scenario.sessionX2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    const message9 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    const message10 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
            scenario.sessionX2.account.id,
        ],
        parentMessageIndex: null,
        content: content1,
    });

    const message11 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionX1.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    const message12 = await sendChatMessageToAccounts(context.action(scenario.sessionB1), {
        spaceId: scenario.spaceB.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    const message13 = await sendChatMessageToAccounts(context.action(scenario.sessionB1), {
        spaceId: scenario.spaceB.id,
        otherAccountIds: [scenario.sessionX1.account.id, scenario.sessionX2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    expect(
        await getSharedChatsForTest(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [],
        }),
    ).toEqual(
        sortSharedChats([
            {id: message1.chatId, accountCount: 1},
            {id: message2.chatId, accountCount: 2},
            {id: message3.chatId, accountCount: 2},
            {id: message4.chatId, accountCount: 2},
            {id: message5.chatId, accountCount: 2},
            {id: message6.chatId, accountCount: 2},
            {id: message7.chatId, accountCount: 3},
            {id: message8.chatId, accountCount: 3},
            {id: message9.chatId, accountCount: 4},
            {id: message10.chatId, accountCount: 5},
            {id: message11.chatId, accountCount: 3},
        ]),
    );

    expect(
        await getSharedChatsForTest(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [scenario.sessionA2.account.id],
        }),
    ).toEqual(
        sortSharedChats([
            {id: message2.chatId, accountCount: 2},
            {id: message7.chatId, accountCount: 3},
            {id: message9.chatId, accountCount: 4},
            {id: message10.chatId, accountCount: 5},
            {id: message11.chatId, accountCount: 3},
        ]),
    );

    expect(
        await getSharedChatsForTest(context.action(scenario.sessionA2), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [scenario.sessionA1.account.id],
        }),
    ).toEqual(
        sortSharedChats([
            {id: message2.chatId, accountCount: 2},
            {id: message7.chatId, accountCount: 3},
            {id: message9.chatId, accountCount: 4},
            {id: message10.chatId, accountCount: 5},
            {id: message11.chatId, accountCount: 3},
        ]),
    );

    expect(
        await getSharedChatsForTest(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [scenario.sessionA3.account.id],
        }),
    ).toEqual(
        sortSharedChats([
            {id: message3.chatId, accountCount: 2},
            {id: message7.chatId, accountCount: 3},
            {id: message9.chatId, accountCount: 4},
            {id: message10.chatId, accountCount: 5},
        ]),
    );

    expect(
        await getSharedChatsForTest(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionA3.account.id],
        }),
    ).toEqual(
        sortSharedChats([
            {id: message7.chatId, accountCount: 3},
            {id: message9.chatId, accountCount: 4},
            {id: message10.chatId, accountCount: 5},
        ]),
    );

    expect(
        await getSharedChatsForTest(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [
                scenario.sessionA2.account.id,
                scenario.sessionA3.account.id,
                scenario.sessionX1.account.id,
            ],
        }),
    ).toEqual(
        sortSharedChats([
            {id: message9.chatId, accountCount: 4},
            {id: message10.chatId, accountCount: 5},
        ]),
    );

    expect(
        await getSharedChatsForTest(context.action(scenario.sessionX1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [],
        }),
    ).toEqual(
        sortSharedChats([
            {id: message4.chatId, accountCount: 2},
            {id: message8.chatId, accountCount: 3},
            {id: message9.chatId, accountCount: 4},
            {id: message10.chatId, accountCount: 5},
            {id: message11.chatId, accountCount: 3},
        ]),
    );

    expect(
        await getSharedChatsForTest(context.action(scenario.sessionX1), {
            spaceId: scenario.spaceB.id,
            otherAccountIds: [],
        }),
    ).toEqual(
        sortSharedChats([
            {id: message13.chatId, accountCount: 3},
            {id: message12.chatId, accountCount: 2},
        ]),
    );

    expect(
        await getSharedChatsForTest(context.action(scenario.sessionX1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [scenario.sessionX2.account.id],
        }),
    ).toEqual(
        sortSharedChats([
            {id: message8.chatId, accountCount: 3},
            {id: message10.chatId, accountCount: 5},
        ]),
    );

    expect(
        await getSharedChatsForTest(context.action(scenario.sessionX1), {
            spaceId: scenario.spaceB.id,
            otherAccountIds: [scenario.sessionX2.account.id],
        }),
    ).toEqual(sortSharedChats([{id: message13.chatId, accountCount: 3}]));

    expect(
        await getSharedChatsForTest(context.action(scenario.sessionX1), {
            spaceId: scenario.spaceB.id,
            otherAccountIds: [scenario.sessionA1.account.id],
        }),
    ).toEqual(sortSharedChats([]));
});

test("can not get chat you don’t have access to", async () => {
    const scenario = await createScenario();

    const message = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await expect(
        getChat(context.action(scenario.sessionA1), message.chatId),
    ).resolves.not.toBeNull();
    await expect(
        getChatAccountIds(context.action(scenario.sessionA1), message.chatId),
    ).resolves.not.toBeNull();

    await expect(
        getChat(context.action(scenario.sessionA2), message.chatId),
    ).resolves.not.toBeNull();
    await expect(
        getChatAccountIds(context.action(scenario.sessionA2), message.chatId),
    ).resolves.not.toBeNull();

    await expect(getChat(context.action(scenario.sessionA3), message.chatId)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        getChatAccountIds(context.action(scenario.sessionA3), message.chatId),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getChat(
            context.impersonatedAccountAction(scenario.spaceA.id, scenario.sessionA2.account.id),
            message.chatId,
        ),
    ).resolves.not.toBeNull();
    await expect(
        getChatAccountIds(
            context.impersonatedAccountAction(scenario.spaceA.id, scenario.sessionA2.account.id),
            message.chatId,
        ),
    ).resolves.not.toBeNull();

    await expect(
        getChat(
            context.impersonatedAccountAction(scenario.spaceB.id, scenario.sessionA2.account.id),
            message.chatId,
        ),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        getChatAccountIds(
            context.impersonatedAccountAction(scenario.spaceB.id, scenario.sessionA2.account.id),
            message.chatId,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getChat(
            context.impersonatedAccountAction(scenario.spaceA.id, scenario.sessionA3.account.id),
            message.chatId,
        ),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        getChatAccountIds(
            context.impersonatedAccountAction(scenario.spaceA.id, scenario.sessionA3.account.id),
            message.chatId,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(getChat(context.anonymousAction(), message.chatId)).rejects.toThrow(
        UnauthenticatedError,
    );
    await expect(getChatAccountIds(context.anonymousAction(), message.chatId)).rejects.toThrow(
        UnauthenticatedError,
    );

    await expect(getChat(context.action(scenario.sessionB1), message.chatId)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        getChatAccountIds(context.action(scenario.sessionB1), message.chatId),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getChat(context.systemAction(scenario.spaceA.id), message.chatId),
    ).resolves.not.toBeNull();
    await expect(
        getChatAccountIds(context.systemAction(scenario.spaceA.id), message.chatId),
    ).resolves.not.toBeNull();

    await expect(getChat(context.systemAction(scenario.spaceB.id), message.chatId)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        getChatAccountIds(context.systemAction(scenario.spaceB.id), message.chatId),
    ).rejects.toThrow(PermissionDeniedError);
});

test("correctly authorizes which accounts are in the chat", async () => {
    const scenario = await createScenario();

    const message = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionX2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await expect(
        authorizeChatAccessForAccount(
            context.action(scenario.sessionA1),
            message.chatId,
            scenario.sessionA1.account.id,
        ),
    ).resolves.toBeTruthy();

    await expect(
        authorizeChatAccessForAccount(
            context.action(scenario.sessionA1),
            message.chatId,
            scenario.sessionA2.account.id,
        ),
    ).resolves.toBeTruthy();

    await expect(
        authorizeChatAccessForAccount(
            context.action(scenario.sessionA1),
            message.chatId,
            scenario.sessionA3.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        authorizeChatAccessForAccount(
            context.action(scenario.sessionA1),
            message.chatId,
            scenario.sessionX2.account.id,
        ),
    ).resolves.toBeTruthy();

    await expect(
        authorizeChatAccessForAccount(
            context.action(scenario.sessionA1),
            message.chatId,
            scenario.sessionX3.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        authorizeChatAccessForAccount(
            context.action(scenario.sessionA1),
            message.chatId,
            scenario.sessionB1.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not authorize which accounts are in the chat if session does not have access to chat", async () => {
    const scenario = await createScenario();

    const message = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionX2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await expect(
        authorizeChatAccessForAccount(
            context.action(scenario.sessionA3),
            message.chatId,
            scenario.sessionA1.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        authorizeChatAccessForAccount(
            context.action(scenario.sessionA3),
            message.chatId,
            scenario.sessionA2.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        authorizeChatAccessForAccount(
            context.action(scenario.sessionA3),
            message.chatId,
            scenario.sessionA3.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        authorizeChatAccessForAccount(
            context.action(scenario.sessionA3),
            message.chatId,
            scenario.sessionX2.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        authorizeChatAccessForAccount(
            context.action(scenario.sessionA3),
            message.chatId,
            scenario.sessionX3.account.id,
        ),
    ).rejects.toThrow("Session actor account doesn’t have access to chat");

    await expect(
        authorizeChatAccessForAccount(
            context.action(scenario.sessionA3),
            message.chatId,
            scenario.sessionB1.account.id,
        ),
    ).rejects.toThrow("Session actor account doesn’t have access to chat");
});

test("correctly authorizes which accounts are in the chat as system", async () => {
    const scenario = await createScenario();

    const message = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionX2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await expect(
        authorizeChatAccessForAccount(
            context.systemAction(scenario.spaceA.id),
            message.chatId,
            scenario.sessionA1.account.id,
        ),
    ).resolves.toBeTruthy();

    await expect(
        authorizeChatAccessForAccount(
            context.systemAction(scenario.spaceA.id),
            message.chatId,
            scenario.sessionA2.account.id,
        ),
    ).resolves.toBeTruthy();

    await expect(
        authorizeChatAccessForAccount(
            context.systemAction(scenario.spaceA.id),
            message.chatId,
            scenario.sessionA3.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        authorizeChatAccessForAccount(
            context.systemAction(scenario.spaceA.id),
            message.chatId,
            scenario.sessionX2.account.id,
        ),
    ).resolves.toBeTruthy();

    await expect(
        authorizeChatAccessForAccount(
            context.systemAction(scenario.spaceA.id),
            message.chatId,
            scenario.sessionX3.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        authorizeChatAccessForAccount(
            context.systemAction(scenario.spaceA.id),
            message.chatId,
            scenario.sessionB1.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not authorize which accounts are in the chat if system context does not have access to chat", async () => {
    const scenario = await createScenario();

    const message = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionX2.account.id],
        parentMessageIndex: null,
        content: content1,
    });

    await expect(
        authorizeChatAccessForAccount(
            context.systemAction(scenario.spaceB.id),
            message.chatId,
            scenario.sessionA1.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        authorizeChatAccessForAccount(
            context.systemAction(scenario.spaceB.id),
            message.chatId,
            scenario.sessionA2.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        authorizeChatAccessForAccount(
            context.systemAction(scenario.spaceB.id),
            message.chatId,
            scenario.sessionA3.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        authorizeChatAccessForAccount(
            context.systemAction(scenario.spaceB.id),
            message.chatId,
            scenario.sessionX2.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        authorizeChatAccessForAccount(
            context.systemAction(scenario.spaceB.id),
            message.chatId,
            scenario.sessionX3.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        authorizeChatAccessForAccount(
            context.systemAction(scenario.spaceB.id),
            message.chatId,
            scenario.sessionB1.account.id,
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("only authorizes chat access for accounts in a chat", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    await otherSpace.addAccount(session1);

    const chat = await TestChat.get(session1, session2);

    await authorizeChatAccess(session1.action(), chat.id);

    await authorizeChatAccess(session2.action(), chat.id);

    await expect(authorizeChatAccess(session3.action(), chat.id)).rejects.toThrow(
        PermissionDeniedError,
    );

    await authorizeChatAccess(space.systemAction(), chat.id);

    await expect(authorizeChatAccess(otherSpace.systemAction(), chat.id)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(authorizeChatAccess(context.anonymousAction(), chat.id)).rejects.toThrow(
        UnauthenticatedError,
    );

    await authorizeChatAccess(
        context.impersonatedAccountAction(space.id, session1.account.id),
        chat.id,
    );

    await authorizeChatAccess(
        context.impersonatedAccountAction(space.id, session2.account.id),
        chat.id,
    );

    await expect(
        authorizeChatAccess(
            context.impersonatedAccountAction(space.id, session3.account.id),
            chat.id,
        ),
    ).rejects.toThrow("Account doesn’t have access to chat");

    await expect(
        authorizeChatAccess(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            chat.id,
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    expect((await authorizeChatAccessIfPossible(session1.action(), chat.id)).ok).toBe(true);

    expect((await authorizeChatAccessIfPossible(session2.action(), chat.id)).ok).toBe(true);

    expect((await authorizeChatAccessIfPossible(session3.action(), chat.id)).ok).toBe(false);

    expect((await authorizeChatAccessIfPossible(space.systemAction(), chat.id)).ok).toBe(true);

    expect((await authorizeChatAccessIfPossible(otherSpace.systemAction(), chat.id)).ok).toBe(
        false,
    );

    expect((await authorizeChatAccessIfPossible(context.anonymousAction(), chat.id)).ok).toBe(
        false,
    );

    expect(
        (
            await authorizeChatAccessIfPossible(
                context.impersonatedAccountAction(space.id, session1.account.id),
                chat.id,
            )
        ).ok,
    ).toEqual(true);

    expect(
        (
            await authorizeChatAccessIfPossible(
                context.impersonatedAccountAction(space.id, session2.account.id),
                chat.id,
            )
        ).ok,
    ).toEqual(true);

    expect(
        (
            await authorizeChatAccessIfPossible(
                context.impersonatedAccountAction(space.id, session3.account.id),
                chat.id,
            )
        ).ok,
    ).toEqual(false);

    expect(
        (
            await authorizeChatAccessIfPossible(
                context.impersonatedAccountAction(otherSpace.id, session1.account.id),
                chat.id,
            )
        ).ok,
    ).toEqual(false);

    await authorizeChatAccessForAccount(session1.action(), chat.id, session1.account.id);

    await authorizeChatAccessForAccount(session2.action(), chat.id, session1.account.id);

    await expect(
        authorizeChatAccessForAccount(session3.action(), chat.id, session1.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await authorizeChatAccessForAccount(space.systemAction(), chat.id, session1.account.id);

    await expect(
        authorizeChatAccessForAccount(otherSpace.systemAction(), chat.id, session1.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        authorizeChatAccessForAccount(context.anonymousAction(), chat.id, session1.account.id),
    ).rejects.toThrow(UnauthenticatedError);

    await authorizeChatAccessForAccount(
        context.impersonatedAccountAction(space.id, session1.account.id),
        chat.id,
        session1.account.id,
    );

    await authorizeChatAccessForAccount(
        context.impersonatedAccountAction(space.id, session2.account.id),
        chat.id,
        session1.account.id,
    );

    await expect(
        authorizeChatAccessForAccount(
            context.impersonatedAccountAction(space.id, session3.account.id),
            chat.id,
            session1.account.id,
        ),
    ).rejects.toThrow("Session actor account doesn’t have access to chat");

    await expect(
        authorizeChatAccessForAccount(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            chat.id,
            session1.account.id,
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(
        authorizeChatAccessForAccount(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            chat.id,
            session2.account.id,
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");
});

test("authorizing chat access as session actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chatId = await getOrCreateChatForAccounts(session1.action(), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id],
    });

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(2);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccessIfPossible(actionContext, chatId),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            authorizeChatAccess(actionContext, chatId),
            authorizeChatAccess(actionContext, chatId),
            authorizeChatAccessIfPossible(actionContext, chatId),
        ]);

        expect(getCount()).toEqual(2);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(2);
    }
});

test("authorizing chat access as system actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chatId = await getOrCreateChatForAccounts(session1.action(), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id],
    });

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(1);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(1);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccessIfPossible(actionContext, chatId),
            ]);
        }

        expect(getCount()).toEqual(1);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            authorizeChatAccess(actionContext, chatId),
            authorizeChatAccess(actionContext, chatId),
            authorizeChatAccessIfPossible(actionContext, chatId),
        ]);

        expect(getCount()).toEqual(1);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(1);
    }
});

test("authorizing chat access after getting chat as session actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chatId = await getOrCreateChatForAccounts(session1.action(), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id],
    });

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getChat(actionContext, chatId);

        expect(getCount()).toEqual(5);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(5);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(5);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccessIfPossible(actionContext, chatId),
            ]);
        }

        expect(getCount()).toEqual(5);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getChatAccountIds(actionContext, chatId);

        expect(getCount()).toEqual(2);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(2);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccessIfPossible(actionContext, chatId),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getChatMessagesFromStart(actionContext, {
            chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        });

        expect(getCount()).toEqual(3);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(3);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccessIfPossible(actionContext, chatId),
            ]);
        }

        expect(getCount()).toEqual(3);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getChatMessagesFromEnd(actionContext, {
            chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        });

        expect(getCount()).toEqual(3);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(3);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccessIfPossible(actionContext, chatId),
            ]);
        }

        expect(getCount()).toEqual(3);
    }
});

test("authorizing chat access after getting chat as system actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chatId = await getOrCreateChatForAccounts(session1.action(), {
        spaceId: space.id,
        otherAccountIds: [session2.account.id],
    });

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getChat(actionContext, chatId);

        expect(getCount()).toEqual(4);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(4);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(4);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccessIfPossible(actionContext, chatId),
            ]);
        }

        expect(getCount()).toEqual(4);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getChatAccountIds(actionContext, chatId);

        expect(getCount()).toEqual(1);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(1);

        await authorizeChatAccess(actionContext, chatId);

        expect(getCount()).toEqual(1);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccess(actionContext, chatId),
                authorizeChatAccessIfPossible(actionContext, chatId),
            ]);
        }

        expect(getCount()).toEqual(1);
    }
});

test("will send share notification messages separately to each account", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);

    const chat1And2 = await TestChat.get(session1, session2);
    const chat1And3 = await TestChat.get(session1, session3);
    const chat2And3 = await TestChat.get(session2, session3);
    const chat1And2And3 = await TestChat.get(session1, session2, session3);
    const chat1And4 = await TestChat.get(session1, session4);

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    const entity1Id: FileEntityId = `Document:${generateId<DocumentId>()}`;

    await processSendShareNotificationJob(space.systemAction(), {
        jobId: generateId(),
        spaceId: space.id,
        actorAccountId: session1.account.id,
        entityId: entity1Id,
        notification: {
            accountIds: [session2.account.id, session3.account.id],
            content: createSimpleMessageContent("foobar"),
        },
    });

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 0}),
    ).resolves.toEqual({
        authorId: session1.account.id,
        createdTime: expect.any(Date),
        payload: {
            type: "Content",
            parentMessageIndex: null,
            content: createSimpleMessageContent("foobar"),
            contentUpdatedTime: null,
            fileIds: [entity1Id],
            clerical: {type: "ShareNotification", entityType: "Document"},
        },
    });

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 0}),
    ).resolves.toEqual({
        authorId: session1.account.id,
        createdTime: expect.any(Date),
        payload: {
            type: "Content",
            parentMessageIndex: null,
            content: createSimpleMessageContent("foobar"),
            contentUpdatedTime: null,
            fileIds: [entity1Id],
            clerical: {type: "ShareNotification", entityType: "Document"},
        },
    });

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    const entity2Id: FileEntityId = `Document:${generateId<DocumentId>()}`;

    await processSendShareNotificationJob(space.systemAction(), {
        jobId: generateId(),
        spaceId: space.id,
        actorAccountId: session1.account.id,
        entityId: entity2Id,
        notification: {
            accountIds: [session2.account.id, session4.account.id],
            content: createSimpleMessageContent("quxbaz"),
        },
    });

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 0}),
    ).resolves.toEqual({
        authorId: session1.account.id,
        createdTime: expect.any(Date),
        payload: {
            type: "Content",
            parentMessageIndex: null,
            content: createSimpleMessageContent("foobar"),
            contentUpdatedTime: null,
            fileIds: [entity1Id],
            clerical: {type: "ShareNotification", entityType: "Document"},
        },
    });

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 0}),
    ).resolves.toEqual({
        authorId: session1.account.id,
        createdTime: expect.any(Date),
        payload: {
            type: "Content",
            parentMessageIndex: null,
            content: createSimpleMessageContent("foobar"),
            contentUpdatedTime: null,
            fileIds: [entity1Id],
            clerical: {type: "ShareNotification", entityType: "Document"},
        },
    });

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 0}),
    ).resolves.toEqual({
        authorId: session1.account.id,
        createdTime: expect.any(Date),
        payload: {
            type: "Content",
            parentMessageIndex: null,
            content: createSimpleMessageContent("quxbaz"),
            contentUpdatedTime: null,
            fileIds: [entity2Id],
            clerical: {type: "ShareNotification", entityType: "Document"},
        },
    });

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 1}),
    ).resolves.toEqual({
        authorId: session1.account.id,
        createdTime: expect.any(Date),
        payload: {
            type: "Content",
            parentMessageIndex: null,
            content: createSimpleMessageContent("quxbaz"),
            contentUpdatedTime: null,
            fileIds: [entity2Id],
            clerical: {type: "ShareNotification", entityType: "Document"},
        },
    });

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");
});

test("processing send share notification message job is idempotent", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);

    const chat1And2 = await TestChat.get(session1, session2);
    const chat1And3 = await TestChat.get(session1, session3);
    const chat2And3 = await TestChat.get(session2, session3);
    const chat1And2And3 = await TestChat.get(session1, session2, session3);
    const chat1And4 = await TestChat.get(session1, session4);

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    const jobId = generateId();
    const entityId: FileEntityId = `Document:${generateId<DocumentId>()}`;

    await processSendShareNotificationJob(space.systemAction(), {
        jobId,
        spaceId: space.id,
        actorAccountId: session1.account.id,
        entityId: entityId,
        notification: {
            accountIds: [session2.account.id, session3.account.id],
            content: createSimpleMessageContent("foobar"),
        },
    });

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 0}),
    ).resolves.toEqual({
        authorId: session1.account.id,
        createdTime: expect.any(Date),
        payload: {
            type: "Content",
            parentMessageIndex: null,
            content: createSimpleMessageContent("foobar"),
            contentUpdatedTime: null,
            fileIds: [entityId],
            clerical: {type: "ShareNotification", entityType: "Document"},
        },
    });

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 0}),
    ).resolves.toEqual({
        authorId: session1.account.id,
        createdTime: expect.any(Date),
        payload: {
            type: "Content",
            parentMessageIndex: null,
            content: createSimpleMessageContent("foobar"),
            contentUpdatedTime: null,
            fileIds: [entityId],
            clerical: {type: "ShareNotification", entityType: "Document"},
        },
    });

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await processSendShareNotificationJob(space.systemAction(), {
        jobId,
        spaceId: space.id,
        actorAccountId: session1.account.id,
        entityId: entityId,
        notification: {
            accountIds: [session2.account.id, session3.account.id],
            content: createSimpleMessageContent("foobar"),
        },
    });

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 0}),
    ).resolves.toEqual({
        authorId: session1.account.id,
        createdTime: expect.any(Date),
        payload: {
            type: "Content",
            parentMessageIndex: null,
            content: createSimpleMessageContent("foobar"),
            contentUpdatedTime: null,
            fileIds: [entityId],
            clerical: {type: "ShareNotification", entityType: "Document"},
        },
    });

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 0}),
    ).resolves.toEqual({
        authorId: session1.account.id,
        createdTime: expect.any(Date),
        payload: {
            type: "Content",
            parentMessageIndex: null,
            content: createSimpleMessageContent("foobar"),
            contentUpdatedTime: null,
            fileIds: [entityId],
            clerical: {type: "ShareNotification", entityType: "Document"},
        },
    });

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 0}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 1}),
    ).rejects.toThrow("Item not found (partition type: `Chat`, sort range type: `Messages`)");
});

testMessagingImplementation<ChatId>(context, {
    async createRoom(context, spaceId, sessions) {
        const chat = await createChatForTest(context, {
            spaceId,
            otherAccountIds: sessions.map(session => session.accountId),
        });

        return {
            key: chat.id,
            spaceId,
            createdTime: chat.createdTime,
            messageCount: 0,
        };
    },
    async createPrivateRoom(context, spaceId, {insideSessions}) {
        const chat = await createChatForTest(context, {
            spaceId,
            otherAccountIds: insideSessions.map(session => session.accountId),
        });

        return {
            key: chat.id,
            spaceId,
            createdTime: chat.createdTime,
            messageCount: 0,
            doesInsideViewerSessionHaveRoomAccess: "Unimplemented",
            revokeInsideSession: "Unimplemented",
        };
    },
    async getRoom(context, chatId) {
        const post = await getChat(context, chatId);

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
    getRoomFileAuthorizer(chatId) {
        return FileChatAuthorizer.bind({type: "ChatMessages", chatId});
    },
    async createMessage(context, {roomKey: chatId, parentMessageIndex, content, fileIds}) {
        const message = await sendChatMessage(context, {
            chatId,
            parentMessageIndex,
            content,
            fileIds,
        });

        return {
            index: message.index,
            createdTime: message.createdTime,
        };
    },
    async getMessage(context, {roomKey: chatId, messageIndex}) {
        return getChatMessage(context, {chatId, messageIndex});
    },
    async getMessagePayload(context, {roomKey: chatId, messageIndex}) {
        return (await getChatMessagePayload(context, {chatId, messageIndex})).payload;
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
        return getChatMessagesFromStart(context.actor.authorizeSession(), {
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
        return getChatMessagesFromEnd(context.actor.authorizeSession(), {
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
