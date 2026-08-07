import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {
    authorizeChatAccess,
    authorizeChatAccessIfPossible,
} from "~/server/chat/data/authorize_chat_access.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {
    backfillChatMessages,
    completeChatMessageStream,
    deleteChatMessage,
    deleteChatMessageReaction,
    getChatMessage,
    getChatMessageParentContent,
    getChatMessagePayload,
    getChatMessagePayloadsFromEnd,
    getChatMessagePayloadsFromStart,
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    pingChatMessageStream,
    processSendShareNotificationJob,
    putChatMessageApprovalDecisions,
    putChatMessageStreamPartAndBroadcastEvent,
    sendChatMessage,
    setChatMessageReaction,
    updateChatMessageContent,
} from "~/server/chat/data/chat_messaging.js";
import {createChatForTest} from "~/server/chat/data/create_chat_for_test.js";
import {FileChatAuthorizer} from "~/server/chat/data/file_chat_authorizer.js";
import {getChat} from "~/server/chat/data/get_chat.js";
import {getChatAccessPolicyForBotScope} from "~/server/chat/data/get_chat_access_policy_for_bot_scope.js";
import {getChatDefinition} from "~/server/chat/data/get_chat_definition.js";
import {getOrCreateChatForAccounts} from "~/server/chat/data/get_or_create_chat_for_accounts.js";
import {getOrCreateChatBeforeCreateChatTestCheckpoint} from "~/server/chat/data/internal/actually_get_or_create_chat_for_accounts.js";
import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {getOptimisticChatId} from "~/server/chat/data/internal/get_optimistic_chat_id.js";
import {getSharedChats} from "~/server/chat/data/internal/get_shared_chats.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {dynamoClientExecuteActionTestCounter} from "~/server/dynamo/core/dynamo_client_execute_action_test_counter.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {testMessagingImplementation} from "~/server/messaging/test_helpers/suite/test_messaging_implementation.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    MessageContent,
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/content/message_content_schema.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {idRegExp} from "~/shared/id/id_reg_exp.js";
import {AccountId, ChatId, DocumentId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";

const context = createTestContext({
    chatInjection,
    notificationsInjection: {
        archiveInboxChatEntryAfterSetChatMessageReaction: async () => {},
    },
});

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
                parent: message.payload.parent,
                content: message.payload.content.doc,
                hasContentUpdated: message.payload.contentUpdate !== null,
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
// `getOrCreateChatForAccounts()` and `sendChatMessage()`. To avoid rewriting tests
// the function is reconstructed here.
async function sendChatMessageToAccounts(
    context: ServerSessionActionContext,
    {
        spaceId,
        otherAccountIds,
        parent,
        content,
    }: {
        spaceId: SpaceId;
        otherAccountIds: ReadonlyArray<AccountId>;
        parent: MessageContentPayloadParent | null;
        content: MessageContent;
    },
) {
    const chatId = await getOrCreateChatForAccounts(context, {
        spaceId,
        otherAccountIds,
    });

    return await sendChatMessage(context, {
        chatId,
        parent,
        content,
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });
}

test("can send initial messages to other accounts", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA3.account.id],
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA3), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA1.account.id],
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parent: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can not get messages in a chat you don\u2019t have access to", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parent: null,
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA3.account.id],
        parent: null,
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));

    const message3 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parent: null,
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));
});

test("can reply to message by sending to account", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA1.account.id],
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA2.account.id,
                parent: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can\u2019t send messages to an account that doesn\u2019t exist", async () => {
    const scenario = await createScenario();

    await expect(
        sendChatMessageToAccounts(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [generateId()],
            parent: null,
            content: content1,
        }),
    ).rejects.toThrow(new NotFoundError("Can\u2019t find account in space"));
});

