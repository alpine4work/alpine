import {WorkerSessionActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import {TestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {SearchInjection} from "~/server/context/injection_context_module.js";
import {isServerActionContext} from "~/server/context/is_server_action_context.js";
import {getDocumentPreviewIfPossible} from "~/server/documents/data/documents_table.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {
    CreateMessageFunction,
    DeleteMessageFunction,
    UpdateMessageContentFunction,
    messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint,
    messagingRealtimeCreateMessageBeforeSendTestCheckpoint,
    messagingRealtimeUpdateMessageContentBeforeSendTestCheckpoint,
} from "~/server/messaging/realtime/messaging_realtime_connection.js";
import {RoomInterface} from "~/server/messaging/test_helpers/test_messaging_implementation.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {FileDocumentEntityModelSchema} from "~/shared/documents/file_document_entity_model_schema.js";
import {PermissionDeniedError, UnimplementedError} from "~/shared/error/error.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {
    MessageContentWithReferences,
    assertMessageContent,
    createSimpleMessageContent,
    MessageContentProsemirrorSchema as schema,
} from "~/shared/messaging/message_content_schema.js";
import {MessageModel, MessagePayloadModel} from "~/shared/messaging/message_model.js";
import {
    MessagingRealtimeEvent,
    MessagingRealtimeProcedures,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {parseSearchDynamicEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {waitForExpect} from "~/shared/test_helpers/wait_for_expect.js";

export const testMessagingRealtimeImplementationSearchInjection: Partial<SearchInjection> = {
    getSearchMentionEntityIfPossible: async (context, spaceId, entityId) => {
        const entityIdObject = parseSearchDynamicEntityId(entityId);
        if (entityIdObject.type !== "Document") {
            throw new UnimplementedError(
                quote`\`getSearchEntityIfPossible()\` is unimplemented for ${entityIdObject.type}`,
            );
        }

        assert(isServerActionContext(context));

        const documentResult = await getDocumentPreviewIfPossible(
            context,
            entityIdObject.documentId,
        );
        if (!documentResult) return null;
        if (!documentResult.ok) return {isPrivate: true};

        return {
            isPrivate: false,
            entity: new SearchEntityModel({
                id: entityId,
                title: documentResult.value.getTitle(),
                titleVersion: {type: "Integer", version: documentResult.value.version},
                media: null,
            }),
        };
    },
};

export function testMessagingRealtimeImplementation<RoomKey extends string>(
    context: TestWorkerContext,
    {
        createRoom,
        connectForTest,
        createMessageModel,
        createMessage,
        updateMessageContent,
        deleteMessage,
    }: {
        createRoom: (
            sessions: NonEmptyReadonlyArray<TestSpaceSession>,
        ) => Promise<RoomInterface<RoomKey>>;
        connectForTest: (
            context: WorkerSessionActionContext,
            roomKey: RoomKey,
        ) => Promise<{
            procedures: MessagingRealtimeProcedures<MessageModel>;
            takeEvents(): ReadonlyArray<MessagingRealtimeEvent<MessageModel>>;
        }>;
        createMessageModel: (options: {
            roomKey: RoomKey;
            index: number;
            createdTime: Date;
            author: AccountModel;
            payload: MessagePayloadModel;
        }) => MessageModel<RoomKey>;
        createMessage: CreateMessageFunction<RoomKey>;
        updateMessageContent: UpdateMessageContentFunction<RoomKey>;
        deleteMessage: DeleteMessageFunction<RoomKey>;
    },
) {
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

    async function waitForTakeSomeEvents(connection: {
        takeEvents(): ReadonlyArray<MessagingRealtimeEvent<MessageModel>>;
    }) {
        let events: ReadonlyArray<MessagingRealtimeEvent<MessageModel>> = [];

        await waitForExpect(() => {
            events = connection.takeEvents();
            expect(events.length).toBeGreaterThan(0);
        });

        return events;
    }

    describe("Realtime messaging implementation", () => {
        test("will backfill messages when requested", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(3);

            const room = await createRoom(sessions);

            const [session1, session2, session3] = sessions;

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            const connection1 = await connectForTest(context.action(session1), room.key);

            expect(connection1.takeEvents().length).toEqual(0);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 3,
                lastMessageChangeTime: null,
                newMessages: [
                    createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session1.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 2,
                        author: await session3.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                ],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 1,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 3,
                lastMessageChangeTime: null,
                newMessages: [
                    createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 2,
                        author: await session3.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                ],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 2,
                }),
            ).toEqual({
                messageCount: room.messageCount + 3,
                lastMessageChangeTime: null,
                newMessages: [
                    createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session1.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                ],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);
        });

        test("will send messages from other connections", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(3);

            const room = await createRoom(sessions);

            const [session1, session2, session3] = sessions;

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const connection1 = await connectForTest(context.action(session1), room.key);
            const connection2 = await connectForTest(context.action(session2), room.key);
            const connection3 = await connectForTest(context.action(session3), room.key);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 1,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 1,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            await connection2.procedures.createMessage({
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection3.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);

            expect(
                await connection3.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 1,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 2,
                lastMessageChangeTime: null,
                newMessages: [
                    createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                ],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            await connection2.procedures.createMessage({
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 2,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 2,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection3.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 2,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);
        });

        test("will send messages from other connections when those messages are added during backfill", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(3);

            const room = await createRoom(sessions);

            const [session1, session2, session3] = sessions;

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const connection1 = await connectForTest(context.action(session1), room.key);
            const connection2 = await connectForTest(context.action(session2), room.key);
            const connection3 = await connectForTest(context.action(session3), room.key);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 1,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 1,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            const pausePromise =
                messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint.pauseForTest(
                    session3.account.id,
                );

            const connection3BackfillPromise = connection3.procedures.backfillMessages({
                clientMessageCount: room.messageCount + 1,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            const {unpause} = await pausePromise;

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            await connection2.procedures.createMessage({
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            expect(await waitForTakeSomeEvents(connection1)).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(await waitForTakeSomeEvents(connection2)).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection3.takeEvents()).toEqual([]);

            await connection2.procedures.createMessage({
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            expect(await waitForTakeSomeEvents(connection1)).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 2,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(await waitForTakeSomeEvents(connection2)).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 2,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection3.takeEvents()).toEqual([]);

            unpause();

            expect(await connection3BackfillPromise).toEqual({
                messageCount: room.messageCount + 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 2,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);
        });

        test("will send messages our connection when those messages are added during backfill", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(3);

            const room = await createRoom(sessions);

            const [session1, session2, session3] = sessions;

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const connection1 = await connectForTest(context.action(session1), room.key);
            const connection2 = await connectForTest(context.action(session2), room.key);
            const connection3 = await connectForTest(context.action(session3), room.key);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 1,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 1,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            const pausePromise =
                messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint.pauseForTest(
                    session3.account.id,
                );

            const connection3BackfillPromise = connection3.procedures.backfillMessages({
                clientMessageCount: room.messageCount + 1,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            const {unpause} = await pausePromise;

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            await connection3.procedures.createMessage({
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            expect(await waitForTakeSomeEvents(connection1)).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session3.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(await waitForTakeSomeEvents(connection2)).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session3.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection3.takeEvents()).toEqual([]);

            unpause();

            expect(await connection3BackfillPromise).toEqual({
                messageCount: room.messageCount + 1,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session3.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);
        });

        test("will send messages from other connections in order", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(3);

            const room = await createRoom(sessions);

            const [session1, session2, session3] = sessions;

            const connection1 = await connectForTest(context.action(session1), room.key);
            const connection2 = await connectForTest(context.action(session2), room.key);
            const connection3 = await connectForTest(context.action(session3), room.key);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection3.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            const pausePromise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(
                    session1.account.id,
                );

            const connection1CreateMessagePromise = connection1.procedures.createMessage({
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const {unpause} = await pausePromise;

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            await connection2.procedures.createMessage({
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await connection3.procedures.createMessage({
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            unpause();
            await connection1CreateMessagePromise;

            await ProcessContextModule.waitForTestTasks();

            const connection1Events = connection1.takeEvents();
            expect(connection1Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session1.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 2,
                        author: await session3.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2.takeEvents()).toEqual(connection1Events);
            expect(connection3.takeEvents()).toEqual(connection1Events);
        });

        test("will send messages from other connections in order even if it is wacky", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(3);

            const room = await createRoom(sessions);

            const [session1, session2, session3] = sessions;

            const connection1 = await connectForTest(context.action(session1), room.key);
            const connection2 = await connectForTest(context.action(session2), room.key);
            const connection3 = await connectForTest(context.action(session3), room.key);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection3.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            const pause1Promise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(
                    session1.account.id,
                );

            const connection1CreateMessagePromise = connection1.procedures.createMessage({
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const {unpause: unpause1} = await pause1Promise;

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            const pause2Promise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(
                    session2.account.id,
                );

            const connection2CreateMessagePromise = connection2.procedures.createMessage({
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            const {unpause: unpause2} = await pause2Promise;

            await connection3.procedures.createMessage({
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            unpause2();
            await connection2CreateMessagePromise;

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            unpause1();
            await connection1CreateMessagePromise;

            await ProcessContextModule.waitForTestTasks();

            const connection1Events = connection1.takeEvents();
            expect(connection1Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session1.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 2,
                        author: await session3.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2.takeEvents()).toEqual(connection1Events);
            expect(connection3.takeEvents()).toEqual(connection1Events);
        });

        test("will send messages from other connections in order only after backfill", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(3);

            const room = await createRoom(sessions);

            const [session1, session2, session3] = sessions;

            const connection1 = await connectForTest(context.action(session1), room.key);
            const connection2 = await connectForTest(context.action(session2), room.key);
            const connection3 = await connectForTest(context.action(session3), room.key);
            const connection4 = await connectForTest(context.action(session2), room.key);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);
            expect(connection4.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection3.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);
            expect(connection4.takeEvents()).toEqual([]);

            const pausePromise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(
                    session1.account.id,
                );

            const connection1CreateMessagePromise = connection1.procedures.createMessage({
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const {unpause} = await pausePromise;

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);
            expect(connection4.takeEvents()).toEqual([]);

            await connection2.procedures.createMessage({
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await connection3.procedures.createMessage({
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            expect(connection4.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 2,
                        author: await session3.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);

            unpause();
            await connection1CreateMessagePromise;

            await ProcessContextModule.waitForTestTasks();

            const connection1Events = connection1.takeEvents();
            expect(connection1Events).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session1.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 2,
                        author: await session3.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2.takeEvents()).toEqual(connection1Events);
            expect(connection3.takeEvents()).toEqual(connection1Events);
            expect(connection4.takeEvents()).toEqual([]);
        });

        test("will ignore new messages if they are part of the backfill", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(2);

            const room = await createRoom(sessions);

            const [session1, session2] = sessions;

            const connection1 = await connectForTest(context.action(session1), room.key);
            const connection2 = await connectForTest(context.action(session2), room.key);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);

            const pausePromise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(
                    session1.account.id,
                );

            const connection1CreateMessagePromise = connection1.procedures.createMessage({
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const {unpause} = await pausePromise;

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);

            expect(
                await connection2.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 1,
                lastMessageChangeTime: null,
                newMessages: [
                    createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session1.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                ],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);

            unpause();
            await connection1CreateMessagePromise;

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session1.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2.takeEvents()).toEqual([]);
        });

        test("will ignore new messages if they are queued but part of the backfill", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(2);

            const room = await createRoom(sessions);

            const [session1, session2] = sessions;

            const connection1 = await connectForTest(context.action(session1), room.key);
            const connection2 = await connectForTest(context.action(session2), room.key);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 0,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);

            const pausePromise1 =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(
                    session1.account.id,
                );

            const connection1CreateMessagePromise = connection1.procedures.createMessage({
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const {unpause: unpause1} = await pausePromise1;

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);

            const pausePromise2 =
                messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint.pauseForTest(
                    session2.account.id,
                );

            const connection2BackfillPromise = connection2.procedures.backfillMessages({
                clientMessageCount: room.messageCount,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            const {unpause: unpause2} = await pausePromise2;

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);

            unpause1();
            await connection1CreateMessagePromise;

            expect(await waitForTakeSomeEvents(connection1)).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session1.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2.takeEvents()).toEqual([]);

            unpause2();

            expect(await connection2BackfillPromise).toEqual({
                messageCount: room.messageCount + 1,
                lastMessageChangeTime: null,
                newMessages: [
                    createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session1.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                ],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
        });

        test("will backfill changes when requested", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(3);

            const room = await createRoom(sessions);

            const [session1, session2, session3] = sessions;

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
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

            const connection1 = await connectForTest(context.action(session1), room.key);

            expect(connection1.takeEvents().length).toEqual(0);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 3,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 3,
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

            expect(connection1.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 3,
                    clientLastMessageChangeTime: updatedMessage3.contentUpdatedTime,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 3,
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

            expect(connection1.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 3,
                    clientLastMessageChangeTime: deletedMessage1.deletedTime,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 3,
                lastMessageChangeTime: deletedMessage1.deletedTime,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);

            const updatedMessage2 = await updateMessageContent(context.action(session2), {
                roomKey: room.key,
                messageIndex: message2.index,
                content: content2,
            });

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 3,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 3,
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

            expect(connection1.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 3,
                    clientLastMessageChangeTime: deletedMessage1.deletedTime,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 3,
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

            expect(connection1.takeEvents()).toEqual([]);
        });

        test("will send changes from other connections", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(3);

            const room = await createRoom(sessions);

            const [session1, session2, session3] = sessions;

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const connection1 = await connectForTest(context.action(session1), room.key);
            const connection2 = await connectForTest(context.action(session2), room.key);
            const connection3 = await connectForTest(context.action(session3), room.key);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 3,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 3,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 3,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 3,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            await connection2.procedures.updateMessageContent({
                messageIndex: message2.index,
                content: content2,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([
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
            expect(connection2.takeEvents()).toEqual([
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
            expect(connection3.takeEvents()).toEqual([
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

            await connection2.procedures.deleteMessage({
                messageIndex: message2.index,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection2.takeEvents()).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection3.takeEvents()).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);

            expect(
                await connection3.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 3,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 3,
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

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);
        });

        test("will send changes from other connections when those changes are added during backfill", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(3);

            const room = await createRoom(sessions);

            const [session1, session2, session3] = sessions;

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const connection1 = await connectForTest(context.action(session1), room.key);
            const connection2 = await connectForTest(context.action(session2), room.key);
            const connection3 = await connectForTest(context.action(session3), room.key);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 3,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 3,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages({
                    clientMessageCount: room.messageCount + 3,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 3,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            const pausePromise =
                messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint.pauseForTest(
                    session3.account.id,
                );

            const connection3BackfillPromise = connection3.procedures.backfillMessages({
                clientMessageCount: room.messageCount + 3,
                clientLastMessageChangeTime: null,
                newMessageLimit: 100,
            });

            const {unpause} = await pausePromise;

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            await connection2.procedures.updateMessageContent({
                messageIndex: message2.index,
                content: content2,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([
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
            expect(connection2.takeEvents()).toEqual([
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
            expect(connection3.takeEvents()).toEqual([
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

            await connection2.procedures.deleteMessage({
                messageIndex: message2.index,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection2.takeEvents()).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);
            expect(connection3.takeEvents()).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "Delete",
                        index: message2.index,
                        deletedTime: expect.any(Date),
                    },
                },
            ]);

            unpause();

            expect(await connection3BackfillPromise).toEqual({
                messageCount: room.messageCount + 3,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);
        });

        test("will send message with different permission levels for each connection", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(3);

            const room = await createRoom(sessions);

            const [session1, session2, session3] = sessions;

            const document1 = await TestDocument.create(session3, {title: "TOP SECRET 1"});
            await document1.access.grant(session3, session1);

            const document2 = await TestDocument.create(session2, {title: "TOP SECRET 2"});

            const document3 = await TestDocument.create(session2, {title: "Not secret at all"});
            await document3.access.grantDefault(session2);

            const connection1 = await connectForTest(context.action(session1), room.key);
            const connection2 = await connectForTest(context.action(session2), room.key);
            const connection3 = await connectForTest(context.action(session3), room.key);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            expect(
                await connection1.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection2.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection3.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            await connection2.procedures.createMessage({
                parentMessageIndex: null,
                content: content2,
                fileIds: [`Document:${document1.id}`],
            });

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document1.id}`,
                                    fileEntityResult: {
                                        ok: true,
                                        value: new FileEntityModel(FileDocumentEntityModelSchema, {
                                            type: "Document",
                                            versions: [-1, 1],
                                            id: document1.id,
                                            version: 1,
                                            titleWithoutFallback: "TOP SECRET 1",
                                            preview: null,
                                        }),
                                    },
                                },
                            ],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document1.id}`,
                                    fileEntityResult: {
                                        ok: false,
                                        error: new PermissionDeniedError(
                                            "Actor doesn’t have `View` access level to document",
                                        ),
                                    },
                                },
                            ],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection3.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document1.id}`,
                                    fileEntityResult: {
                                        ok: true,
                                        value: new FileEntityModel(FileDocumentEntityModelSchema, {
                                            type: "Document",
                                            versions: [-1, 1],
                                            id: document1.id,
                                            version: 1,
                                            titleWithoutFallback: "TOP SECRET 1",
                                            preview: null,
                                        }),
                                    },
                                },
                            ],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);

            await connection2.procedures.createMessage({
                parentMessageIndex: null,
                content: content3,
                fileIds: [`Document:${document2.id}`, `Document:${document3.id}`],
            });

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document2.id}`,
                                    fileEntityResult: {
                                        ok: false,
                                        error: new PermissionDeniedError(
                                            "Actor doesn’t have `View` access level to document",
                                        ),
                                    },
                                },
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document3.id}`,
                                    fileEntityResult: {
                                        ok: true,
                                        value: new FileEntityModel(FileDocumentEntityModelSchema, {
                                            type: "Document",
                                            versions: [-1, 1],
                                            id: document3.id,
                                            version: 1,
                                            titleWithoutFallback: "Not secret at all",
                                            preview: null,
                                        }),
                                    },
                                },
                            ],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection2.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document2.id}`,
                                    fileEntityResult: {
                                        ok: true,
                                        value: new FileEntityModel(FileDocumentEntityModelSchema, {
                                            type: "Document",
                                            versions: [-1, 0],
                                            id: document2.id,
                                            version: 0,
                                            titleWithoutFallback: "TOP SECRET 2",
                                            preview: null,
                                        }),
                                    },
                                },
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document3.id}`,
                                    fileEntityResult: {
                                        ok: true,
                                        value: new FileEntityModel(FileDocumentEntityModelSchema, {
                                            type: "Document",
                                            versions: [-1, 1],
                                            id: document3.id,
                                            version: 1,
                                            titleWithoutFallback: "Not secret at all",
                                            preview: null,
                                        }),
                                    },
                                },
                            ],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
            expect(connection3.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document2.id}`,
                                    fileEntityResult: {
                                        ok: false,
                                        error: new PermissionDeniedError(
                                            "Actor doesn’t have `View` access level to document",
                                        ),
                                    },
                                },
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document3.id}`,
                                    fileEntityResult: {
                                        ok: true,
                                        value: new FileEntityModel(FileDocumentEntityModelSchema, {
                                            type: "Document",
                                            versions: [-1, 1],
                                            id: document3.id,
                                            version: 1,
                                            titleWithoutFallback: "Not secret at all",
                                            preview: null,
                                        }),
                                    },
                                },
                            ],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);

            expect(
                await connection3.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 2,
                lastMessageChangeTime: null,
                newMessages: [
                    createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document1.id}`,
                                    fileEntityResult: {
                                        ok: true,
                                        value: new FileEntityModel(FileDocumentEntityModelSchema, {
                                            type: "Document",
                                            versions: [-1, 1],
                                            id: document1.id,
                                            version: 1,
                                            titleWithoutFallback: "TOP SECRET 1",
                                            preview: null,
                                        }),
                                    },
                                },
                            ],
                        },
                    }),
                    createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount + 1,
                        author: await session2.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content3WithReferences,
                            contentUpdatedTime: null,
                            files: [
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document2.id}`,
                                    fileEntityResult: {
                                        ok: false,
                                        error: new PermissionDeniedError(
                                            "Actor doesn’t have `View` access level to document",
                                        ),
                                    },
                                },
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document3.id}`,
                                    fileEntityResult: {
                                        ok: true,
                                        value: new FileEntityModel(FileDocumentEntityModelSchema, {
                                            type: "Document",
                                            versions: [-1, 1],
                                            id: document3.id,
                                            version: 1,
                                            titleWithoutFallback: "Not secret at all",
                                            preview: null,
                                        }),
                                    },
                                },
                            ],
                        },
                    }),
                ],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);
        });

        test("will update message with different permission levels for each connection", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(3);
            const room = await createRoom(sessions);
            const [session1, session2, session3] = sessions;

            const document1 = await TestDocument.create(session3, {title: "TOP SECRET 1"});
            await document1.access.grant(session3, session1);
            const document2 = await TestDocument.create(session2, {title: "TOP SECRET 2"});
            const document3 = await TestDocument.create(session2, {title: "Not secret at all"});
            await document3.access.grantDefault(session2);

            // First create a message that we'll update
            const initialMessage = await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const connection1 = await connectForTest(context.action(session1), room.key);
            const connection2 = await connectForTest(context.action(session2), room.key);
            const connection3 = await connectForTest(context.action(session3), room.key);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            // Update the message with references to documents
            const updatedContent = assertMessageContent(
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: `Document:${document1.id}`,
                            }),
                        }),
                        schema.text(" "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: `Document:${document2.id}`,
                            }),
                        }),
                        schema.text(" "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: `Document:${document3.id}`,
                            }),
                        }),
                    ]),
                ]),
            );

            await connection3.procedures.updateMessageContent({
                messageIndex: initialMessage.index,
                content: updatedContent,
            });

            await ProcessContextModule.waitForTestTasks();

            // Verify each connection received the update with appropriate permissions
            expect(connection1.takeEvents()).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "UpdateContent",
                        index: initialMessage.index,
                        content: {
                            doc: updatedContent,
                            references: {
                                accountById: new Map(),
                                fileById: undefined,
                                fileEntityById: undefined,
                                searchEntityById: new Map([
                                    [
                                        `Document:${document1.id}`,
                                        {
                                            isPrivate: false,
                                            entity: expect.any(Object),
                                        },
                                    ],
                                    [
                                        `Document:${document2.id}`,
                                        {
                                            isPrivate: true,
                                        },
                                    ],
                                    [
                                        `Document:${document3.id}`,
                                        {
                                            isPrivate: false,
                                            entity: expect.any(Object),
                                        },
                                    ],
                                ]),
                            },
                        },
                        contentUpdatedTime: expect.any(Date),
                    },
                },
            ]);

            expect(connection2.takeEvents()).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "UpdateContent",
                        index: initialMessage.index,
                        content: {
                            doc: updatedContent,
                            references: {
                                accountById: new Map(),
                                fileById: undefined,
                                fileEntityById: undefined,
                                searchEntityById: new Map([
                                    [
                                        `Document:${document1.id}`,
                                        {
                                            isPrivate: true,
                                        },
                                    ],
                                    [
                                        `Document:${document2.id}`,
                                        {
                                            isPrivate: false,
                                            entity: expect.any(Object),
                                        },
                                    ],
                                    [
                                        `Document:${document3.id}`,
                                        {
                                            isPrivate: false,
                                            entity: expect.any(Object),
                                        },
                                    ],
                                ]),
                            },
                        },
                        contentUpdatedTime: expect.any(Date),
                    },
                },
            ]);

            expect(connection3.takeEvents()).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "UpdateContent",
                        index: initialMessage.index,
                        content: {
                            doc: updatedContent,
                            references: {
                                accountById: new Map(),
                                fileById: undefined,
                                fileEntityById: undefined,
                                searchEntityById: new Map([
                                    [
                                        `Document:${document1.id}`,
                                        {
                                            isPrivate: false,
                                            entity: expect.any(Object),
                                        },
                                    ],
                                    [
                                        `Document:${document2.id}`,
                                        {
                                            isPrivate: true,
                                        },
                                    ],
                                    [
                                        `Document:${document3.id}`,
                                        {
                                            isPrivate: false,
                                            entity: expect.any(Object),
                                        },
                                    ],
                                ]),
                            },
                        },
                        contentUpdatedTime: expect.any(Date),
                    },
                },
            ]);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);
        });

        test("will send message with different permission level connection that connects and backfills during create message", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(4);

            const room = await createRoom(sessions);

            const [session1, session2, session3, session4] = sessions;

            const document = await TestDocument.create(session3, {title: "TOP SECRET"});
            await document.access.grant(session3, session1);

            const connection2 = await connectForTest(context.action(session2), room.key);
            const connection3 = await connectForTest(context.action(session3), room.key);

            expect(
                await connection2.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection3.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount,
                lastMessageChangeTime: null,
                newMessages: [],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            const pausePromise =
                messagingRealtimeCreateMessageBeforeSendTestCheckpoint.pauseForTest(
                    session3.account.id,
                );

            const createMessagePromise = connection3.procedures.createMessage({
                parentMessageIndex: null,
                content: content2,
                fileIds: [`Document:${document.id}`],
            });

            const {unpause} = await pausePromise;

            const connection1 = await connectForTest(context.action(session1), room.key);
            const connection4 = await connectForTest(context.action(session4), room.key);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);
            expect(connection4.takeEvents()).toEqual([]);

            unpause();
            await createMessagePromise;

            await ProcessContextModule.waitForTestTasks();

            expect(connection1.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session3.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document.id}`,
                                    fileEntityResult: {
                                        ok: true,
                                        value: new FileEntityModel(FileDocumentEntityModelSchema, {
                                            type: "Document",
                                            versions: [-1, 1],
                                            id: document.id,
                                            version: 1,
                                            titleWithoutFallback: "TOP SECRET",
                                            preview: null,
                                        }),
                                    },
                                },
                            ],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);

            expect(connection2.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session3.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document.id}`,
                                    fileEntityResult: {
                                        ok: false,
                                        error: new PermissionDeniedError(
                                            "Actor doesn’t have `View` access level to document",
                                        ),
                                    },
                                },
                            ],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);

            expect(connection3.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session3.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document.id}`,
                                    fileEntityResult: {
                                        ok: true,
                                        value: new FileEntityModel(FileDocumentEntityModelSchema, {
                                            type: "Document",
                                            versions: [-1, 1],
                                            id: document.id,
                                            version: 1,
                                            titleWithoutFallback: "TOP SECRET",
                                            preview: null,
                                        }),
                                    },
                                },
                            ],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);

            expect(connection4.takeEvents()).toEqual([
                {
                    type: "NewMessage",
                    message: createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session3.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content2WithReferences,
                            contentUpdatedTime: null,
                            files: [
                                {
                                    type: "FileEntity",
                                    fileEntityId: `Document:${document.id}`,
                                    fileEntityResult: {
                                        ok: false,
                                        error: new PermissionDeniedError(
                                            "Actor doesn’t have `View` access level to document",
                                        ),
                                    },
                                },
                            ],
                        },
                    }),
                    updateOtherTypingState: null,
                },
            ]);
        });

        test("will update message with different permission level connection that connects and backfills during update", async () => {
            const space = await TestSpace.create(context);
            const sessions = await space.createSessions(4);
            const room = await createRoom(sessions);
            const [session1, session2, session3, session4] = sessions;

            const document = await TestDocument.create(session3, {title: "TOP SECRET"});
            await document.access.grant(session3, session1);

            // First create a message that we'll update
            const initialMessage = await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const connection2 = await connectForTest(context.action(session2), room.key);
            const connection3 = await connectForTest(context.action(session3), room.key);

            expect(
                await connection2.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 1,
                lastMessageChangeTime: null,
                newMessages: [
                    createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session3.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                ],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(
                await connection3.procedures.backfillMessages({
                    clientMessageCount: room.messageCount,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).toEqual({
                messageCount: room.messageCount + 1,
                lastMessageChangeTime: null,
                newMessages: [
                    createMessageModel({
                        roomKey: room.key,
                        index: room.messageCount,
                        author: await session3.get(),
                        createdTime: expect.any(Date),
                        payload: {
                            type: "Content",
                            parentMessageIndex: null,
                            content: content1WithReferences,
                            contentUpdatedTime: null,
                            files: [],
                        },
                    }),
                ],
                newOtherReferencedMessages: [],
                messageChangesResult: {type: "Available", changes: []},
                typingStateByConnectionId: new Map(),
            });

            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);

            // Create content with mention to the document
            const updatedContent = assertMessageContent(
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: `Document:${document.id}`,
                            }),
                        }),
                    ]),
                ]),
            );

            // Pause before sending the update so we can connect new connections during the update
            const pausePromise =
                messagingRealtimeUpdateMessageContentBeforeSendTestCheckpoint.pauseForTest(
                    session3.account.id,
                );

            const updateMessagePromise = connection3.procedures.updateMessageContent({
                messageIndex: initialMessage.index,
                content: updatedContent,
            });

            const {unpause} = await pausePromise;

            // Connect new connections while the update is paused
            const connection1 = await connectForTest(context.action(session1), room.key);
            const connection4 = await connectForTest(context.action(session4), room.key);

            expect(connection1.takeEvents()).toEqual([]);
            expect(connection2.takeEvents()).toEqual([]);
            expect(connection3.takeEvents()).toEqual([]);
            expect(connection4.takeEvents()).toEqual([]);

            // Unpause and let the update complete
            unpause();
            await updateMessagePromise;

            await ProcessContextModule.waitForTestTasks();

            // Verify each connection received the update with appropriate permissions
            expect(connection1.takeEvents()).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "UpdateContent",
                        index: initialMessage.index,
                        content: {
                            doc: updatedContent,
                            references: {
                                accountById: new Map(),
                                fileById: undefined,
                                fileEntityById: undefined,
                                searchEntityById: new Map([
                                    [
                                        `Document:${document.id}`,
                                        {
                                            isPrivate: false,
                                            entity: expect.any(Object),
                                        },
                                    ],
                                ]),
                            },
                        },
                        contentUpdatedTime: expect.any(Date),
                    },
                },
            ]);

            expect(connection2.takeEvents()).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "UpdateContent",
                        index: initialMessage.index,
                        content: {
                            doc: updatedContent,
                            references: {
                                accountById: new Map(),
                                fileById: undefined,
                                fileEntityById: undefined,
                                searchEntityById: new Map([
                                    [
                                        `Document:${document.id}`,
                                        {
                                            isPrivate: true,
                                        },
                                    ],
                                ]),
                            },
                        },
                        contentUpdatedTime: expect.any(Date),
                    },
                },
            ]);

            expect(connection3.takeEvents()).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "UpdateContent",
                        index: initialMessage.index,
                        content: {
                            doc: updatedContent,
                            references: {
                                accountById: new Map(),
                                fileById: undefined,
                                fileEntityById: undefined,
                                searchEntityById: new Map([
                                    [
                                        `Document:${document.id}`,
                                        {
                                            isPrivate: false,
                                            entity: expect.any(Object),
                                        },
                                    ],
                                ]),
                            },
                        },
                        contentUpdatedTime: expect.any(Date),
                    },
                },
            ]);

            expect(connection4.takeEvents()).toEqual([
                {
                    type: "ChangeMessage",
                    change: {
                        type: "UpdateContent",
                        index: initialMessage.index,
                        content: {
                            doc: updatedContent,
                            references: {
                                accountById: new Map(),
                                fileById: undefined,
                                fileEntityById: undefined,
                                searchEntityById: new Map([
                                    [
                                        `Document:${document.id}`,
                                        {
                                            isPrivate: true,
                                        },
                                    ],
                                ]),
                            },
                        },
                        contentUpdatedTime: expect.any(Date),
                    },
                },
            ]);
        });
    });
}
