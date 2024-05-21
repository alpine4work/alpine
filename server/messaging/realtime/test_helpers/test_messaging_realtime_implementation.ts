import {WorkerSessionActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {TestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {
    TestSessionItem,
    createTestSession,
} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {
    CreateMessageFunction,
    DeleteMessageFunction,
    UpdateMessageContentFunction,
    messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint,
    messagingRealtimeCreateMessageBeforeSendTestCheckpoint,
} from "~/server/messaging/realtime/messaging_realtime_connection.js";
import {RoomInterface} from "~/server/messaging/test_helpers/test_messaging_implementation.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    MessageContentWithReferences,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MessageModel, MessagePayloadModel} from "~/shared/messaging/message_model.js";
import {
    MessagingRealtimeEvent,
    MessagingRealtimeProcedures,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type TestMessagingRealtimeConnectionProcedures<Message extends MessageModel> = {
    [Key in keyof MessagingRealtimeProcedures<Message>]: (
        context: WorkerSessionActionContext,
        input: Parameters<MessagingRealtimeProcedures<Message>[Key]>[0],
        span: TracerSpan,
    ) => ReturnType<MessagingRealtimeProcedures<Message>[Key]>;
};

function sendEventToOthers() {
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
    Connection extends {
        procedures: TestMessagingRealtimeConnectionProcedures<MessageModel<RoomKey>>;
    },
>(
    context: TestWorkerContext,
    {
        createRoom: _createRoom,
        createRealtimeConnection,
        createMessageModel,
        createMessage,
        updateMessageContent,
        deleteMessage,
    }: {
        createRoom: (
            context: ServerSessionActionContext,
            spaceId: SpaceId,
            sessions: Array<TestSessionItem>,
        ) => Promise<RoomInterface<RoomKey>>;
        createRealtimeConnection: (options: {
            spaceId: SpaceId;
            roomKey: RoomKey;
            sendEvent: (
                context: WorkerProcessContext,
                message: MessagingRealtimeEvent<MessageModel<RoomKey>>,
            ) => void;
            sendEventToOthers: (
                context: WorkerProcessContext,
                message: MessagingRealtimeEvent<MessageModel<RoomKey>>,
            ) => void;
            iterateOtherConnections: () => Iterable<Connection>;
        }) => Connection;
        createMessageModel: (options: {
            roomKey: RoomKey;
            index: number;
            createdTime: Date;
            author: AccountModel;
            payload: MessagePayloadModel;
        }) => MessageModel<RoomKey>;
        createMessage: CreateMessageFunction<RoomKey, MessageModel<RoomKey>>;
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

    const createRoom = (context: ServerSessionActionContext, spaceId: SpaceId) => {
        return _createRoom(context, spaceId, [session1, session2, session3]);
    };

    // TODO(calebmer): I want to convert this test to using
    // `WebSocketServerTestConnection` (our WebSocket server test harness) but it
    // was written before this utility was available. For now, coincidentally these
    // methods don't need spans so pass in null. Converting to
    // `WebSocketServerTestConnection` will provide proper spans.
    const span: TracerSpan = null as any;

    describe("Realtime messaging implementation", () => {
        test("will backfill messages when requested", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
            });

            let connection1Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection1Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [],
            });

            expect(connection1Events.length).toEqual(0);

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session1),
                    {
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: null,
                newMessages: [
                    createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
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
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
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
            });

            expect(connection1Events).toEqual([]);
            connection1Events = [];

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session1),
                    {
                        clientMessageCount: 1,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: null,
                newMessages: [
                    createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
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
            });

            expect(connection1Events).toEqual([]);
            connection1Events = [];

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session2),
                    {
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 2,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: null,
                newMessages: [
                    createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
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
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
            });

            expect(connection1Events).toEqual([]);
            connection1Events = [];

            expect(connection1Events.length).toEqual(0);
        });

        test("will send messages from other connections", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            let connection1Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection2Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection3Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection1Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection2, connection3],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection2Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection3],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection3Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection2],
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session1),
                    {
                        clientMessageCount: 1,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages(
                    context.action(session2),
                    {
                        clientMessageCount: 1,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            await connection2.procedures.createMessage(
                context.action(session2),
                {
                    parentMessageIndex: null,
                    content: content2,
                },
                span,
            );

            expect(connection1Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
            expect(connection2Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
            expect(connection3Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            await connection2.procedures.createMessage(
                context.action(session2),
                {
                    parentMessageIndex: null,
                    content: content3,
                },
                span,
            );

            expect(connection1Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 2,
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
            expect(connection2Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 2,
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
            expect(connection3Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 2,
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            expect(
                await connection3.procedures.backfillMessages(
                    context.action(session3),
                    {
                        clientMessageCount: 1,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: null,
                newMessages: [
                    createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
        });

        test("will send messages from other connections when those messages are added during backfill", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            let connection1Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection2Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection3Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection1Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection2, connection3],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection2Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection3],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection3Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection2],
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session1),
                    {
                        clientMessageCount: 1,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages(
                    context.action(session2),
                    {
                        clientMessageCount: 1,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            const pausePromise =
                messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint.pauseForTest(
                    session3.accountId,
                );

            const connection3BackfillPromise = connection3.procedures.backfillMessages(
                context.action(session3),
                {
                    clientMessageCount: 1,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                },
                span,
            );

            const {unpause} = await pausePromise;

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            await connection2.procedures.createMessage(
                context.action(session2),
                {
                    parentMessageIndex: null,
                    content: content2,
                },
                span,
            );

            expect(connection1Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
            expect(connection2Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            await connection2.procedures.createMessage(
                context.action(session2),
                {
                    parentMessageIndex: null,
                    content: content3,
                },
                span,
            );

            expect(connection1Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 2,
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
            expect(connection2Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 2,
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            unpause();

            expect(await connection3BackfillPromise).toEqual({
                messageCount: 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
        });

        test("will send messages our connection when those messages are added during backfill", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            let connection1Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection2Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection3Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection1Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection2, connection3],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection2Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection3],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection3Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection2],
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session1),
                    {
                        clientMessageCount: 1,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages(
                    context.action(session2),
                    {
                        clientMessageCount: 1,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            const pausePromise =
                messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint.pauseForTest(
                    session3.accountId,
                );

            const connection3BackfillPromise = connection3.procedures.backfillMessages(
                context.action(session3),
                {
                    clientMessageCount: 1,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                },
                span,
            );

            const {unpause} = await pausePromise;

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            await connection3.procedures.createMessage(
                context.action(session3),
                {
                    parentMessageIndex: null,
                    content: content2,
                },
                span,
            );

            expect(connection1Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
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
            expect(connection2Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
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
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            unpause();

            expect(await connection3BackfillPromise).toEqual({
                messageCount: 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
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
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
        });

        test("will send messages from other connections in order", async () => {
            const room = await createRoom(context.action(session1), space.id);

            let connection1Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection2Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection3Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection1Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection2, connection3],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection2Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection3],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection3Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection2],
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session1),
                    {
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages(
                    context.action(session2),
                    {
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection3.procedures.backfillMessages(
                    context.action(session2),
                    {
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            const pausePromise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(
                    session1.accountId,
                );

            const connection1CreateMessagePromise = connection1.procedures.createMessage(
                context.action(session1),
                {
                    parentMessageIndex: null,
                    content: content1,
                },
                span,
            );

            const {unpause} = await pausePromise;

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            await connection2.procedures.createMessage(
                context.action(session2),
                {
                    parentMessageIndex: null,
                    content: content2,
                },
                span,
            );

            await connection3.procedures.createMessage(
                context.action(session3),
                {
                    parentMessageIndex: null,
                    content: content3,
                },
                span,
            );

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            unpause();
            await connection1CreateMessagePromise;

            expect(connection1Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
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
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
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
            expect(connection2Events).toEqual(connection1Events);
            expect(connection3Events).toEqual(connection1Events);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
        });

        test("will send messages from other connections in order even if it is wacky", async () => {
            const room = await createRoom(context.action(session1), space.id);

            let connection1Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection2Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection3Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection1Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection2, connection3],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection2Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection3],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection3Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection2],
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session1),
                    {
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages(
                    context.action(session2),
                    {
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection3.procedures.backfillMessages(
                    context.action(session2),
                    {
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            const pause1Promise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(
                    session1.accountId,
                );

            const connection1CreateMessagePromise = connection1.procedures.createMessage(
                context.action(session1),
                {
                    parentMessageIndex: null,
                    content: content1,
                },
                span,
            );

            const {unpause: unpause1} = await pause1Promise;

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            const pause2Promise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(
                    session2.accountId,
                );

            const connection2CreateMessagePromise = connection2.procedures.createMessage(
                context.action(session2),
                {
                    parentMessageIndex: null,
                    content: content2,
                },
                span,
            );

            const {unpause: unpause2} = await pause2Promise;

            await connection3.procedures.createMessage(
                context.action(session3),
                {
                    parentMessageIndex: null,
                    content: content3,
                },
                span,
            );

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            unpause2();
            await connection2CreateMessagePromise;

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            unpause1();
            await connection1CreateMessagePromise;

            expect(connection1Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
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
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
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
            expect(connection2Events).toEqual(connection1Events);
            expect(connection3Events).toEqual(connection1Events);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
        });

        test("will send messages from other connections in order only after backfill", async () => {
            const room = await createRoom(context.action(session1), space.id);

            let connection1Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection2Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection3Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection4Messages: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection1Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection2, connection3, connection4],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection2Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection3, connection4],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection3Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection2, connection4],
            });

            const connection4 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection4Messages.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection2, connection3],
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            expect(connection4Messages).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session1),
                    {
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages(
                    context.action(session2),
                    {
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection3.procedures.backfillMessages(
                    context.action(session2),
                    {
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            expect(connection4Messages).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];
            connection4Messages = [];

            const pausePromise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(
                    session1.accountId,
                );

            const connection1CreateMessagePromise = connection1.procedures.createMessage(
                context.action(session1),
                {
                    parentMessageIndex: null,
                    content: content1,
                },
                span,
            );

            const {unpause} = await pausePromise;

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            expect(connection4Messages).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];
            connection4Messages = [];

            await connection2.procedures.createMessage(
                context.action(session2),
                {
                    parentMessageIndex: null,
                    content: content2,
                },
                span,
            );

            await connection3.procedures.createMessage(
                context.action(session3),
                {
                    parentMessageIndex: null,
                    content: content3,
                },
                span,
            );

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            expect(connection4Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 1,
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
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
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];
            connection4Messages = [];

            unpause();
            await connection1CreateMessagePromise;

            expect(connection1Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
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
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
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
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
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
            expect(connection2Events).toEqual(connection1Events);
            expect(connection3Events).toEqual(connection1Events);
            expect(connection4Messages).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
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
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];
            connection4Messages = [];

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            expect(connection4Messages).toEqual([]);
        });

        test("will ignore new messages if they are part of the backfill", async () => {
            const room = await createRoom(context.action(session1), space.id);

            let connection1Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection2Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection1Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection2],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection2Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1],
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session1),
                    {
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];

            const pausePromise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(
                    session1.accountId,
                );

            const connection1CreateMessagePromise = connection1.procedures.createMessage(
                context.action(session1),
                {
                    parentMessageIndex: null,
                    content: content1,
                },
                span,
            );

            const {unpause} = await pausePromise;

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];

            expect(
                await connection2.procedures.backfillMessages(
                    context.action(session2),
                    {
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 1,
                lastMessageChangeTime: null,
                newMessages: [
                    createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
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
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];

            unpause();
            await connection1CreateMessagePromise;

            expect(connection1Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
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
            expect(connection2Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
        });

        test("will ignore new messages if they are queued but part of the backfill", async () => {
            const room = await createRoom(context.action(session1), space.id);

            let connection1Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection2Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection1Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection2],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection2Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1],
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session1),
                    {
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];

            const pausePromise1 =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(
                    session1.accountId,
                );

            const connection1CreateMessagePromise = connection1.procedures.createMessage(
                context.action(session1),
                {
                    parentMessageIndex: null,
                    content: content1,
                },
                span,
            );

            const {unpause: unpause1} = await pausePromise1;

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];

            const pausePromise2 =
                messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint.pauseForTest(
                    session2.accountId,
                );

            const connection2BackfillPromise = connection2.procedures.backfillMessages(
                context.action(session2),
                {
                    clientMessageCount: 0,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                },
                span,
            );

            const {unpause: unpause2} = await pausePromise2;

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];

            unpause1();
            await connection1CreateMessagePromise;

            expect(connection1Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
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
            expect(connection2Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];

            unpause2();

            expect(await connection2BackfillPromise).toEqual({
                messageCount: 1,
                lastMessageChangeTime: null,
                newMessages: [
                    createMessageModel({
                        roomKey: room.key,
                        index: 0,
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
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
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
        });

        test("will backfill changes when requested", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            const message3 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            const updatedMessage3 = await updateMessageContent(context.action(session3), {
                roomKey: room.key,
                messageIndex: message3.index,
                content: content2,
            });

            const deletedMessage1 = await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
            });

            let connection1Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection1Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [],
            });

            expect(connection1Events.length).toEqual(0);

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session1),
                    {
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
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
            });

            expect(connection1Events).toEqual([]);
            connection1Events = [];

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session1),
                    {
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: updatedMessage3.contentUpdatedTime,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
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
            });

            expect(connection1Events).toEqual([]);
            connection1Events = [];

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session2),
                    {
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: deletedMessage1.deletedTime,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: deletedMessage1.deletedTime,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1Events).toEqual([]);
            connection1Events = [];

            const updatedMessage2 = await updateMessageContent(context.action(session2), {
                roomKey: room.key,
                messageIndex: message2.index,
                content: content2,
            });

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session1),
                    {
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
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
            });

            expect(connection1Events).toEqual([]);
            connection1Events = [];

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session2),
                    {
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: deletedMessage1.deletedTime,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
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
            });

            expect(connection1Events).toEqual([]);
            connection1Events = [];
        });

        test("will send changes from other connections", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            let connection1Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection2Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection3Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection1Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection2, connection3],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection2Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection3],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection3Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection2],
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session1),
                    {
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages(
                    context.action(session2),
                    {
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            await connection2.procedures.updateMessageContent(
                context.action(session2),
                {
                    messageIndex: message2.index,
                    content: content2,
                },
                span,
            );

            expect(connection1Events).toEqual([
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
            expect(connection2Events).toEqual([
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
            expect(connection3Events).toEqual([
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
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            await connection2.procedures.deleteMessage(
                context.action(session2),
                {
                    messageIndex: message2.index,
                },
                span,
            );

            expect(connection1Events).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection2Events).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection3Events).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            expect(
                await connection3.procedures.backfillMessages(
                    context.action(session3),
                    {
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
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
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
        });

        test("will send changes from other connections when those changes are added during backfill", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
            });

            let connection1Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection2Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];
            let connection3Events: Array<MessagingRealtimeEvent<MessageModel<RoomKey>>> = [];

            const connection1 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection1Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection2, connection3],
            });

            const connection2 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection2Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection3],
            });

            const connection3 = createRealtimeConnection({
                spaceId: space.id,
                roomKey: room.key,
                sendEvent: (context, message) => connection3Events.push(message),
                sendEventToOthers,
                iterateOtherConnections: () => [connection1, connection2],
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages(
                    context.action(session1),
                    {
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages(
                    context.action(session2),
                    {
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    },
                    span,
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            const pausePromise =
                messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint.pauseForTest(
                    session3.accountId,
                );

            const connection3BackfillPromise = connection3.procedures.backfillMessages(
                context.action(session3),
                {
                    clientMessageCount: 3,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                },
                span,
            );

            const {unpause} = await pausePromise;

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            await connection2.procedures.updateMessageContent(
                context.action(session2),
                {
                    messageIndex: message2.index,
                    content: content2,
                },
                span,
            );

            expect(connection1Events).toEqual([
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
            expect(connection2Events).toEqual([
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
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            await connection2.procedures.deleteMessage(
                context.action(session2),
                {
                    messageIndex: message2.index,
                },
                span,
            );

            expect(connection1Events).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection2Events).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection3Events).toEqual([]);
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            unpause();

            expect(await connection3BackfillPromise).toEqual({
                messageCount: 3,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([
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
            connection1Events = [];
            connection2Events = [];
            connection3Events = [];

            expect(connection1Events).toEqual([]);
            expect(connection2Events).toEqual([]);
            expect(connection3Events).toEqual([]);
        });
    });
}