test("can\u2019t send messages to accounts in a different space", async () => {
    const scenario = await createScenario();

    await expect(
        sendChatMessageToAccounts(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [scenario.sessionB1.account.id],
            parent: null,
            content: content1,
        }),
    ).rejects.toThrow(new NotFoundError("Can\u2019t find account in space"));

    await expect(
        sendChatMessageToAccounts(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceB.id,
            otherAccountIds: [scenario.sessionB1.account.id],
            parent: null,
            content: content1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have access to space"));

    await expect(
        sendChatMessageToAccounts(context.action(scenario.sessionB1), {
            spaceId: scenario.spaceB.id,
            otherAccountIds: [scenario.sessionA1.account.id],
            parent: null,
            content: content1,
        }),
    ).rejects.toThrow(new NotFoundError("Can\u2019t find account in space"));

    await expect(
        sendChatMessageToAccounts(context.action(scenario.sessionB1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [scenario.sessionA1.account.id],
            parent: null,
            content: content1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have access to space"));
});

test("can not send messages to self in a different space", async () => {
    const scenario = await createScenario();

    await expect(
        sendChatMessageToAccounts(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceB.id,
            otherAccountIds: [],
            parent: null,
            content: content1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have access to space"));

    await expect(
        sendChatMessageToAccounts(context.action(scenario.sessionB1), {
            spaceId: scenario.spaceA.id,
            otherAccountIds: [],
            parent: null,
            content: content1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have access to space"));
});

test("can send message to account in multiple spaces", async () => {
    const scenario = await createScenario();

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionX1), {
        spaceId: scenario.spaceB.id,
        otherAccountIds: [scenario.sessionB1.account.id],
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionX1), {
        spaceId: scenario.spaceB.id,
        otherAccountIds: [scenario.sessionX2.account.id],
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
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
                parent: null,
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
                parent: null,
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
                parent: null,
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));

    await expect(
        getChatMessagesFromStart(context.action(scenario.sessionX3), {
            chatId: message1.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionX1.account.id,
                parent: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("race condition where two accounts try to create the same chat at the same time", async () => {
    const scenario = await createScenario();

    const pausePromise = getOrCreateChatBeforeCreateChatTestCheckpoint.pauseForTest(
        scenario.sessionA1.account.id,
    );

    const message1Promise = sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parent: null,
        content: content1,
    });

    const {unpause} = await pausePromise;

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA1.account.id],
        parent: null,
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
                parent: null,
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
                parent: null,
                content: content2,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parent: null,
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parent: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can not get messages in a chat you don\u2019t have access to (when a chat already has the optimistic id)", async () => {
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
        parent: null,
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));

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
        parent: null,
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));

    await createChatForTest(context.action(scenario.sessionB1), {
        id: getOptimisticChatId(scenario.spaceA.id, [scenario.sessionA1.account.id]),
        spaceId: scenario.spaceB.id,
        otherAccountIds: [],
    });

    const message3 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parent: null,
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));
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
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
        ],
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA1.account.id],
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA2.account.id,
                parent: null,
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
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
                parent: null,
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
                parent: null,
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
                parent: null,
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));

    await expect(
        getChatMessagesFromStart(context.action(scenario.sessionX3), {
            chatId: message1.chatId,
            limit: 100,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));
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
        parent: null,
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
                parent: null,
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
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionX1.account.id,
                parent: null,
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

    const pausePromise = getOrCreateChatBeforeCreateChatTestCheckpoint.pauseForTest(
        scenario.sessionA1.account.id,
    );

    const message1Promise = sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parent: null,
        content: content1,
    });

    const {unpause} = await pausePromise;

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA2), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA1.account.id],
        parent: null,
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
                parent: null,
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
                parent: null,
                content: content2,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parent: null,
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
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA3.account.id],
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX2.account.id],
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX3.account.id],
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionA3.account.id],
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id, scenario.sessionX2.account.id],
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
        ],
        parent: null,
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
        parent: null,
        content: content1,
    });

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parent: null,
        content: content2,
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parent: null,
        content: content2,
    });

    const message3 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parent: null,
        content: content2,
    });

    const message4 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionA3.account.id],
        parent: null,
        content: content2,
    });

    const message5 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
        ],
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parent: null,
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
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA3.account.id],
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX2.account.id],
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX3.account.id],
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionA3.account.id],
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id, scenario.sessionX2.account.id],
        parent: null,
        content: content1,
    });

    await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
        ],
        parent: null,
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
        parent: null,
        content: content1,
    });

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parent: null,
        content: content2,
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parent: null,
        content: content2,
    });

    const message3 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parent: null,
        content: content2,
    });

    const message4 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionA3.account.id],
        parent: null,
        content: content2,
    });

    const message5 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
        ],
        parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parent: null,
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
                parent: null,
                content: content1,
                hasContentUpdated: false,
            },
            {
                authorId: scenario.sessionA1.account.id,
                parent: null,
                content: content2,
                hasContentUpdated: false,
            },
        ],
    });
});

