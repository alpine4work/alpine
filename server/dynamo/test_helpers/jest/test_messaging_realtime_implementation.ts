import {ProcessContext} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {RoomInterface} from "~/server/dynamo/test_helpers/jest/test_messaging_implementation";
import {TestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {
    TestSession,
    createTestSession,
} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {
    CreateMessageFunction,
    CreateMessageModelFunction,
    DeleteMessageFunction,
    UpdateMessageContentFunction,
} from "~/server/messaging/messaging_implementation";
import {
    messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint,
    messagingRealtimeCreateMessageBeforeSendTestCheckpoint,
} from "~/server/messaging/messaging_realtime_connection";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema";
import {UnimplementedError} from "~/shared/error/error";
import {SpaceId} from "~/shared/id/types/id_types";
import {MessagingRealtimeMessageFromClient} from "~/shared/messaging/messaging_realtime_schema";
import {MessagingRealtimeMessageFromServer} from "~/shared/messaging/messaging_realtime_schema";
import {emptyContentReferences} from "~/shared/models/content_references";
import {MessageContentWithReferences, MessageModel} from "~/shared/models/message_model";

type TestMessagingRealtimeConnection = {
    handleMessage: (
        context: RequestContext,
        message: MessagingRealtimeMessageFromClient,
    ) => Promise<void>;
};

function sendMessageToOthers() {
    throw new UnimplementedError(
        "Sending message to other connections is unimplemented in unit tests",
    );
}

/**
 * Tests the implementation of a realtime messaging connection.
 */
// TODO(calebmer): This should be rewritten to use
// `WebSocketServerTestConnection`. Currently we don't test document comment
// realtime with this suite because we need to use
// `WebSocketServerTestConnection`. When this rewrite happens run this suite
// against document comments.
export function testMessagingRealtimeImplementation<
    RoomKey extends string,
    Connection extends TestMessagingRealtimeConnection,
>(
    context: TestContext,
    {
        createRoom: _createRoom,
        createRealtimeConnection,
        createMessageModel,
        createMessage,
        updateMessageContent,
        deleteMessage,
    }: {
        createRoom: (
            context: RequestContext,
            spaceId: SpaceId,
            sessions: Array<TestSession>,
        ) => Promise<RoomInterface<RoomKey>>;
        createRealtimeConnection: (options: {
            spaceId: SpaceId;
            roomKey: RoomKey;
            sendMessage: (
                context: ProcessContext,
                message: MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>,
            ) => void;
            sendMessageToOthers: (
                context: ProcessContext,
                message: MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>,
            ) => void;
            iterateOtherConnections: () => Iterable<Connection>;
        }) => Connection;
        createMessageModel: CreateMessageModelFunction<RoomKey, MessageModel<RoomKey>>;
        createMessage: CreateMessageFunction<RoomKey>;
        updateMessageContent: UpdateMessageContentFunction<RoomKey>;
        deleteMessage: DeleteMessageFunction<RoomKey>;
    },
) {
    const space = createTestSpace(context);
    const session1 = createTestSession(context, space);
    const session2 = createTestSession(context, space);
    const session3 = createTestSession(context, space);

    const content1 = createSimpleMessageContent("test1");
    const content2 = createSimpleMessageContent("test2");
    const content3 = createSimpleMessageContent("test3");

    const content1WithReferences: MessageContentWithReferences = {
        doc: content1,
        references: emptyContentReferences,
    };
    const content2WithReferences: MessageContentWithReferences = {
        doc: content2,
        references: emptyContentReferences,
    };
    const content3WithReferences: MessageContentWithReferences = {
        doc: content3,
        references: emptyContentReferences,
    };

    const createRoom = (context: RequestContext, spaceId: SpaceId) =>
        _createRoom(context, spaceId, [session1, session2, session3]);

    describe("Realtime messaging implementation", () => {
        test("will backfill messages when requested", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
            });

            let connection1Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection1Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [],
            });

            expect(connection1Messages.length).toEqual(0);

            await connection1.handleMessage(context.request(session1), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 0,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 3,
                    lastMessageChangeTime: null,
                    newMessages: [
                        createMessageModel({
                            roomKey: room.key,
                            index: 0,
                            author: session1.account,
                            createdTime: expect.any(Date),
                            payload: {
                                type: "Content",
                                parentMessageIndex: null,
                                content: content1WithReferences,
                                contentUpdatedTime: null,
                            },
                        }),
                        createMessageModel({
                            roomKey: room.key,
                            index: 1,
                            author: session2.account,
                            createdTime: expect.any(Date),
                            payload: {
                                type: "Content",
                                parentMessageIndex: null,
                                content: content2WithReferences,
                                contentUpdatedTime: null,
                            },
                        }),
                        createMessageModel({
                            roomKey: room.key,
                            index: 2,
                            author: session3.account,
                            createdTime: expect.any(Date),
                            payload: {
                                type: "Content",
                                parentMessageIndex: null,
                                content: content3WithReferences,
                                contentUpdatedTime: null,
                            },
                        }),
                    ],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            connection1Messages = [];

            await connection1.handleMessage(context.request(session1), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 1,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 3,
                    lastMessageChangeTime: null,
                    newMessages: [
                        createMessageModel({
                            roomKey: room.key,
                            index: 1,
                            author: session2.account,
                            createdTime: expect.any(Date),
                            payload: {
                                type: "Content",
                                parentMessageIndex: null,
                                content: content2WithReferences,
                                contentUpdatedTime: null,
                            },
                        }),
                        createMessageModel({
                            roomKey: room.key,
                            index: 2,
                            author: session3.account,
                            createdTime: expect.any(Date),
                            payload: {
                                type: "Content",
                                parentMessageIndex: null,
                                content: content3WithReferences,
                                contentUpdatedTime: null,
                            },
                        }),
                    ],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            connection1Messages = [];

            await connection1.handleMessage(context.request(session2), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 0,
                clientLastMessageChangeTime: null,
                newMessageLimit: 2,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 3,
                    lastMessageChangeTime: null,
                    newMessages: [
                        createMessageModel({
                            roomKey: room.key,
                            index: 0,
                            author: session1.account,
                            createdTime: expect.any(Date),
                            payload: {
                                type: "Content",
                                parentMessageIndex: null,
                                content: content1WithReferences,
                                contentUpdatedTime: null,
                            },
                        }),
                        createMessageModel({
                            roomKey: room.key,
                            index: 1,
                            author: session2.account,
                            createdTime: expect.any(Date),
                            payload: {
                                type: "Content",
                                parentMessageIndex: null,
                                content: content2WithReferences,
                                contentUpdatedTime: null,
                            },
                        }),
                    ],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            connection1Messages = [];

            expect(connection1Messages.length).toEqual(0);
        });

        test("will send messages from other connections", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            let connection1Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection2Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection3Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection1Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection2, connection3],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection2Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection3],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection3Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection2],
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);

            await connection1.handleMessage(context.request(session1), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 1,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            await connection2.handleMessage(context.request(session2), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 1,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 1,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 1,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection3Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            await connection2.handleMessage(context.request(session2), {
                type: "CreateMessage",
                parentMessageIndex: null,
                content: content2,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection3Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            await connection2.handleMessage(context.request(session2), {
                type: "CreateMessage",
                parentMessageIndex: null,
                content: content3,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 2,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 2,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection3Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 2,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            await connection3.handleMessage(context.request(session3), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 1,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 3,
                    lastMessageChangeTime: null,
                    newMessages: [
                        createMessageModel({
                            roomKey: room.key,
                            index: 1,
                            author: session2.account,
                            createdTime: expect.any(Date),
                            payload: {
                                type: "Content",
                                parentMessageIndex: null,
                                content: content2WithReferences,
                                contentUpdatedTime: null,
                            },
                        }),
                        createMessageModel({
                            roomKey: room.key,
                            index: 2,
                            author: session2.account,
                            createdTime: expect.any(Date),
                            payload: {
                                type: "Content",
                                parentMessageIndex: null,
                                content: content3WithReferences,
                                contentUpdatedTime: null,
                            },
                        }),
                    ],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
        });

        test("will send messages from other connections when those messages are added during backfill", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            let connection1Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection2Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection3Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection1Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection2, connection3],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection2Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection3],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection3Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection2],
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);

            await connection1.handleMessage(context.request(session1), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 1,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            await connection2.handleMessage(context.request(session2), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 1,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            const pausePromise =
                messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint.pauseForTest(
                    session3.id,
                );

            const connection3BackfillPromise = connection3.handleMessage(
                context.request(session3),
                {
                    type: "BackfillMessagesRequest",
                    clientMessageCount: 1,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                },
            );

            const {unpause} = await pausePromise;

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 1,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 1,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection3Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            await connection2.handleMessage(context.request(session2), {
                type: "CreateMessage",
                parentMessageIndex: null,
                content: content2,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection3Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            await connection2.handleMessage(context.request(session2), {
                type: "CreateMessage",
                parentMessageIndex: null,
                content: content3,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 2,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 2,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection3Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            unpause();
            await connection3BackfillPromise;

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 1,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 2,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
        });

        test("will send messages our connection when those messages are added during backfill", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            let connection1Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection2Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection3Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection1Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection2, connection3],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection2Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection3],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection3Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection2],
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);

            await connection1.handleMessage(context.request(session1), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 1,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            await connection2.handleMessage(context.request(session2), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 1,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            const pausePromise =
                messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint.pauseForTest(
                    session3.id,
                );

            const connection3BackfillPromise = connection3.handleMessage(
                context.request(session3),
                {
                    type: "BackfillMessagesRequest",
                    clientMessageCount: 1,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                },
            );

            const {unpause} = await pausePromise;

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 1,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 1,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection3Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            await connection3.handleMessage(context.request(session3), {
                type: "CreateMessage",
                parentMessageIndex: null,
                content: content2,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: session3.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: session3.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection3Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            unpause();
            await connection3BackfillPromise;

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 1,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: session3.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
        });

        test("will send messages from other connections in order", async () => {
            const room = await createRoom(context.request(session1), space.id);

            let connection1Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection2Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection3Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection1Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection2, connection3],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection2Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection3],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection3Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection2],
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);

            await connection1.handleMessage(context.request(session1), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 0,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            await connection2.handleMessage(context.request(session2), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 0,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            await connection3.handleMessage(context.request(session2), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 0,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 0,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 0,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection3Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 0,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            const pausePromise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(session1.id);

            const connection1CreateMessagePromise = connection1.handleMessage(
                context.request(session1),
                {
                    type: "CreateMessage",
                    parentMessageIndex: null,
                    content: content1,
                },
            );

            const {unpause} = await pausePromise;

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            await connection2.handleMessage(context.request(session2), {
                type: "CreateMessage",
                parentMessageIndex: null,
                content: content2,
            });

            await connection3.handleMessage(context.request(session3), {
                type: "CreateMessage",
                parentMessageIndex: null,
                content: content3,
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            unpause();
            await connection1CreateMessagePromise;

            expect(connection1Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: session1.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 2,
                        author: session3.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2Messages).toEqual(connection1Messages);
            expect(connection3Messages).toEqual(connection1Messages);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
        });

        test("will send messages from other connections in order even if it is wacky", async () => {
            const room = await createRoom(context.request(session1), space.id);

            let connection1Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection2Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection3Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection1Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection2, connection3],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection2Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection3],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection3Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection2],
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);

            await connection1.handleMessage(context.request(session1), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 0,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            await connection2.handleMessage(context.request(session2), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 0,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            await connection3.handleMessage(context.request(session2), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 0,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 0,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 0,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection3Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 0,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            const pause1Promise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(session1.id);

            const connection1CreateMessagePromise = connection1.handleMessage(
                context.request(session1),
                {
                    type: "CreateMessage",
                    parentMessageIndex: null,
                    content: content1,
                },
            );

            const {unpause: unpause1} = await pause1Promise;

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            const pause2Promise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(session2.id);

            const connection2CreateMessagePromise = connection2.handleMessage(
                context.request(session2),
                {
                    type: "CreateMessage",
                    parentMessageIndex: null,
                    content: content2,
                },
            );

            const {unpause: unpause2} = await pause2Promise;

            await connection3.handleMessage(context.request(session3), {
                type: "CreateMessage",
                parentMessageIndex: null,
                content: content3,
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            unpause2();
            await connection2CreateMessagePromise;

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            unpause1();
            await connection1CreateMessagePromise;

            expect(connection1Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: session1.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 2,
                        author: session3.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2Messages).toEqual(connection1Messages);
            expect(connection3Messages).toEqual(connection1Messages);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
        });

        test("will send messages from other connections in order only after backfill", async () => {
            const room = await createRoom(context.request(session1), space.id);

            let connection1Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection2Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection3Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection4Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection1Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection2, connection3, connection4],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection2Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection3, connection4],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection3Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection2, connection4],
            });

            const connection4 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection4Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection2, connection3],
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
            expect(connection4Messages).toEqual([]);

            await connection1.handleMessage(context.request(session1), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 0,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            await connection2.handleMessage(context.request(session2), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 0,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            await connection3.handleMessage(context.request(session2), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 0,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 0,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 0,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection3Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 0,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection4Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];
            connection4Messages = [];

            const pausePromise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(session1.id);

            const connection1CreateMessagePromise = connection1.handleMessage(
                context.request(session1),
                {
                    type: "CreateMessage",
                    parentMessageIndex: null,
                    content: content1,
                },
            );

            const {unpause} = await pausePromise;

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
            expect(connection4Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];
            connection4Messages = [];

            await connection2.handleMessage(context.request(session2), {
                type: "CreateMessage",
                parentMessageIndex: null,
                content: content2,
            });

            await connection3.handleMessage(context.request(session3), {
                type: "CreateMessage",
                parentMessageIndex: null,
                content: content3,
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
            expect(connection4Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 2,
                        author: session3.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];
            connection4Messages = [];

            unpause();
            await connection1CreateMessagePromise;

            expect(connection1Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: session1.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: session2.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 2,
                        author: session3.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2Messages).toEqual(connection1Messages);
            expect(connection3Messages).toEqual(connection1Messages);
            expect(connection4Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: session1.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];
            connection4Messages = [];

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
            expect(connection4Messages).toEqual([]);
        });

        test("will ignore new messages if they are part of the backfill", async () => {
            const room = await createRoom(context.request(session1), space.id);

            let connection1Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection2Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection1Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection2],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection2Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1],
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);

            await connection1.handleMessage(context.request(session1), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 0,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 0,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection2Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];

            const pausePromise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(session1.id);

            const connection1CreateMessagePromise = connection1.handleMessage(
                context.request(session1),
                {
                    type: "CreateMessage",
                    parentMessageIndex: null,
                    content: content1,
                },
            );

            const {unpause} = await pausePromise;

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];

            await connection2.handleMessage(context.request(session2), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 0,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 1,
                    lastMessageChangeTime: null,
                    newMessages: [
                        createMessageModel({
                            roomKey: room.key,
                            index: 0,
                            author: session1.account,
                            createdTime: expect.any(Date),
                            payload: {
                                type: "Content",
                                parentMessageIndex: null,
                                content: content1WithReferences,
                                contentUpdatedTime: null,
                            },
                        }),
                    ],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            connection1Messages = [];
            connection2Messages = [];

            unpause();
            await connection1CreateMessagePromise;

            expect(connection1Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: session1.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
        });

        test("will ignore new messages if they are queued but part of the backfill", async () => {
            const room = await createRoom(context.request(session1), space.id);

            let connection1Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection2Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection1Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection2],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection2Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1],
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);

            await connection1.handleMessage(context.request(session1), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 0,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 0,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection2Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];

            const pausePromise1 =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(session1.id);

            const connection1CreateMessagePromise = connection1.handleMessage(
                context.request(session1),
                {
                    type: "CreateMessage",
                    parentMessageIndex: null,
                    content: content1,
                },
            );

            const {unpause: unpause1} = await pausePromise1;

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];

            const pausePromise2 =
                messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint.pauseForTest(
                    session2.id,
                );

            const connection2BackfillPromise = connection2.handleMessage(
                context.request(session2),
                {
                    type: "BackfillMessagesRequest",
                    clientMessageCount: 0,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                },
            );

            const {unpause: unpause2} = await pausePromise2;

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];

            unpause1();
            await connection1CreateMessagePromise;

            expect(connection1Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: session1.account,
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];

            unpause2();
            await connection2BackfillPromise;

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 1,
                    lastMessageChangeTime: null,
                    newMessages: [
                        createMessageModel({
                            roomKey: room.key,
                            index: 0,
                            author: session1.account,
                            createdTime: expect.any(Date),
                            payload: {
                                type: "Content",
                                parentMessageIndex: null,
                                content: content1WithReferences,
                                contentUpdatedTime: null,
                            },
                        }),
                    ],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            connection1Messages = [];
            connection2Messages = [];

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
        });

        test("will backfill changes when requested", async () => {
            const room = await createRoom(context.request(session1), space.id);

            const message1 = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            const message2 = await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            const message3 = await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            const updatedMessage3 = await updateMessageContent(context.request(session3), {
                roomKey: room.key,
                messageIndex: message3.index,
                content: content2,
            });

            const deletedMessage1 = await deleteMessage(context.request(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
            });

            let connection1Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection1Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [],
            });

            expect(connection1Messages.length).toEqual(0);

            await connection1.handleMessage(context.request(session1), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 3,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 3,
                    lastMessageChangeTime: deletedMessage1.deletedTime,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {
                        type: "Available",
                        changes: [
                            {
                                type: "UpdateContent",
                                index: message3.index,
                                content: content2WithReferences,
                                contentUpdatedTime: updatedMessage3.contentUpdatedTime,
                            },
                            {
                                type: "Delete",
                                index: message1.index,
                                deletedTime: deletedMessage1.deletedTime,
                            },
                        ],
                    },
                    typingStateByConnectionId: new Map(),
                },
            ]);
            connection1Messages = [];

            await connection1.handleMessage(context.request(session1), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 3,
                clientLastMessageChangeTime: updatedMessage3.contentUpdatedTime,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 3,
                    lastMessageChangeTime: deletedMessage1.deletedTime,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {
                        type: "Available",
                        changes: [
                            {
                                type: "Delete",
                                index: message1.index,
                                deletedTime: deletedMessage1.deletedTime,
                            },
                        ],
                    },
                    typingStateByConnectionId: new Map(),
                },
            ]);
            connection1Messages = [];

            await connection1.handleMessage(context.request(session2), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 3,
                clientLastMessageChangeTime: deletedMessage1.deletedTime,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 3,
                    lastMessageChangeTime: deletedMessage1.deletedTime,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            connection1Messages = [];

            const updatedMessage2 = await updateMessageContent(context.request(session2), {
                roomKey: room.key,
                messageIndex: message2.index,
                content: content2,
            });

            await connection1.handleMessage(context.request(session1), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 3,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 3,
                    lastMessageChangeTime: updatedMessage2.contentUpdatedTime,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {
                        type: "Available",
                        changes: [
                            {
                                type: "UpdateContent",
                                index: message3.index,
                                content: content2WithReferences,
                                contentUpdatedTime: updatedMessage3.contentUpdatedTime,
                            },
                            {
                                type: "Delete",
                                index: message1.index,
                                deletedTime: deletedMessage1.deletedTime,
                            },
                            {
                                type: "UpdateContent",
                                index: message2.index,
                                content: content2WithReferences,
                                contentUpdatedTime: updatedMessage2.contentUpdatedTime,
                            },
                        ],
                    },
                    typingStateByConnectionId: new Map(),
                },
            ]);
            connection1Messages = [];

            await connection1.handleMessage(context.request(session2), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 3,
                clientLastMessageChangeTime: deletedMessage1.deletedTime,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 3,
                    lastMessageChangeTime: updatedMessage2.contentUpdatedTime,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {
                        type: "Available",
                        changes: [
                            {
                                type: "UpdateContent",
                                index: message2.index,
                                content: content2WithReferences,
                                contentUpdatedTime: updatedMessage2.contentUpdatedTime,
                            },
                        ],
                    },
                    typingStateByConnectionId: new Map(),
                },
            ]);
            connection1Messages = [];
        });

        test("will send changes from other connections", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            const message2 = await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            let connection1Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection2Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection3Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection1Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection2, connection3],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection2Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection3],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection3Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection2],
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);

            await connection1.handleMessage(context.request(session1), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 3,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            await connection2.handleMessage(context.request(session2), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 3,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 3,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 3,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection3Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            await connection2.handleMessage(context.request(session2), {
                type: "UpdateMessageContent",
                messageIndex: message2.index,
                content: content2,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "UpdateContent",
                        index: message2.index,
                        content: content2WithReferences,
                        contentUpdatedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "UpdateContent",
                        index: message2.index,
                        content: content2WithReferences,
                        contentUpdatedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection3Messages).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "UpdateContent",
                        index: message2.index,
                        content: content2WithReferences,
                        contentUpdatedTime: expect.any(Date),
                    },
                },
            ]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            await connection2.handleMessage(context.request(session2), {
                type: "DeleteMessage",
                messageIndex: message2.index,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection3Messages).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            await connection3.handleMessage(context.request(session3), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 3,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 3,
                    lastMessageChangeTime: expect.any(Date),
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {
                        type: "Available",
                        changes: [
                            {
                                type: "UpdateContent",
                                index: message2.index,
                                content: content2WithReferences,
                                contentUpdatedTime: expect.any(Date),
                            },
                            {
                                type: "Delete",
                                index: message2.index,
                                deletedTime: expect.any(Date),
                            },
                        ],
                    },
                    typingStateByConnectionId: new Map(),
                },
            ]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
        });

        test("will send changes from other connections when those changes are added during backfill", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            const message2 = await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            let connection1Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection2Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];
            let connection3Messages: Array<
                MessagingRealtimeMessageFromServer<MessageModel<RoomKey>>
            > = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection1Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection2, connection3],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection2Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection3],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendMessage: (context, message) => connection3Messages.push(message),
                sendMessageToOthers,
                iterateOtherConnections: () => [connection1, connection2],
            });

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);

            await connection1.handleMessage(context.request(session1), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 3,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            await connection2.handleMessage(context.request(session2), {
                type: "BackfillMessagesRequest",
                clientMessageCount: 3,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            const pausePromise =
                messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint.pauseForTest(
                    session3.id,
                );

            const connection3BackfillPromise = connection3.handleMessage(
                context.request(session3),
                {
                    type: "BackfillMessagesRequest",
                    clientMessageCount: 3,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                },
            );

            const {unpause} = await pausePromise;

            expect(connection1Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 3,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 3,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
            ]);
            expect(connection3Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            await connection2.handleMessage(context.request(session2), {
                type: "UpdateMessageContent",
                messageIndex: message2.index,
                content: content2,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "UpdateContent",
                        index: message2.index,
                        content: content2WithReferences,
                        contentUpdatedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "UpdateContent",
                        index: message2.index,
                        content: content2WithReferences,
                        contentUpdatedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection3Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            await connection2.handleMessage(context.request(session2), {
                type: "DeleteMessage",
                messageIndex: message2.index,
            });

            expect(connection1Messages).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection2Messages).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection3Messages).toEqual([]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            unpause();
            await connection3BackfillPromise;

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([
                {
                    type: "BackfillMessagesResponse",
                    messageCount: 3,
                    lastMessageChangeTime: null,
                    newMessages: [],
                    newOtherReferencedMessages: [],
                    messageChangesResult: {type: "Available", changes: []},
                    typingStateByConnectionId: new Map(),
                },
                {
                    type: "ChangeMessage",
                    change: {
                        type: "UpdateContent",
                        index: message2.index,
                        content: content2WithReferences,
                        contentUpdatedTime: expect.any(Date),
                    },
                },
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);
            connection1Messages = [];
            connection2Messages = [];
            connection3Messages = [];

            expect(connection1Messages).toEqual([]);
            expect(connection2Messages).toEqual([]);
            expect(connection3Messages).toEqual([]);
        });
    });
}