test("can get chats shared between an account and other accounts", async () => {
    const scenario = await createScenario();

    expect(
        await getSharedChats(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            actorAccountId: scenario.sessionA1.account.id,
            otherAccountIds: [],
        }),
    ).toEqual(sortSharedChats([]));

    const message1 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [],
        parent: null,
        content: content1,
    });

    const message2 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id],
        parent: null,
        content: content1,
    });

    const message3 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA3.account.id],
        parent: null,
        content: content1,
    });

    const message4 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parent: null,
        content: content1,
    });

    const message5 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX2.account.id],
        parent: null,
        content: content1,
    });

    const message6 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX3.account.id],
        parent: null,
        content: content1,
    });

    const message7 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionA3.account.id],
        parent: null,
        content: content1,
    });

    const message8 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionX1.account.id, scenario.sessionX2.account.id],
        parent: null,
        content: content1,
    });

    const message9 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [
            scenario.sessionA2.account.id,
            scenario.sessionA3.account.id,
            scenario.sessionX1.account.id,
        ],
        parent: null,
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
        parent: null,
        content: content1,
    });

    const message11 = await sendChatMessageToAccounts(context.action(scenario.sessionA1), {
        spaceId: scenario.spaceA.id,
        otherAccountIds: [scenario.sessionA2.account.id, scenario.sessionX1.account.id],
        parent: null,
        content: content1,
    });

    const message12 = await sendChatMessageToAccounts(context.action(scenario.sessionB1), {
        spaceId: scenario.spaceB.id,
        otherAccountIds: [scenario.sessionX1.account.id],
        parent: null,
        content: content1,
    });

    const message13 = await sendChatMessageToAccounts(context.action(scenario.sessionB1), {
        spaceId: scenario.spaceB.id,
        otherAccountIds: [scenario.sessionX1.account.id, scenario.sessionX2.account.id],
        parent: null,
        content: content1,
    });

    expect(
        await getSharedChats(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            actorAccountId: scenario.sessionA1.account.id,
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
        await getSharedChats(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            actorAccountId: scenario.sessionA1.account.id,
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
        await getSharedChats(context.action(scenario.sessionA2), {
            spaceId: scenario.spaceA.id,
            actorAccountId: scenario.sessionA2.account.id,
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
        await getSharedChats(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            actorAccountId: scenario.sessionA1.account.id,
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
        await getSharedChats(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            actorAccountId: scenario.sessionA1.account.id,
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
        await getSharedChats(context.action(scenario.sessionA1), {
            spaceId: scenario.spaceA.id,
            actorAccountId: scenario.sessionA1.account.id,
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
        await getSharedChats(context.action(scenario.sessionX1), {
            spaceId: scenario.spaceA.id,
            actorAccountId: scenario.sessionX1.account.id,
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
        await getSharedChats(context.action(scenario.sessionX1), {
            spaceId: scenario.spaceB.id,
            actorAccountId: scenario.sessionX1.account.id,
            otherAccountIds: [],
        }),
    ).toEqual(
        sortSharedChats([
            {id: message13.chatId, accountCount: 3},
            {id: message12.chatId, accountCount: 2},
        ]),
    );

    expect(
        await getSharedChats(context.action(scenario.sessionX1), {
            spaceId: scenario.spaceA.id,
            actorAccountId: scenario.sessionX1.account.id,
            otherAccountIds: [scenario.sessionX2.account.id],
        }),
    ).toEqual(
        sortSharedChats([
            {id: message8.chatId, accountCount: 3},
            {id: message10.chatId, accountCount: 5},
        ]),
    );

    expect(
        await getSharedChats(context.action(scenario.sessionX1), {
            spaceId: scenario.spaceB.id,
            actorAccountId: scenario.sessionX1.account.id,
            otherAccountIds: [scenario.sessionX2.account.id],
        }),
    ).toEqual(sortSharedChats([{id: message13.chatId, accountCount: 3}]));

    expect(
        await getSharedChats(context.action(scenario.sessionX1), {
            spaceId: scenario.spaceB.id,
            actorAccountId: scenario.sessionX1.account.id,
            otherAccountIds: [scenario.sessionA1.account.id],
        }),
    ).toEqual(sortSharedChats([]));
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

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(2);

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccessIfPossible(actionContext, chatId, "Edit"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            authorizeChatAccess(actionContext, chatId, "Edit"),
            authorizeChatAccess(actionContext, chatId, "Edit"),
            authorizeChatAccessIfPossible(actionContext, chatId, "Edit"),
        ]);

        expect(getCount()).toEqual(2);

        await authorizeChatAccess(actionContext, chatId, "Edit");

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

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(1);

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(1);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccessIfPossible(actionContext, chatId, "Edit"),
            ]);
        }

        expect(getCount()).toEqual(1);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            authorizeChatAccess(actionContext, chatId, "Edit"),
            authorizeChatAccess(actionContext, chatId, "Edit"),
            authorizeChatAccessIfPossible(actionContext, chatId, "Edit"),
        ]);

        expect(getCount()).toEqual(1);

        await authorizeChatAccess(actionContext, chatId, "Edit");

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

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(5);

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(5);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccessIfPossible(actionContext, chatId, "Edit"),
            ]);
        }

        expect(getCount()).toEqual(5);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getChatDefinition(actionContext, chatId);

        expect(getCount()).toEqual(2);

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(2);

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccessIfPossible(actionContext, chatId, "Edit"),
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

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(3);

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccessIfPossible(actionContext, chatId, "Edit"),
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

        expect(getCount()).toEqual(2);

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(2);

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccessIfPossible(actionContext, chatId, "Edit"),
            ]);
        }

        expect(getCount()).toEqual(2);
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

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(4);

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(4);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccessIfPossible(actionContext, chatId, "Edit"),
            ]);
        }

        expect(getCount()).toEqual(4);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getChatDefinition(actionContext, chatId);

        expect(getCount()).toEqual(1);

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(1);

        await authorizeChatAccess(actionContext, chatId, "Edit");

        expect(getCount()).toEqual(1);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccess(actionContext, chatId, "Edit"),
                authorizeChatAccessIfPossible(actionContext, chatId, "Edit"),
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
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    const entity1Id: FileEntityId = `Document:${generateId<DocumentId>()}`;

    await processSendShareNotificationJob(space.systemAction(), {
        jobId: generateId(),
        spaceId: space.id,
        actorAccountId: session1.account.id,
        entityId: entity1Id,
        notification: {
            accountIds: [session2.account.id, session3.account.id],
            content: createSimpleMessageContent("foobar"),
            createdTimeZone: defaultTimeZone,
        },
    });

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 0}),
    ).resolves.toEqual(
        expect.objectContaining({
            spaceId: space.id,
            authorId: session1.account.id,
            createdTime: expect.any(Date),
            payload: expect.objectContaining({
                type: "Content",
                parent: null,
                content: createSimpleMessageContent("foobar"),
                contentUpdate: null,
                fileIds: [entity1Id],
                clerical: {type: "ShareNotification", entityType: "Document"},
            }),
        }),
    );

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 0}),
    ).resolves.toEqual(
        expect.objectContaining({
            spaceId: space.id,
            authorId: session1.account.id,
            createdTime: expect.any(Date),
            payload: expect.objectContaining({
                type: "Content",
                parent: null,
                content: createSimpleMessageContent("foobar"),
                contentUpdate: null,
                fileIds: [entity1Id],
                clerical: {type: "ShareNotification", entityType: "Document"},
            }),
        }),
    );

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    const entity2Id: FileEntityId = `Document:${generateId<DocumentId>()}`;

    await processSendShareNotificationJob(space.systemAction(), {
        jobId: generateId(),
        spaceId: space.id,
        actorAccountId: session1.account.id,
        entityId: entity2Id,
        notification: {
            accountIds: [session2.account.id, session4.account.id],
            content: createSimpleMessageContent("quxbaz"),
            createdTimeZone: defaultTimeZone,
        },
    });

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 0}),
    ).resolves.toEqual(
        expect.objectContaining({
            spaceId: space.id,
            authorId: session1.account.id,
            createdTime: expect.any(Date),
            payload: expect.objectContaining({
                type: "Content",
                parent: null,
                content: createSimpleMessageContent("foobar"),
                contentUpdate: null,
                fileIds: [entity1Id],
                clerical: {type: "ShareNotification", entityType: "Document"},
            }),
        }),
    );

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 0}),
    ).resolves.toEqual(
        expect.objectContaining({
            spaceId: space.id,
            authorId: session1.account.id,
            createdTime: expect.any(Date),
            payload: expect.objectContaining({
                type: "Content",
                parent: null,
                content: createSimpleMessageContent("foobar"),
                contentUpdate: null,
                fileIds: [entity1Id],
                clerical: {type: "ShareNotification", entityType: "Document"},
            }),
        }),
    );

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 0}),
    ).resolves.toEqual(
        expect.objectContaining({
            spaceId: space.id,
            authorId: session1.account.id,
            createdTime: expect.any(Date),
            payload: expect.objectContaining({
                type: "Content",
                parent: null,
                content: createSimpleMessageContent("quxbaz"),
                contentUpdate: null,
                fileIds: [entity2Id],
                clerical: {type: "ShareNotification", entityType: "Document"},
            }),
        }),
    );

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 1}),
    ).resolves.toEqual(
        expect.objectContaining({
            spaceId: space.id,
            authorId: session1.account.id,
            createdTime: expect.any(Date),
            payload: expect.objectContaining({
                type: "Content",
                parent: null,
                content: createSimpleMessageContent("quxbaz"),
                contentUpdate: null,
                fileIds: [entity2Id],
                clerical: {type: "ShareNotification", entityType: "Document"},
            }),
        }),
    );

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");
});

test("won\u2019t send share notification messages to bot account", async () => {
    const bot = await TestBot.create(context);

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const [session1, session2] = await space.createSessions(2);

    const {id: botAccountId} = await bot.instantiate(adminSession);

    const chat1 = await TestChat.get(session1, botAccountId);
    const chat2 = await TestChat.get(session1, session2);

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat2.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    const entity1Id: FileEntityId = `Document:${generateId<DocumentId>()}`;

    await processSendShareNotificationJob(space.systemAction(), {
        jobId: generateId(),
        spaceId: space.id,
        actorAccountId: session1.account.id,
        entityId: entity1Id,
        notification: {
            accountIds: [botAccountId, session2.account.id],
            content: createSimpleMessageContent("foobar"),
            createdTimeZone: defaultTimeZone,
        },
    });

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat2.id, messageIndex: 0}),
    ).resolves.toBeTruthy();
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
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

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
            createdTimeZone: defaultTimeZone,
        },
    });

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 0}),
    ).resolves.toEqual(
        expect.objectContaining({
            spaceId: space.id,
            authorId: session1.account.id,
            createdTime: expect.any(Date),
            payload: expect.objectContaining({
                type: "Content",
                parent: null,
                content: createSimpleMessageContent("foobar"),
                contentUpdate: null,
                fileIds: [entityId],
                clerical: {type: "ShareNotification", entityType: "Document"},
            }),
        }),
    );

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 0}),
    ).resolves.toEqual(
        expect.objectContaining({
            spaceId: space.id,
            authorId: session1.account.id,
            createdTime: expect.any(Date),
            payload: expect.objectContaining({
                type: "Content",
                parent: null,
                content: createSimpleMessageContent("foobar"),
                contentUpdate: null,
                fileIds: [entityId],
                clerical: {type: "ShareNotification", entityType: "Document"},
            }),
        }),
    );

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await processSendShareNotificationJob(space.systemAction(), {
        jobId,
        spaceId: space.id,
        actorAccountId: session1.account.id,
        entityId: entityId,
        notification: {
            accountIds: [session2.account.id, session3.account.id],
            content: createSimpleMessageContent("foobar"),
            createdTimeZone: defaultTimeZone,
        },
    });

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 0}),
    ).resolves.toEqual(
        expect.objectContaining({
            spaceId: space.id,
            authorId: session1.account.id,
            createdTime: expect.any(Date),
            payload: expect.objectContaining({
                type: "Content",
                parent: null,
                content: createSimpleMessageContent("foobar"),
                contentUpdate: null,
                fileIds: [entityId],
                clerical: {type: "ShareNotification", entityType: "Document"},
            }),
        }),
    );

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 0}),
    ).resolves.toEqual(
        expect.objectContaining({
            spaceId: space.id,
            authorId: session1.account.id,
            createdTime: expect.any(Date),
            payload: expect.objectContaining({
                type: "Content",
                parent: null,
                content: createSimpleMessageContent("foobar"),
                contentUpdate: null,
                fileIds: [entityId],
                clerical: {type: "ShareNotification", entityType: "Document"},
            }),
        }),
    );

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 0}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session2.action(), {chatId: chat2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And2And3.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");

    await expect(
        getChatMessagePayload(session1.action(), {chatId: chat1And4.id, messageIndex: 1}),
    ).rejects.toThrow("Chat message not found");
});

test("can\u2019t create a chat with only bot accounts", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const botAccount1 = await TestBot.createAndInstantiate(adminSession);
    const botAccount2 = await TestBot.createAndInstantiate(adminSession);

    await expect(
        getOrCreateChatForAccounts(botAccount1.action(), {
            spaceId: space.id,
            otherAccountIds: [],
        }),
    ).rejects.toThrow("Can\u2019t create a chat with only bot accounts");

    await expect(
        getOrCreateChatForAccounts(botAccount1.action(), {
            spaceId: space.id,
            otherAccountIds: [botAccount2.id],
        }),
    ).rejects.toThrow("Can\u2019t create a chat with only bot accounts");

    await expect(
        getOrCreateChatForAccounts(botAccount1.action(), {
            spaceId: space.id,
            otherAccountIds: [botAccount1.id],
        }),
    ).rejects.toThrow("Can\u2019t create a chat with only bot accounts");

    expect(
        await getOrCreateChatForAccounts(botAccount1.action(), {
            spaceId: space.id,
            otherAccountIds: [adminSession.account.id],
        }),
    ).toMatch(idRegExp);

    expect(
        await getOrCreateChatForAccounts(botAccount1.action(), {
            spaceId: space.id,
            otherAccountIds: [botAccount2.id, adminSession.account.id],
        }),
    ).toMatch(idRegExp);

    await expect(
        getOrCreateChatForAccounts(botAccount2.action(), {
            spaceId: space.id,
            otherAccountIds: [],
        }),
    ).rejects.toThrow("Can\u2019t create a chat with only bot accounts");

    await expect(
        getOrCreateChatForAccounts(botAccount2.action(), {
            spaceId: space.id,
            otherAccountIds: [botAccount1.id],
        }),
    ).rejects.toThrow("Can\u2019t create a chat with only bot accounts");

    expect(
        await getOrCreateChatForAccounts(botAccount2.action(), {
            spaceId: space.id,
            otherAccountIds: [adminSession.account.id],
        }),
    ).toMatch(idRegExp);

    expect(
        await getOrCreateChatForAccounts(botAccount2.action(), {
            spaceId: space.id,
            otherAccountIds: [botAccount1.id, adminSession.account.id],
        }),
    ).toMatch(idRegExp);
});

test("bot can read messages in a chat if it\u2019s scope allows", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const [session2, session3] = await space.createSessions(2);

    const bot = await TestBot.createAndInstantiate(session1);

    const chat = await TestChat.get(session2, session3);

    const message = await chat.sendMessage(session2, "foo");

    const {payload} = await getChatMessagePayload(
        bot.action({type: "Account", accountId: session3.account.id}),
        {
            chatId: chat.id,
            messageIndex: message.index,
        },
    );

    // eslint-disable-next-line cyberworlds/string-quotes
    expect(payload.content?.toString()).toEqual('doc(paragraph("foo"))');
});

test("bot can\u2019t send messages in a chat if it\u2019s not a member even if its scope allows reads", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const [session2, session3] = await space.createSessions(2);

    const bot = await TestBot.createAndInstantiate(session1);

    const chat = await TestChat.get(session2, session3);

    await chat.sendMessage(session2, "foo");

    await expect(
        sendChatMessage(bot.action({type: "Account", accountId: session3.account.id}), {
            chatId: chat.id,
            parent: null,
            content: createSimpleMessageContent("bar"),
            fileIds: [],
            createdTimeZone: defaultTimeZone,
        }),
    ).rejects.toThrow("Bot can only view messages in direct chat it\u2019s not a member of");
});

test("bot can send messages in a chat if it\u2019s a member", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const [session2, session3] = await space.createSessions(2);

    const bot = await TestBot.createAndInstantiate(session1);

    const chat = await TestChat.get(session2, session3, bot);

    await chat.sendMessage(session2, "foo");

    await sendChatMessage(bot.action({type: "Account", accountId: session3.account.id}), {
        chatId: chat.id,
        parent: null,
        content: createSimpleMessageContent("bar"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });
});

describe("`getChatAccessPolicyForBotScope()`", () => {
    test("can get access policy for scoped chat", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3] = await space.createSessions(2);
        const botAccount = await TestBot.createAndInstantiate(session1);

        const chat = await TestChat.get(session2, session3);

        const accessPolicy = await getChatAccessPolicyForBotScope(
            botAccount.action({type: "Chat", chatId: chat.id}),
            chat.id,
        );

        expect(accessPolicy.defaultGrant).toBeNull();
        expect(accessPolicy.urlGrant).toBeNull();
        const expectedAccountGrants: Array<[string, {level: "Manage"}]> = [
            [session2.account.id, {level: "Manage"}],
            [session3.account.id, {level: "Manage"}],
        ];
        expect(
            Array.from(accessPolicy.accountGrantById.entries()).sort(([a], [b]) =>
                defaultCompareStrings(a, b),
            ),
        ).toEqual(expectedAccountGrants.sort(([a], [b]) => defaultCompareStrings(a, b)));
    });

    test("can\u2019t get access policy for scoped chat other than the one scoped", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3] = await space.createSessions(2);
        const botAccount = await TestBot.createAndInstantiate(session1);

        const chat = await TestChat.get(session2, session3);
        const otherChat = await TestChat.get(session1, session3);

        await expect(
            getChatAccessPolicyForBotScope(
                botAccount.action({type: "Chat", chatId: chat.id}),
                otherChat.id,
            ),
        ).rejects.toThrow("Can only get `AccountId`s for the scoped chat");
    });

    test("can\u2019t get access policy with space scope", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3] = await space.createSessions(2);
        const botAccount = await TestBot.createAndInstantiate(session1);

        const chat = await TestChat.get(session2, session3);

        await expect(
            getChatAccessPolicyForBotScope(botAccount.action({type: "Space"}), chat.id),
        ).rejects.toThrow("Can only get `AccountId`s for the scoped chat");
    });

    test("can\u2019t get access policy with account scope even if account has access to chat", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3] = await space.createSessions(2);
        const botAccount = await TestBot.createAndInstantiate(session1);

        const chat = await TestChat.get(session2, session3);

        await expect(
            getChatAccessPolicyForBotScope(
                botAccount.action({type: "Account", accountId: session2.account.id}),
                chat.id,
            ),
        ).rejects.toThrow("Can only get `AccountId`s for the scoped chat");
    });

    test("can\u2019t get access policy for chat in different space even if scope declares access", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const [session2, session3] = await space.createSessions(2);
        const otherSession = await otherSpace.createSession({role: "Admin"});
        const otherBotAccount = await TestBot.createAndInstantiate(otherSession);

        const chat = await TestChat.get(session2, session3);

        await expect(
            getChatAccessPolicyForBotScope(
                otherBotAccount.action({type: "Chat", chatId: chat.id}),
                chat.id,
            ),
        ).rejects.toThrow("Account doesn\u2019t have access to space");
    });

    test("can\u2019t get access policy for chat which doesn\u2019t exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);

        const chatId = generateId<ChatId>();

        await expect(
            getChatAccessPolicyForBotScope(botAccount.action({type: "Chat", chatId}), chatId),
        ).rejects.toThrow("Chat not found");
    });
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
            messageNoun: "message",
        };
    },
    async createPrivateRoom(context, spaceId, {insideSessions, insideBotAccount}) {
        const chat = await createChatForTest(context, {
            spaceId,
            otherAccountIds: [
                ...insideSessions.map(session => session.accountId),
                ...(insideBotAccount ? [insideBotAccount.accountId] : []),
            ],
        });

        return {
            key: chat.id,
            spaceId,
            createdTime: chat.createdTime,
            messageCount: 0,
            messageNoun: "message",
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
            messageNoun: "message",
        };
    },
    getMissingRoomKey() {
        return generateId();
    },
    getRoomFileAuthorizer(chatId) {
        return FileChatAuthorizer.bind({type: "ChatMessages", chatId});
    },
    getRoomBotScope(chatId) {
        return {type: "Chat", chatId};
    },
    async createMessage(
        context,
        {roomKey: chatId, parent, content, fileIds, createdTimeZone, isStream},
    ) {
        const message = await sendChatMessage(context, {
            chatId,
            parent,
            content,
            fileIds,
            isStream,
            createdTimeZone: createdTimeZone ?? defaultTimeZone,
        });

        return {
            index: message.index,
            createdTime: message.createdTime,
        };
    },
    async getMessage(context, {roomKey: chatId, messageIndex}) {
        return await getChatMessage(context, {chatId, messageIndex});
    },
    async getMessagePayload(context, {roomKey: chatId, messageIndex}) {
        return await getChatMessagePayload(context, {chatId, messageIndex});
    },
    async getMessageParentContent(context, {roomKey: chatId, parent}) {
        return await getChatMessageParentContent(context, chatId, {parent});
    },
    async updateMessageContent(context, {roomKey: chatId, messageIndex, contentVersion, steps}) {
        return await updateChatMessageContent(context, {
            chatId,
            messageIndex,
            contentVersion,
            steps,
        });
    },
    async deleteMessage(context, {roomKey: chatId, messageIndex}) {
        return await deleteChatMessage(context, {chatId, messageIndex});
    },
    async pingMessageStream(context, {roomKey: chatId, messageIndex}) {
        return await pingChatMessageStream(context, {chatId, messageIndex});
    },
    async putMessageStreamPart(
        context,
        {roomKey: chatId, messageIndex, partIndex, payload, isTimeoutErrorCompletion},
    ) {
        return await putChatMessageStreamPartAndBroadcastEvent(context, {
            chatId,
            messageIndex,
            partIndex,
            payload,
            isTimeoutErrorCompletion,
        });
    },
    async putMessageApprovalDecisions(context, {roomKey: chatId, messageIndex, payload}) {
        const {approvals} = await putChatMessageApprovalDecisions(context, {
            chatId,
            messageIndex,
            payload,
        });

        return {approvals};
    },
    async completeMessageStream(context, {roomKey: chatId, messageIndex}) {
        return await completeChatMessageStream(context, {
            chatId,
            messageIndex,
        });
    },
    async setMessageReaction(
        context,
        {roomKey: chatId, messageIndex, contentVersion, pos, reaction},
    ) {
        return await setChatMessageReaction(context, {
            chatId,
            messageIndex,
            contentVersion,
            pos,
            reaction,
        });
    },
    async deleteMessageReaction(context, {roomKey: chatId, messageIndex, contentVersion, pos}) {
        return await deleteChatMessageReaction(context, {
            chatId,
            messageIndex,
            contentVersion,
            pos,
        });
    },
    async getMessagesFromStart(
        context,
        {roomKey: chatId, limit, afterMessageIndex, beforeMessageIndex},
    ) {
        return await getChatMessagesFromStart(context.actor.authorizeSession(), {
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
        return await getChatMessagesFromEnd(context.actor.authorizeSession(), {
            chatId,
            limit,
            afterMessageIndex,
            beforeMessageIndex,
        });
    },
    async getMessagePayloadsFromStart(
        context,
        {roomKey: chatId, limit, afterMessageIndex, beforeMessageIndex},
    ) {
        return await getChatMessagePayloadsFromStart(context.actor.authorizeSession(), {
            chatId,
            limit,
            afterMessageIndex,
            beforeMessageIndex,
        });
    },
    async getMessagePayloadsFromEnd(
        context,
        {roomKey: chatId, limit, afterMessageIndex, beforeMessageIndex},
    ) {
        return await getChatMessagePayloadsFromEnd(context.actor.authorizeSession(), {
            chatId,
            limit,
            afterMessageIndex,
            beforeMessageIndex,
        });
    },
    async backfillMessages(
        context,
        {roomKey: chatId, checkpoint, clientMessageCount, newMessageLimit},
    ) {
        return await backfillChatMessages(context, {
            chatId,
            checkpoint,
            clientMessageCount,
            newMessageLimit,
        });
    },
});

test("message summary tracks authors and mentions", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB] = await space.createSessions(2);

    const chat = await TestChat.get(sessionA, sessionB);

    const {index} = await sendChatMessage(sessionA.action(), {
        chatId: chat.id,
        parent: null,
        content: assertMessageContent(
            MessageContentProsemirrorSchema.node("doc", {}, [
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("Hello "),
                    MessageContentProsemirrorSchema.nodes.mention.create({
                        mention: {
                            type: "Account",
                            accountId: sessionB.account.id,
                            isShort: false,
                        } satisfies ContentMention,
                    }),
                ]),
            ]),
        ),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    const initialAttributes = await ChatTable.getItem(context, {
        partitionType: "Chat",
        sortRangeType: "Attributes",
        chatId: chat.id,
    });

    expect(initialAttributes.messagesSummary.messageCountByAuthorId.get(sessionA.account.id)).toBe(
        1,
    );
    expect(initialAttributes.messagesSummary.mentionCountByAccountId.get(sessionB.account.id)).toBe(
        1,
    );

    await deleteChatMessage(sessionA.action(), {chatId: chat.id, messageIndex: index});

    const afterDeleteAttributes = await ChatTable.getItem(context, {
        partitionType: "Chat",
        sortRangeType: "Attributes",
        chatId: chat.id,
    });

    expect(
        afterDeleteAttributes.messagesSummary.messageCountByAuthorId.get(sessionA.account.id),
    ).toBe(1);
    expect(
        afterDeleteAttributes.messagesSummary.mentionCountByAccountId.get(sessionB.account.id),
    ).toBe(0);
});
