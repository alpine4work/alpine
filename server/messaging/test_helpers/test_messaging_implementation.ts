import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {
    ServerContentActionContext,
    ServerContentSessionActionContext,
} from "~/server/context/server_content_action_context.js";
import {
    TestContext,
    TestSessionActionContext,
} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    TestSessionItem,
    createTestSession,
} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {FileAuthorizer, attachFileAsUploader} from "~/server/files/data/files_table.js";
import {uploadTestFile} from "~/server/files/test_helpers/test_file.js";
import {getMessageChangeLogExpirationTimeFromChangeTime} from "~/server/messaging/helpers/get_message_change_log_expiration_time_from_change_time.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
    UnauthenticatedError,
} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageChange} from "~/shared/messaging/message_change_schema.js";
import {
    MessageContent,
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {
    MessageModel,
    MessagePayload,
    MessageRoomKeyType,
} from "~/shared/messaging/message_model.js";

/**
 * Create a new message in a room.
 */
type CreateMessageFunctionForTest<RoomKey extends string> = (
    context: TestSessionActionContext,
    options: {
        roomKey: RoomKey;
        parentMessageIndex: number | null;
        content: MessageContent;
        fileIds: ReadonlyArray<FileId>;
    },
) => Promise<{
    index: number;
    createdTime: Date;
}>;

/**
 * Get a message.
 */
type GetMessageFunctionForTest<Message extends MessageModel> = (
    context: ServerContentSessionActionContext,
    options: {
        roomKey: MessageRoomKeyType<Message>;
        messageIndex: number;
    },
) => Promise<Message>;

/**
 * Get only a message payload.
 */
type GetMessagePayloadFunctionForTest<Message extends MessageModel> = (
    context: ServerSessionActionContext,
    options: {
        roomKey: MessageRoomKeyType<Message>;
        messageIndex: number;
    },
) => Promise<MessagePayload>;

/**
 * Update the content of a message.
 *
 * We will record the time at which the content was updated and show that the
 * message was edited.
 */
type UpdateMessageContentFunctionForTest<RoomKey extends string> = (
    context: ServerSessionActionContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
        content: MessageContent;
    },
) => Promise<{
    contentUpdatedTime: Date;
}>;

/**
 * Delete a message.
 */
type DeleteMessageFunctionForTest<RoomKey extends string> = (
    context: ServerSessionActionContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
    },
) => Promise<{
    deletedTime: Date;
}>;

/**
 * Load a range of messages starting from the beginning of the room (or
 * starting after a message ID) and loading forwards in time.
 */
type GetMessagesFromStartForTest<Message extends MessageModel> = (
    context: ServerContentActionContext,
    options: {
        roomKey: MessageRoomKeyType<Message>;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
) => Promise<{
    messageCount: number;
    messages: Array<Message>;
    otherReferencedMessages: Array<Message>;
    lastMessageChangeTime: Date | null;
}>;

/**
 * Load a range of messages starting from the end of the room (or
 * starting before a message ID) and loading backwards in time.
 */
type GetMessagesFromEndForTest<Message extends MessageModel> = (
    context: ServerContentActionContext,
    options: {
        roomKey: MessageRoomKeyType<Message>;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
) => Promise<{
    messageCount: number;
    messages: Array<Message>;
    otherReferencedMessages: Array<Message>;
    lastMessageChangeTime: Date | null;
}>;

/**
 * Backfill messages and message changes the client is missing. Realtime could
 * be implemented by polling this method. However, this method is also
 * important for implementing push-based realtime as it fills the gap between
 * when data was loaded and when we connected to our realtime WebSocket.
 */
type BackfillMessagesFunctionForTest<Message extends MessageModel> = (
    context: ServerContentSessionActionContext,
    options: {
        roomKey: MessageRoomKeyType<Message>;
        clientMessageCount: number;
        clientLastMessageChangeTime: Date | null;
        newMessageLimit: number;
    },
) => Promise<{
    messageCount: number;
    lastMessageChangeTime: Date | null;
    newMessages: ReadonlyArray<Message>;
    newOtherReferencedMessages: ReadonlyArray<Message>;
    messageChangesResult:
        | {
              type: "Available";
              changes: ReadonlyArray<MessageChange>;
          }
        | {
              type: "Unavailable";
          };
}>;

/**
 * Wherever we want to create some space for conversation in our product we use
 * a consistent messaging UI. We also eventually want to make this messaging UI
 * embeddable in other products through an API! Whenever a user sees the
 * messaging UI they know what to do, there's no new features to learn.
 *
 * We do not have one implementation of the messaging UI backend. Instead every
 * entity that can have messages owns their own data so they can store it in an
 * optimal way. Some implementation variations we expect across products:
 *
 * - Task comments or chat rooms may have system update messages like "title
 *   changed" in between messages.
 * - Document comments may store the first few messages separately to render a
 *   preview.
 * - A document has many messaging threads. We want realtime events to go
 *   through the document durable object instead of a durable object for each
 *   messaging thread.
 * - For posts we keep track of how many messages for each individual author so
 *   we can show a preview of the thread.
 *
 * However we expect each implementation to behave the same in some ways so we
 * know the behavior of our messaging UI component will be consistent.
 *
 * This type lays out the interface our messaging UI expects so that we can
 * write tests against it. These tests help us make sure our messaging
 * implementations stay consistent as we evolve them over time.
 */
export type TestMessagingImplementation<RoomKey extends string> = {
    /**
     * Create a new room in which messages will live. A room is an abstract concept
     * that varies from implementation to implementation. Some examples of rooms:
     *
     * - In our post product a room is a post since you leave comments on a post.
     * - In our chat product a room is an actual chat room entity.
     * - In our documents product every comment thread is a room.
     *
     * All rooms must be part of a space.
     */
    createRoom: (
        context: TestSessionActionContext,
        spaceId: SpaceId,
        sessions: Array<TestSessionItem>,
    ) => Promise<RoomInterface<RoomKey>>;

    /**
     * Create a new private room in which messages will live. Same as `createRoom`
     * but only `insideSession` has access. `outsideSession` should not have access
     * to the room and an error should be thrown when they try.
     */
    createPrivateRoom: (
        context: TestSessionActionContext,
        spaceId: SpaceId,
        options: {
            insideSessions: Array<TestSessionItem>;
            insideViewerSession: TestSessionItem;
            outsideSession: TestSessionItem;
        },
    ) => Promise<
        RoomInterface<RoomKey> & {
            doesInsideViewerSessionHaveRoomAccess: boolean | "Unimplemented";
            revokeInsideSession:
                | ((context: TestSessionActionContext, session: TestSessionItem) => Promise<void>)
                | "Unimplemented";
        }
    >;

    /**
     * Gets an existing room.
     */
    getRoom: (context: TestSessionActionContext, key: RoomKey) => Promise<RoomInterface<RoomKey>>;

    /**
     * Get the key for a room that doesn't exist.
     */
    getMissingRoomKey: () => RoomKey;

    /**
     * Get a `FileAuthorizer` instance for the provided room key.
     */
    getRoomFileAuthorizer: (key: RoomKey) => FileAuthorizer;

    /**
     * Create a new message in a room.
     */
    createMessage: CreateMessageFunctionForTest<RoomKey>;

    /**
     * Get a message.
     */
    getMessage: GetMessageFunctionForTest<MessageModel<RoomKey>>;

    /**
     * Get only the payload for a message.
     */
    getMessagePayload: GetMessagePayloadFunctionForTest<MessageModel<RoomKey>>;

    /**
     * Update the content of a message.
     *
     * We will record the time at which the content was updated and show that the
     * message was edited.
     */
    updateMessageContent: UpdateMessageContentFunctionForTest<RoomKey>;

    /**
     * Delete a message.
     */
    deleteMessage: DeleteMessageFunctionForTest<RoomKey>;

    /**
     * Load a range of messages starting from the beginning of the room (or
     * starting after a message ID) and loading forwards in time.
     */
    getMessagesFromStart: GetMessagesFromStartForTest<MessageModel<RoomKey>>;

    /**
     * Load a range of messages starting from the end of the room (or
     * starting before a message ID) and loading backwards in time.
     */
    getMessagesFromEnd: GetMessagesFromEndForTest<MessageModel<RoomKey>>;

    /**
     * Backfill messages and message changes the client is missing. Realtime could
     * be implemented by polling this method. However, this method is also
     * important for implementing push-based realtime as it fills the gap between
     * when data was loaded and when we connected to our realtime WebSocket.
     */
    backfillMessages: BackfillMessagesFunctionForTest<MessageModel<RoomKey>>;

    /**
     * When the user doesn't have access to a space, it's typically caught by
     * a `authorizeSpaceAccess()` which throws a `PermissionDeniedError` with
     * a message of "Account doesn't have access to space". However, sometimes
     * a different error message maybe used when account doesn't have access to
     * a space. This property allows us to configure what error message the
     * test suite expects when the account doesn't have access to a space.
     */
    spacePermissionDeniedErrorMessage?: string;
};

/**
 * An interface that represents a room for the purposes of our tests.
 */
export type RoomInterface<RoomKey> = {
    /**
     * A unique identifier for this room.
     */
    readonly key: RoomKey;
    /**
     * The space the room is a part of.
     */
    readonly spaceId: SpaceId;
    /**
     * When was this room created?
     */
    readonly createdTime: Date;
    /**
     * The count of messages in the room. Incremented when we create a message and
     * decremented when we delete a message.
     */
    readonly messageCount: number;
};

export function testMessagingImplementation<RoomKey extends string>(
    context: TestContext,
    {
        createRoom: _createRoom,
        createPrivateRoom: _createPrivateRoom,
        getRoom,
        getMissingRoomKey,
        getRoomFileAuthorizer,
        createMessage,
        getMessage,
        getMessagePayload,
        getMessagesFromStart,
        getMessagesFromEnd,
        updateMessageContent,
        deleteMessage,
        backfillMessages,
        spacePermissionDeniedErrorMessage = "Account doesn’t have access to space",
    }: TestMessagingImplementation<RoomKey>,
) {
    const space = createTestSpace(context);
    const session1 = createTestSession(context, space);
    const session2 = createTestSession(context, space);
    const session3 = createTestSession(context, space);
    const session4 = createTestSession(context, space);
    const session5 = createTestSession(context, space);
    const otherSpace = createTestSpace(context);
    const otherSpaceSession = createTestSession(context, otherSpace);

    const content1 = createSimpleMessageContent("test1");
    const content2 = createSimpleMessageContent("test2");
    const content3 = createSimpleMessageContent("test3");
    const content4 = createSimpleMessageContent("test4");

    const createRoom = (context: TestSessionActionContext, spaceId: SpaceId) => {
        return _createRoom(context, spaceId, [session1, session2, session3]);
    };

    const createPrivateRoom = (context: TestSessionActionContext, spaceId: SpaceId) => {
        return _createPrivateRoom(context, spaceId, {
            insideSessions: [session1, session2, session3],
            insideViewerSession: session5,
            outsideSession: session4,
        });
    };

    function massageMessage(message: MessageModel | null) {
        if (!message) return null;

        switch (message.payload.type) {
            case "Content": {
                return {
                    author: message.author,
                    parentMessageIndex: message.payload.parentMessageIndex,
                    content: message.payload.content.doc,
                    hasContentUpdated: message.payload.contentUpdatedTime !== null,
                    ...(message.payload.files.length > 0
                        ? {
                              fileIds: message.payload.files.map(file =>
                                  file.type === "FileEntity" ? file.fileEntityId : file.file.id,
                              ),
                          }
                        : {}),
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

    function massageMessagePayload(payload: MessagePayload) {
        switch (payload.type) {
            case "Content": {
                return {
                    parentMessageIndex: payload.parentMessageIndex,
                    content: payload.content,
                    hasContentUpdated: payload.contentUpdatedTime !== null,
                    ...(payload.fileIds.length > 0 ? {fileIds: payload.fileIds} : {}),
                };
            }
            case "Deleted": {
                return {
                    isDeleted: true,
                };
            }
            default:
                throw exhaustive(payload);
        }
    }

    function massageMessages(result: {
        messageCount: number;
        messages: Array<MessageModel>;
        otherReferencedMessages: Array<MessageModel>;
    }) {
        return {
            messageCount: result.messageCount,
            messages: result.messages.map(massageMessage),
            ...(result.otherReferencedMessages.length > 0
                ? {otherReferencedMessages: result.otherReferencedMessages.map(massageMessage)}
                : {}),
        };
    }

    function massageMessageChange(message: MessageChange) {
        if (!message) return null;

        switch (message.type) {
            case "UpdateContent": {
                return {
                    type: "UpdateContent",
                    index: message.index,
                    content: message.content.doc,
                };
            }
            case "Delete": {
                return {
                    type: "Delete",
                    index: message.index,
                };
            }
            default:
                throw exhaustive(message);
        }
    }

    function massageMessageBackfill(result: {
        messageCount: number;
        lastMessageChangeTime: Date | null;
        newMessages: ReadonlyArray<MessageModel<RoomKey>>;
        newOtherReferencedMessages: ReadonlyArray<MessageModel<RoomKey>>;
        messageChangesResult:
            | {
                  type: "Available";
                  changes: ReadonlyArray<MessageChange>;
              }
            | {
                  type: "Unavailable";
              };
    }) {
        return {
            messageCount: result.messageCount,
            lastMessageChangeTime: result.lastMessageChangeTime,
            newMessages: result.newMessages.map(massageMessage),
            ...(result.newOtherReferencedMessages.length > 0
                ? {
                      newOtherReferencedMessages:
                          result.newOtherReferencedMessages.map(massageMessage),
                  }
                : {}),
            messageChangesResult:
                result.messageChangesResult.type === "Available"
                    ? {
                          type: "Available",
                          changes: result.messageChangesResult.changes.map(massageMessageChange),
                      }
                    : {type: "Unavailable"},
        };
    }

    async function expectGetMessage(
        context: ServerContentSessionActionContext,
        {roomKey, messageIndex}: {roomKey: RoomKey; messageIndex: number},
        expected: any,
    ) {
        expect(
            massageMessage(
                await getMessage(context, {
                    roomKey,
                    messageIndex,
                }),
            ),
        ).toEqual(expected);

        expect(
            massageMessagePayload(
                await getMessagePayload(context, {
                    roomKey,
                    messageIndex,
                }),
            ),
        ).toEqual(omitObject(expected, ["author"]));
    }

    async function expectGetMessageAndGetMessagePayloadNotToBeNull(
        context: ServerContentSessionActionContext,
        {roomKey, messageIndex}: {roomKey: RoomKey; messageIndex: number},
    ) {
        expect(
            massageMessage(
                await getMessage(context, {
                    roomKey,
                    messageIndex,
                }),
            ),
        ).not.toBeNull();

        expect(
            massageMessagePayload(
                await getMessagePayload(context, {
                    roomKey,
                    messageIndex,
                }),
            ),
        ).not.toBeNull();
    }

    async function expectGetMessageAndGetMessagePayloadToThrow(
        context: ServerContentSessionActionContext,
        {roomKey, messageIndex}: {roomKey: RoomKey; messageIndex: number},
        expected: any,
    ) {
        await expect(() =>
            getMessage(context, {
                roomKey,
                messageIndex,
            }),
        ).rejects.toThrow(expected);

        await expect(() =>
            getMessagePayload(context, {
                roomKey,
                messageIndex,
            }),
        ).rejects.toThrow(expected);
    }

    describe("Messaging implementation", () => {
        test("can create room", async () => {
            const room = await createRoom(context.action(session1), space.id);

            expect(room.messageCount).toEqual(0);
        });

        test("can’t create room in a space you don’t have access to", async () => {
            await expect(createRoom(context.action(session1), otherSpace.id)).rejects.toThrow(
                PermissionDeniedError,
            );
        });

        test("can get room", async () => {
            const room1 = await createRoom(context.action(session1), space.id);

            const room2 = await getRoom(context.action(session1), room1.key);

            expect(room2?.messageCount).toEqual(0);
        });

        test("can’t get room in a space you don’t have access to", async () => {
            const room1 = await createRoom(context.action(session1), space.id);

            await expect(getRoom(context.action(otherSpaceSession), room1.key)).rejects.toThrow(
                PermissionDeniedError,
            );
        });

        test("can’t get private room when you don’t have access", async () => {
            const room1 = await createPrivateRoom(context.action(session1), space.id);

            expect((await getRoom(context.action(session1), room1.key))?.messageCount).toEqual(0);
            expect((await getRoom(context.action(session2), room1.key))?.messageCount).toEqual(0);
            expect((await getRoom(context.action(session3), room1.key))?.messageCount).toEqual(0);

            await expect(getRoom(context.action(session4), room1.key)).rejects.toThrow(
                PermissionDeniedError,
            );

            if (room1.doesInsideViewerSessionHaveRoomAccess !== "Unimplemented") {
                if (room1.doesInsideViewerSessionHaveRoomAccess) {
                    expect(
                        (await getRoom(context.action(session5), room1.key))?.messageCount,
                    ).toEqual(0);
                } else {
                    await expect(getRoom(context.action(session5), room1.key)).rejects.toThrow(
                        PermissionDeniedError,
                    );
                }
            }
        });

        test("can create message", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            expect(message.index).toEqual(0);

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("can create multiple messages", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            expect(message1.index).toEqual(0);

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message1.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            expect(message2.index).toEqual(1);

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message2.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content2,
                    hasContentUpdated: false,
                },
            );

            const message3 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            expect(message3.index).toEqual(2);

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message3.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content3,
                    hasContentUpdated: false,
                },
            );
        });

        test("can create message from a different account", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("can’t create message in a room that doesn’t exist", async () => {
            await expect(
                createMessage(context.action(session1), {
                    roomKey: getMissingRoomKey(),
                    parentMessageIndex: null,
                    content: content1,
                    fileIds: [],
                }),
            ).rejects.toThrow(/not found/);
        });

        test("can’t create message in a different space", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                createMessage(context.action(otherSpaceSession), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content1,
                    fileIds: [],
                }),
            ).rejects.toThrow(new PermissionDeniedError(spacePermissionDeniedErrorMessage));
        });

        test("can’t create message in private room from an account without access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);

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

            await expect(
                createMessage(context.action(session4), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content4,
                    fileIds: [],
                }),
            ).rejects.toThrow(PermissionDeniedError);

            if (room.doesInsideViewerSessionHaveRoomAccess !== "Unimplemented") {
                await expect(
                    createMessage(context.action(session5), {
                        roomKey: room.key,
                        parentMessageIndex: null,
                        content: content4,
                        fileIds: [],
                    }),
                ).rejects.toThrow(PermissionDeniedError);
            }
        });

        test("can’t create message with invalid content", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const schema = MessageContentProsemirrorSchema;
            const content = assertMessageContent(
                schema.nodes.doc.create({}, [
                    schema.nodes.unorderedListItem.create({}, [schema.text("Hello, world!")]),
                ]),
            );

            await expect(
                createMessage(context.action(session2), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content,
                    fileIds: [],
                }),
            ).rejects.toThrow(InvalidArgumentError);
        });

        test("can create message with attached file", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const {fileId} = await uploadTestFile(context.action(session1), space.id);

            await attachFileAsUploader(
                context.action(session1),
                space.id,
                fileId,
                getRoomFileAuthorizer(room.key),
            );

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [fileId],
            });

            expect(message.index).toEqual(0);

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                    fileIds: [fileId],
                },
            );
        });

        test("can create message with multiple attached files", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const [{fileId: file1Id}, {fileId: file2Id}, {fileId: file3Id}] = await runAllPromises([
                uploadTestFile(context.action(session1), space.id),
                uploadTestFile(context.action(session1), space.id),
                uploadTestFile(context.action(session1), space.id),
            ]);

            await runAllPromises([
                attachFileAsUploader(
                    context.action(session1),
                    space.id,
                    file1Id,
                    getRoomFileAuthorizer(room.key),
                ),
                attachFileAsUploader(
                    context.action(session1),
                    space.id,
                    file2Id,
                    getRoomFileAuthorizer(room.key),
                ),
                attachFileAsUploader(
                    context.action(session1),
                    space.id,
                    file3Id,
                    getRoomFileAuthorizer(room.key),
                ),
            ]);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [file1Id, file2Id, file3Id],
            });

            expect(message.index).toEqual(0);

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                    fileIds: [file1Id, file2Id, file3Id],
                },
            );
        });

        test("can’t create message with file if file isn’t attached", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const {fileId} = await uploadTestFile(context.action(session1), space.id);

            await expect(
                createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content1,
                    fileIds: [fileId],
                }),
            ).rejects.toThrow(new PermissionDeniedError("File isn’t attached to target"));

            await expectGetMessageAndGetMessagePayloadToThrow(
                context.action(session1),
                {roomKey: room.key, messageIndex: 0},
                NotFoundError,
            );
        });

        test("can’t create message with file that doesn’t exist", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content1,
                    fileIds: [generateChronologicalId()],
                }),
            ).rejects.toThrow(new PermissionDeniedError("File not found"));

            await expectGetMessageAndGetMessagePayloadToThrow(
                context.action(session1),
                {roomKey: room.key, messageIndex: 0},
                NotFoundError,
            );
        });

        test("can’t create message with file attached to another room", async () => {
            const room1 = await createRoom(context.action(session1), space.id);
            const room2 = await createRoom(context.action(session1), space.id);

            const {fileId} = await uploadTestFile(context.action(session1), space.id);

            await attachFileAsUploader(
                context.action(session1),
                space.id,
                fileId,
                getRoomFileAuthorizer(room2.key),
            );

            await expect(
                createMessage(context.action(session1), {
                    roomKey: room1.key,
                    parentMessageIndex: null,
                    content: content1,
                    fileIds: [fileId],
                }),
            ).rejects.toThrow(new PermissionDeniedError("File isn’t attached to target"));

            await expectGetMessageAndGetMessagePayloadToThrow(
                context.action(session1),
                {roomKey: room1.key, messageIndex: 0},
                NotFoundError,
            );
        });

        test("can’t create message with file from a different space", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const {fileId} = await uploadTestFile(context.action(otherSpaceSession), otherSpace.id);

            await expect(
                createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content1,
                    fileIds: [fileId],
                }),
            ).rejects.toThrow(new PermissionDeniedError("File not found"));

            await expectGetMessageAndGetMessagePayloadToThrow(
                context.action(session1),
                {roomKey: room.key, messageIndex: 0},
                NotFoundError,
            );
        });

        test("can’t get a message which doesn’t exist", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessageAndGetMessagePayloadToThrow(
                context.action(session1),
                {roomKey: room.key, messageIndex: 42},
                NotFoundError,
            );
        });

        test("can’t get a message in a different space", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessageAndGetMessagePayloadToThrow(
                context.action(otherSpaceSession),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                PermissionDeniedError,
            );
        });

        test("can’t get a message in a private room when account doesn’t have access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessageAndGetMessagePayloadNotToBeNull(context.action(session1), {
                roomKey: room.key,
                messageIndex: message.index,
            });

            await expectGetMessageAndGetMessagePayloadNotToBeNull(context.action(session2), {
                roomKey: room.key,
                messageIndex: message.index,
            });

            await expectGetMessageAndGetMessagePayloadNotToBeNull(context.action(session3), {
                roomKey: room.key,
                messageIndex: message.index,
            });

            await expectGetMessageAndGetMessagePayloadToThrow(
                context.action(session4),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                PermissionDeniedError,
            );

            if (room.doesInsideViewerSessionHaveRoomAccess !== "Unimplemented") {
                if (room.doesInsideViewerSessionHaveRoomAccess) {
                    await expectGetMessageAndGetMessagePayloadNotToBeNull(
                        context.action(session5),
                        {
                            roomKey: room.key,
                            messageIndex: message.index,
                        },
                    );
                } else {
                    await expectGetMessageAndGetMessagePayloadToThrow(
                        context.action(session5),
                        {
                            roomKey: room.key,
                            messageIndex: message.index,
                        },
                        PermissionDeniedError,
                    );
                }
            }
        });

        test("can create a message with a parent", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: message1.index,
                content: content2,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: message2.index,
                content: content3,
                fileIds: [],
            });

            const message4 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: message2.index,
                content: content4,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message1.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message2.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: message1.index,
                    content: content2,
                    hasContentUpdated: false,
                },
            );

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message3.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: message2.index,
                    content: content3,
                    hasContentUpdated: false,
                },
            );

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message4.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: message2.index,
                    content: content4,
                    hasContentUpdated: false,
                },
            );
        });

        test("can’t create message with a parent that doesn’t exist", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: 42,
                    content: content1,
                    fileIds: [],
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("room keeps track of message count", async () => {
            const room = await createRoom(context.action(session1), space.id);

            expect((await getRoom(context.action(session1), room.key))?.messageCount).toEqual(0);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            expect((await getRoom(context.action(session1), room.key))?.messageCount).toEqual(1);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            expect((await getRoom(context.action(session1), room.key))?.messageCount).toEqual(2);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            expect((await getRoom(context.action(session1), room.key))?.messageCount).toEqual(3);

            await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message.index,
            });

            expect((await getRoom(context.action(session1), room.key))?.messageCount).toEqual(3);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect((await getRoom(context.action(session1), room.key))?.messageCount).toEqual(4);
        });

        test("can update message with different content", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message.index,
                content: content2,
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content2,
                    hasContentUpdated: true,
                },
            );
        });

        test("can’t update message on room that doesn’t exist", async () => {
            await expect(
                updateMessageContent(context.action(session2), {
                    roomKey: getMissingRoomKey(),
                    messageIndex: 42,
                    content: content2,
                }),
            ).rejects.toThrow(/not found/);
        });

        test("can’t update message that doesn’t exist", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                updateMessageContent(context.action(session2), {
                    roomKey: room.key,
                    messageIndex: 42,
                    content: content2,
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("can’t update message from different author", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await expect(
                updateMessageContent(context.action(session2), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    content: content2,
                }),
            ).rejects.toThrow(PermissionDeniedError);

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("can’t update message from different space", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await expect(
                updateMessageContent(context.action(otherSpaceSession), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    content: content2,
                }),
            ).rejects.toThrow(new PermissionDeniedError(spacePermissionDeniedErrorMessage));

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("can update message in private room from account with access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session2.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await updateMessageContent(context.action(session2), {
                roomKey: room.key,
                messageIndex: message.index,
                content: content2,
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session2.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content2,
                    hasContentUpdated: true,
                },
            );
        });

        test("can’t update message in private room from account which loses access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);
            if (room.revokeInsideSession === "Unimplemented") return;

            const message = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session2.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await updateMessageContent(context.action(session2), {
                roomKey: room.key,
                messageIndex: message.index,
                content: content2,
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session2.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content2,
                    hasContentUpdated: true,
                },
            );

            await room.revokeInsideSession(context.action(session1), session2);

            await expect(
                updateMessageContent(context.action(session2), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    content: content3,
                }),
            ).rejects.toThrow(PermissionDeniedError);

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session2.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content2,
                    hasContentUpdated: true,
                },
            );
        });

        test("can’t update message in private room from account without access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await expect(
                updateMessageContent(context.action(session4), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    content: content2,
                }),
            ).rejects.toThrow(PermissionDeniedError);

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            if (room.doesInsideViewerSessionHaveRoomAccess !== "Unimplemented") {
                await expect(
                    updateMessageContent(context.action(session5), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        content: content2,
                    }),
                ).rejects.toThrow(PermissionDeniedError);

                await expectGetMessage(
                    context.action(session1),
                    {
                        roomKey: room.key,
                        messageIndex: message.index,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                );
            }
        });

        test("can’t update message with invalid content", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const schema = MessageContentProsemirrorSchema;
            const invalidContent = assertMessageContent(
                schema.nodes.doc.create({}, [
                    schema.nodes.unorderedListItem.create({}, [schema.text("Hello, world!")]),
                ]),
            );

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await expect(
                updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    content: invalidContent,
                }),
            ).rejects.toThrow(InvalidArgumentError);

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("can delete message", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message.index,
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    isDeleted: true,
                },
            );
        });

        test("can’t delete message on room that doesn’t exist", async () => {
            await expect(
                deleteMessage(context.action(session2), {
                    roomKey: getMissingRoomKey(),
                    messageIndex: 42,
                }),
            ).rejects.toThrow(/not found/);
        });

        test("can’t delete message that doesn’t exist", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                deleteMessage(context.action(session2), {
                    roomKey: room.key,
                    messageIndex: 42,
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("can’t delete message from different author", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await expect(
                deleteMessage(context.action(session2), {
                    roomKey: room.key,
                    messageIndex: message.index,
                }),
            ).rejects.toThrow(PermissionDeniedError);

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("can’t delete message from different space", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await expect(
                deleteMessage(context.action(otherSpaceSession), {
                    roomKey: room.key,
                    messageIndex: message.index,
                }),
            ).rejects.toThrow(new PermissionDeniedError(spacePermissionDeniedErrorMessage));

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("can delete message in private room from account with access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session2.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await deleteMessage(context.action(session2), {
                roomKey: room.key,
                messageIndex: message.index,
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session2.accountId,
                    ),
                    isDeleted: true,
                },
            );
        });

        test("can’t delete message in private room from account after revoking access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);
            if (room.revokeInsideSession === "Unimplemented") return;

            const message = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session2.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await room.revokeInsideSession(context.action(session1), session2);

            await expect(
                deleteMessage(context.action(session2), {
                    roomKey: room.key,
                    messageIndex: message.index,
                }),
            ).rejects.toThrow(PermissionDeniedError);

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session2.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("can’t delete message in private room from account without access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await expect(
                deleteMessage(context.action(session4), {
                    roomKey: room.key,
                    messageIndex: message.index,
                }),
            ).rejects.toThrow(PermissionDeniedError);

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            if (room.doesInsideViewerSessionHaveRoomAccess !== "Unimplemented") {
                await expect(
                    deleteMessage(context.action(session5), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }),
                ).rejects.toThrow(PermissionDeniedError);

                await expectGetMessage(
                    context.action(session1),
                    {
                        roomKey: room.key,
                        messageIndex: message.index,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                );
            }
        });

        test("can’t delete a message twice", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message.index,
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    isDeleted: true,
                },
            );

            await expect(
                deleteMessage(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message.index,
                }),
            ).rejects.toThrow(FailedPreconditionError);
        });

        test("can’t update a deleted message", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    parentMessageIndex: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message.index,
            });

            await expectGetMessage(
                context.action(session1),
                {
                    roomKey: room.key,
                    messageIndex: message.index,
                },
                {
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    isDeleted: true,
                },
            );

            await expect(
                updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    content: content2,
                }),
            ).rejects.toThrow(FailedPreconditionError);
        });

        test("can get messages from start", async () => {
            const room = await createRoom(context.action(session1), space.id);

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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can’t get messages from start when before cursor is greater than after cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await expect(
                getMessagesFromStart(context.action(session1), {
                    roomKey: room.key,
                    limit: 100,
                    afterMessageIndex: 10,
                    beforeMessageIndex: 5,
                }),
            ).rejects.toThrow(InternalError);
        });

        test("can get empty messages", async () => {
            const room = await createRoom(context.action(session1), space.id);

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 0,
                messages: [],
            });
        });

        test("can see new messages as they are added when loading from start", async () => {
            const room = await createRoom(context.action(session1), space.id);

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 0,
                messages: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 1,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 2,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can’t get messages for room that doesn’t exist", async () => {
            await expect(
                getMessagesFromStart(context.action(session1), {
                    roomKey: getMissingRoomKey(),
                    limit: 100,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow(/not found/);
        });

        test("can’t get messages for room in a different space", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                getMessagesFromStart(context.action(otherSpaceSession), {
                    roomKey: room.key,
                    limit: 100,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow(new PermissionDeniedError(spacePermissionDeniedErrorMessage));
        });

        test("can’t get messages for anonymous actor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                getMessagesFromStart(context.anonymousAction(), {
                    roomKey: room.key,
                    limit: 100,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow(new UnauthenticatedError("Unauthenticated session"));
        });

        test("can’t get messages for private room from account who doesn’t have access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 0,
                messages: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session2), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 0,
                messages: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session3), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 0,
                messages: [],
            });

            await expect(
                getMessagesFromStart(context.action(session4), {
                    roomKey: room.key,
                    limit: 100,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow(PermissionDeniedError);

            if (room.doesInsideViewerSessionHaveRoomAccess !== "Unimplemented") {
                if (room.doesInsideViewerSessionHaveRoomAccess) {
                    expect(
                        massageMessages(
                            await getMessagesFromStart(context.action(session5), {
                                roomKey: room.key,
                                limit: 100,
                                afterMessageIndex: null,
                                beforeMessageIndex: null,
                            }),
                        ),
                    ).toEqual({
                        messageCount: 0,
                        messages: [],
                    });
                } else {
                    await expect(
                        getMessagesFromStart(context.action(session5), {
                            roomKey: room.key,
                            limit: 100,
                            afterMessageIndex: null,
                            beforeMessageIndex: null,
                        }),
                    ).rejects.toThrow(PermissionDeniedError);
                }
            }
        });

        test("can get messages from start with limit", async () => {
            const room = await createRoom(context.action(session1), space.id);

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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 5,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 7,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 8,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can get messages from start with after cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            const message8 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: message2.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: message5.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: message8.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [],
            });
        });

        test("can get messages from start with before cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            const message8 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: message2.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: message5.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: message8.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can get messages from start with limit and after cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            const message8 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: message2.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 2,
                        afterMessageIndex: message5.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: message5.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 4,
                        afterMessageIndex: message8.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({messageCount: 8, messages: []});
        });

        test("can get messages from start with limit and before cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: message5.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 5,
                        afterMessageIndex: null,
                        beforeMessageIndex: message5.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can get messages from start with limit, before cursor, and after cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            const message7 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: message2.index,
                        beforeMessageIndex: message7.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 4,
                        afterMessageIndex: message2.index,
                        beforeMessageIndex: message7.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 5,
                        afterMessageIndex: message2.index,
                        beforeMessageIndex: message7.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can get messages from end", async () => {
            const room = await createRoom(context.action(session1), space.id);

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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can’t get messages from end when before cursor is greater than after cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await expect(
                getMessagesFromEnd(context.action(session1), {
                    roomKey: room.key,
                    limit: 100,
                    afterMessageIndex: 10,
                    beforeMessageIndex: 5,
                }),
            ).rejects.toThrow(InternalError);
        });

        test("can get empty messages from end", async () => {
            const room = await createRoom(context.action(session1), space.id);

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 0,
                messages: [],
            });
        });

        test("can see new messages as they are added when loading from end", async () => {
            const room = await createRoom(context.action(session1), space.id);

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 0,
                messages: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 1,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 2,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can’t get messages from end for room that doesn’t exist", async () => {
            await expect(
                getMessagesFromEnd(context.action(session1), {
                    roomKey: getMissingRoomKey(),
                    limit: 100,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow(/not found/);
        });

        test("can’t get messages from end for room in a different space", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                getMessagesFromEnd(context.action(otherSpaceSession), {
                    roomKey: room.key,
                    limit: 100,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow(new PermissionDeniedError(spacePermissionDeniedErrorMessage));
        });

        test("can’t get messages from end for anonymous actor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                getMessagesFromEnd(context.anonymousAction(), {
                    roomKey: room.key,
                    limit: 100,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow(new UnauthenticatedError("Unauthenticated session"));
        });

        test("can’t get messages from end for private room account doesn’t have access to", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 0,
                messages: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session2), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 0,
                messages: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session3), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 0,
                messages: [],
            });

            await expect(
                getMessagesFromEnd(context.action(session4), {
                    roomKey: room.key,
                    limit: 100,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow(PermissionDeniedError);

            if (room.doesInsideViewerSessionHaveRoomAccess !== "Unimplemented") {
                if (room.doesInsideViewerSessionHaveRoomAccess) {
                    expect(
                        massageMessages(
                            await getMessagesFromEnd(context.action(session5), {
                                roomKey: room.key,
                                limit: 100,
                                afterMessageIndex: null,
                                beforeMessageIndex: null,
                            }),
                        ),
                    ).toEqual({
                        messageCount: 0,
                        messages: [],
                    });
                } else {
                    await expect(
                        getMessagesFromEnd(context.action(session5), {
                            roomKey: room.key,
                            limit: 100,
                            afterMessageIndex: null,
                            beforeMessageIndex: null,
                        }),
                    ).rejects.toThrow(PermissionDeniedError);
                }
            }
        });

        test("can get messages from end with limit", async () => {
            const room = await createRoom(context.action(session1), space.id);

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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 5,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 7,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 8,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can get messages from end with before cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            const message8 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: message2.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: message5.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: message8.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can get messages from end with after cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            const message8 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: message2.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: message5.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: message8.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({messageCount: 8, messages: []});
        });

        test("can get messages from end with limit and before cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
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

            const message4 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message6 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: message6.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 2,
                        afterMessageIndex: null,
                        beforeMessageIndex: message4.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: message4.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 4,
                        afterMessageIndex: null,
                        beforeMessageIndex: message1.index,
                    }),
                ),
            ).toEqual({messageCount: 8, messages: []});
        });

        test("can get messages from end with limit and after cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 2,
                        afterMessageIndex: message5.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 4,
                        afterMessageIndex: message5.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can get messages from end with limit, before cursor, and after cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            const message7 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: message2.index,
                        beforeMessageIndex: message7.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 4,
                        afterMessageIndex: message2.index,
                        beforeMessageIndex: message7.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 5,
                        afterMessageIndex: message2.index,
                        beforeMessageIndex: message7.index,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can get messages from start in a room with deleted and update messages", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
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

            const message4 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await deleteMessage(context.action(session2), {
                roomKey: room.key,
                messageIndex: message2.index,
            });

            await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message4.index,
            });

            await updateMessageContent(context.action(session2), {
                roomKey: room.key,
                messageIndex: message5.index,
                content: content2,
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        isDeleted: true,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        isDeleted: true,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: true,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can get messages from end in a room with deleted and update messages", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
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

            const message4 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await deleteMessage(context.action(session2), {
                roomKey: room.key,
                messageIndex: message2.index,
            });

            await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message4.index,
            });

            await updateMessageContent(context.action(session2), {
                roomKey: room.key,
                messageIndex: message5.index,
                content: content2,
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        isDeleted: true,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        isDeleted: true,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: true,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("if time hasn’t moved forward updating a message will set it to +1ms of the room creation time", async () => {
            const originalDateNow = Date.now;

            try {
                const room = await createRoom(context.action(session1), space.id);

                const message = await createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content1,
                    fileIds: [],
                });

                Date.now = () => room.createdTime.getTime() - 1000 * 60;

                await updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    content: content2,
                });

                {
                    const updatedMessage = await getMessage(context.action(session1), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    });
                    assert(updatedMessage?.payload.type === "Content");
                    expect(updatedMessage.payload.contentUpdatedTime).toEqual(
                        new Date(room.createdTime.getTime() + 1),
                    );
                }
            } finally {
                Date.now = originalDateNow;
            }
        });

        test("if time hasn’t moved forward deleting a message will set it to +1ms of the room creation time", async () => {
            const originalDateNow = Date.now;

            try {
                const room = await createRoom(context.action(session1), space.id);

                const message = await createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content1,
                    fileIds: [],
                });

                Date.now = () => room.createdTime.getTime() - 1000 * 60;

                await deleteMessage(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message.index,
                });

                {
                    const updatedMessage = await getMessage(context.action(session1), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    });
                    assert(updatedMessage?.payload.type === "Deleted");
                    expect(updatedMessage.payload.deletedTime).toEqual(
                        new Date(room.createdTime.getTime() + 1),
                    );
                }
            } finally {
                Date.now = originalDateNow;
            }
        });

        test("if time hasn’t moved forward updating a message will set it to +1ms of the last update time", async () => {
            const originalDateNow = Date.now;

            try {
                const room = await createRoom(context.action(session1), space.id);

                const message = await createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content1,
                    fileIds: [],
                });

                Date.now = () => room.createdTime.getTime() - 1000 * 60;

                await updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    content: content2,
                });

                {
                    const updatedMessage = await getMessage(context.action(session1), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    });
                    assert(updatedMessage?.payload.type === "Content");
                    expect(updatedMessage.payload.contentUpdatedTime).toEqual(
                        new Date(room.createdTime.getTime() + 1),
                    );
                }

                await updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    content: content3,
                });

                {
                    const updatedMessage = await getMessage(context.action(session1), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    });
                    assert(updatedMessage?.payload.type === "Content");
                    expect(updatedMessage.payload.contentUpdatedTime).toEqual(
                        new Date(room.createdTime.getTime() + 2),
                    );
                }
                Date.now = () => room.createdTime.getTime() - 1000 * 60;

                await updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    content: content3,
                });

                {
                    const updatedMessage = await getMessage(context.action(session1), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    });
                    assert(updatedMessage?.payload.type === "Content");
                    expect(updatedMessage.payload.contentUpdatedTime).toEqual(
                        new Date(room.createdTime.getTime() + 3),
                    );
                }
            } finally {
                Date.now = originalDateNow;
            }
        });

        test("if time hasn’t moved forward deleting a message will set it to +1ms of the last update time", async () => {
            const originalDateNow = Date.now;

            try {
                const room = await createRoom(context.action(session1), space.id);

                Date.now = () => room.createdTime.getTime() - 1000 * 60;

                const message = await createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content1,
                    fileIds: [],
                });

                await updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    content: content2,
                });

                {
                    const updatedMessage = await getMessage(context.action(session1), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    });
                    assert(updatedMessage?.payload.type === "Content");
                    expect(updatedMessage.payload.contentUpdatedTime).toEqual(
                        new Date(room.createdTime.getTime() + 1),
                    );
                }

                await deleteMessage(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message.index,
                });

                {
                    const updatedMessage = await getMessage(context.action(session1), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    });
                    assert(updatedMessage?.payload.type === "Deleted");
                    expect(updatedMessage.payload.deletedTime).toEqual(
                        new Date(room.createdTime.getTime() + 2),
                    );
                }
            } finally {
                Date.now = originalDateNow;
            }
        });

        test("if time hasn’t moved forward updating a message will set it to +1ms of the last update time for a different message", async () => {
            const originalDateNow = Date.now;

            try {
                const room = await createRoom(context.action(session1), space.id);

                Date.now = () => room.createdTime.getTime() - 1000 * 60;

                const message1 = await createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content1,
                    fileIds: [],
                });

                const message2 = await createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content2,
                    fileIds: [],
                });

                const message3 = await createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content3,
                    fileIds: [],
                });

                await updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message1.index,
                    content: content4,
                });

                {
                    const updatedMessage = await getMessage(context.action(session1), {
                        roomKey: room.key,
                        messageIndex: message1.index,
                    });
                    assert(updatedMessage?.payload.type === "Content");
                    expect(updatedMessage.payload.contentUpdatedTime).toEqual(
                        new Date(room.createdTime.getTime() + 1),
                    );
                }

                await updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message2.index,
                    content: content4,
                });

                {
                    const updatedMessage = await getMessage(context.action(session1), {
                        roomKey: room.key,
                        messageIndex: message2.index,
                    });
                    assert(updatedMessage?.payload.type === "Content");
                    expect(updatedMessage.payload.contentUpdatedTime).toEqual(
                        new Date(room.createdTime.getTime() + 2),
                    );
                }

                Date.now = () => room.createdTime.getTime() - 1000 * 60;

                await updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message3.index,
                    content: content4,
                });

                {
                    const updatedMessage = await getMessage(context.action(session1), {
                        roomKey: room.key,
                        messageIndex: message3.index,
                    });
                    assert(updatedMessage?.payload.type === "Content");
                    expect(updatedMessage.payload.contentUpdatedTime).toEqual(
                        new Date(room.createdTime.getTime() + 3),
                    );
                }
            } finally {
                Date.now = originalDateNow;
            }
        });

        test("if time hasn’t moved forward deleting a message will set it to +1ms of the last update time for a different message", async () => {
            const originalDateNow = Date.now;

            try {
                const room = await createRoom(context.action(session1), space.id);

                Date.now = () => room.createdTime.getTime() - 1000 * 60;

                const message1 = await createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content1,
                    fileIds: [],
                });

                const message2 = await createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content2,
                    fileIds: [],
                });

                const message3 = await createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content3,
                    fileIds: [],
                });

                await updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message1.index,
                    content: content4,
                });

                {
                    const updatedMessage = await getMessage(context.action(session1), {
                        roomKey: room.key,
                        messageIndex: message1.index,
                    });
                    assert(updatedMessage?.payload.type === "Content");
                    expect(updatedMessage.payload.contentUpdatedTime).toEqual(
                        new Date(room.createdTime.getTime() + 1),
                    );
                }

                await deleteMessage(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message2.index,
                });

                {
                    const updatedMessage = await getMessage(context.action(session1), {
                        roomKey: room.key,
                        messageIndex: message2.index,
                    });
                    assert(updatedMessage?.payload.type === "Deleted");
                    expect(updatedMessage.payload.deletedTime).toEqual(
                        new Date(room.createdTime.getTime() + 2),
                    );
                }

                Date.now = () => room.createdTime.getTime() - 1000 * 60;

                await deleteMessage(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message3.index,
                });

                {
                    const updatedMessage = await getMessage(context.action(session1), {
                        roomKey: room.key,
                        messageIndex: message3.index,
                    });
                    assert(updatedMessage?.payload.type === "Deleted");
                    expect(updatedMessage.payload.deletedTime).toEqual(
                        new Date(room.createdTime.getTime() + 3),
                    );
                }
            } finally {
                Date.now = originalDateNow;
            }
        });

        test("if time hasn’t moved forward updating a message will set it to +1ms of the last delete time for a different message", async () => {
            const originalDateNow = Date.now;

            try {
                const room = await createRoom(context.action(session1), space.id);

                Date.now = () => room.createdTime.getTime() - 1000 * 60;

                await createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content1,
                    fileIds: [],
                });

                const message2 = await createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content2,
                    fileIds: [],
                });

                const message3 = await createMessage(context.action(session1), {
                    roomKey: room.key,
                    parentMessageIndex: null,
                    content: content3,
                    fileIds: [],
                });

                await deleteMessage(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message2.index,
                });

                {
                    const updatedMessage = await getMessage(context.action(session1), {
                        roomKey: room.key,
                        messageIndex: message2.index,
                    });
                    assert(updatedMessage?.payload.type === "Deleted");
                    expect(updatedMessage.payload.deletedTime).toEqual(
                        new Date(room.createdTime.getTime() + 1),
                    );
                }

                await updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message3.index,
                    content: content4,
                });

                {
                    const updatedMessage = await getMessage(context.action(session1), {
                        roomKey: room.key,
                        messageIndex: message3.index,
                    });
                    assert(updatedMessage?.payload.type === "Content");
                    expect(updatedMessage.payload.contentUpdatedTime).toEqual(
                        new Date(room.createdTime.getTime() + 2),
                    );
                }
            } finally {
                Date.now = originalDateNow;
            }
        });

        test("will get messages referenced outside the queried range when loading from start", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: message3.index,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: message3.index,
                content: content1,
                fileIds: [],
            });

            const message6 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: message6.index,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: message2.index,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: message6.index,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: message2.index,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: message3.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: message6.index,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: message2.index,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                otherReferencedMessages: [
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: message3.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
                otherReferencedMessages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("will get messages referenced outside the queried range when loading from end", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: message3.index,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: message3.index,
                content: content1,
                fileIds: [],
            });

            const message6 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            const message7 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: message6.index,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: message2.index,
                content: content4,
                fileIds: [],
            });

            const message9 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 9,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: message6.index,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: message2.index,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 5,
                        afterMessageIndex: null,
                        beforeMessageIndex: message9.index,
                    }),
                ),
            ).toEqual({
                messageCount: 9,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: message6.index,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: message2.index,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                otherReferencedMessages: [
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: message7.index,
                    }),
                ),
            ).toEqual({
                messageCount: 9,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
                otherReferencedMessages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageIndex: null,
                        beforeMessageIndex: message7.index,
                    }),
                ),
            ).toEqual({
                messageCount: 9,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("get from start returns the last time any message was updated even if it is not visible", async () => {
            const room = await createRoom(context.action(session1), space.id);

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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            expect(
                (
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    })
                ).lastMessageChangeTime,
            ).toEqual(null);

            const updatedMessage2 = await updateMessageContent(context.action(session2), {
                roomKey: room.key,
                messageIndex: message2.index,
                content: content2,
            });

            expect(
                (
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    })
                ).lastMessageChangeTime,
            ).toEqual(updatedMessage2.contentUpdatedTime);

            const updatedMessage5 = await updateMessageContent(context.action(session2), {
                roomKey: room.key,
                messageIndex: message5.index,
                content: content1,
            });

            expect(
                (
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    })
                ).lastMessageChangeTime,
            ).toEqual(updatedMessage5.contentUpdatedTime);
        });

        test("get from end returns the last time any message was updated even if it is not visible", async () => {
            const room = await createRoom(context.action(session1), space.id);

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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            expect(
                (
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    })
                ).lastMessageChangeTime,
            ).toEqual(null);

            const updatedMessage5 = await updateMessageContent(context.action(session2), {
                roomKey: room.key,
                messageIndex: message5.index,
                content: content1,
            });

            expect(
                (
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    })
                ).lastMessageChangeTime,
            ).toEqual(updatedMessage5.contentUpdatedTime);

            const updatedMessage2 = await updateMessageContent(context.action(session2), {
                roomKey: room.key,
                messageIndex: message2.index,
                content: content2,
            });

            expect(
                (
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    })
                ).lastMessageChangeTime,
            ).toEqual(updatedMessage2.contentUpdatedTime);
        });

        test("get from start returns the last time any message was deleted even if it is not visible", async () => {
            const room = await createRoom(context.action(session1), space.id);

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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            expect(
                (
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    })
                ).lastMessageChangeTime,
            ).toEqual(null);

            const deletedMessage2 = await deleteMessage(context.action(session2), {
                roomKey: room.key,
                messageIndex: message2.index,
            });

            expect(
                (
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    })
                ).lastMessageChangeTime,
            ).toEqual(deletedMessage2.deletedTime);

            const deletedMessage5 = await deleteMessage(context.action(session2), {
                roomKey: room.key,
                messageIndex: message5.index,
            });

            expect(
                (
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    })
                ).lastMessageChangeTime,
            ).toEqual(deletedMessage5.deletedTime);
        });

        test("get from end returns the last time any message was deleted even if it is not visible", async () => {
            const room = await createRoom(context.action(session1), space.id);

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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            expect(
                (
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    })
                ).lastMessageChangeTime,
            ).toEqual(null);

            const deletedMessage5 = await deleteMessage(context.action(session2), {
                roomKey: room.key,
                messageIndex: message5.index,
            });

            expect(
                (
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    })
                ).lastMessageChangeTime,
            ).toEqual(deletedMessage5.deletedTime);

            const deletedMessage2 = await deleteMessage(context.action(session2), {
                roomKey: room.key,
                messageIndex: message2.index,
            });

            expect(
                (
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    })
                ).lastMessageChangeTime,
            ).toEqual(deletedMessage2.deletedTime);
        });

        test("backfill returns nothing if client is up-to-date", async () => {
            const room = await createRoom(context.action(session1), space.id);

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 0,
                lastMessageChangeTime: null,
                newMessages: [],
                messageChangesResult: {type: "Available", changes: []},
            });

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
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

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: null,
                newMessages: [],
                messageChangesResult: {type: "Available", changes: []},
            });

            await updateMessageContent(context.action(session3), {
                roomKey: room.key,
                messageIndex: message3.index,
                content: content2,
            });

            const updatedMessage1 = await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
                content: content2,
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: updatedMessage1.contentUpdatedTime,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: updatedMessage1.contentUpdatedTime,
                newMessages: [],
                messageChangesResult: {type: "Available", changes: []},
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            const deletedMessage1 = await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 4,
                        clientLastMessageChangeTime: deletedMessage1.deletedTime,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 4,
                lastMessageChangeTime: deletedMessage1.deletedTime,
                newMessages: [],
                messageChangesResult: {type: "Available", changes: []},
            });
        });

        test("backfill returns missing changes", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
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

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: null,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
                messageChangesResult: {type: "Available", changes: []},
            });

            const updatedMessage3 = await updateMessageContent(context.action(session3), {
                roomKey: room.key,
                messageIndex: message3.index,
                content: content2,
            });

            const updatedMessage1 = await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
                content: content2,
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: updatedMessage1.contentUpdatedTime,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: true,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: true,
                    },
                ],
                messageChangesResult: {
                    type: "Available",
                    changes: [
                        {type: "UpdateContent", index: message3.index, content: content2},
                        {type: "UpdateContent", index: message1.index, content: content2},
                    ],
                },
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 1,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: updatedMessage1.contentUpdatedTime,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: true,
                    },
                ],
                messageChangesResult: {
                    type: "Available",
                    changes: [
                        {type: "UpdateContent", index: message3.index, content: content2},
                        {type: "UpdateContent", index: message1.index, content: content2},
                    ],
                },
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: updatedMessage1.contentUpdatedTime,
                newMessages: [],
                messageChangesResult: {
                    type: "Available",
                    changes: [
                        {type: "UpdateContent", index: message3.index, content: content2},
                        {type: "UpdateContent", index: message1.index, content: content2},
                    ],
                },
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: updatedMessage3.contentUpdatedTime,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: updatedMessage1.contentUpdatedTime,
                newMessages: [],
                messageChangesResult: {
                    type: "Available",
                    changes: [{type: "UpdateContent", index: message1.index, content: content2}],
                },
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 2,
                        clientLastMessageChangeTime: updatedMessage3.contentUpdatedTime,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: updatedMessage1.contentUpdatedTime,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: true,
                    },
                ],
                messageChangesResult: {
                    type: "Available",
                    changes: [{type: "UpdateContent", index: message1.index, content: content2}],
                },
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            const deletedMessage1 = await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 4,
                lastMessageChangeTime: deletedMessage1.deletedTime,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        isDeleted: true,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: true,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
                messageChangesResult: {
                    type: "Available",
                    changes: [
                        {type: "UpdateContent", index: message3.index, content: content2},
                        {type: "UpdateContent", index: message1.index, content: content2},
                        {type: "Delete", index: message1.index},
                    ],
                },
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 4,
                lastMessageChangeTime: deletedMessage1.deletedTime,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
                messageChangesResult: {
                    type: "Available",
                    changes: [
                        {type: "UpdateContent", index: message3.index, content: content2},
                        {type: "UpdateContent", index: message1.index, content: content2},
                        {type: "Delete", index: message1.index},
                    ],
                },
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: updatedMessage1.contentUpdatedTime,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 4,
                lastMessageChangeTime: deletedMessage1.deletedTime,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
                messageChangesResult: {
                    type: "Available",
                    changes: [{type: "Delete", index: message1.index}],
                },
            });
        });

        test("can’t backfill messages for room that doesn’t exist", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
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

            await expect(
                backfillMessages(context.action(session1), {
                    roomKey: getMissingRoomKey(),
                    clientMessageCount: 0,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).rejects.toThrow(/not found/);
        });

        test("can’t backfill messages for a room in a different space", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
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

            await expect(
                backfillMessages(context.action(otherSpaceSession), {
                    roomKey: room.key,
                    clientMessageCount: 0,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).rejects.toThrow(new PermissionDeniedError(spacePermissionDeniedErrorMessage));
        });

        test("can’t backfill messages for a private room account doesn’t have access to", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
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

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: null,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
                messageChangesResult: {
                    type: "Available",
                    changes: [],
                },
            });

            await expect(
                backfillMessages(context.action(session4), {
                    roomKey: room.key,
                    clientMessageCount: 0,
                    clientLastMessageChangeTime: null,
                    newMessageLimit: 100,
                }),
            ).rejects.toThrow(PermissionDeniedError);

            if (room.doesInsideViewerSessionHaveRoomAccess !== "Unimplemented") {
                if (room.doesInsideViewerSessionHaveRoomAccess) {
                    expect(
                        massageMessageBackfill(
                            await backfillMessages(context.action(session5), {
                                roomKey: room.key,
                                clientMessageCount: 0,
                                clientLastMessageChangeTime: null,
                                newMessageLimit: 100,
                            }),
                        ),
                    ).toEqual({
                        messageCount: 3,
                        lastMessageChangeTime: null,
                        newMessages: [
                            {
                                author: await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
                                parentMessageIndex: null,
                                content: content1,
                                hasContentUpdated: false,
                            },
                            {
                                author: await getAccount(
                                    context.action(session2),
                                    space.id,
                                    session2.accountId,
                                ),
                                parentMessageIndex: null,
                                content: content1,
                                hasContentUpdated: false,
                            },
                            {
                                author: await getAccount(
                                    context.action(session3),
                                    space.id,
                                    session3.accountId,
                                ),
                                parentMessageIndex: null,
                                content: content1,
                                hasContentUpdated: false,
                            },
                        ],
                        messageChangesResult: {
                            type: "Available",
                            changes: [],
                        },
                    });
                } else {
                    await expect(
                        backfillMessages(context.action(session5), {
                            roomKey: room.key,
                            clientMessageCount: 0,
                            clientLastMessageChangeTime: null,
                            newMessageLimit: 100,
                        }),
                    ).rejects.toThrow(PermissionDeniedError);
                }
            }
        });

        test("limits the number of new messages when backfilling", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
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

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
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
                content: content2,
                fileIds: [],
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 0,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 3,
                    }),
                ),
            ).toEqual({
                messageCount: 6,
                lastMessageChangeTime: null,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
                messageChangesResult: {
                    type: "Available",
                    changes: [],
                },
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 2,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 3,
                    }),
                ),
            ).toEqual({
                messageCount: 6,
                lastMessageChangeTime: null,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
                messageChangesResult: {
                    type: "Available",
                    changes: [],
                },
            });
        });

        test("changes are not available for backfill after a certain amount of time", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
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

            const updatedMessage1 = await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
                content: content2,
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        clientMessageCount: 3,
                        clientLastMessageChangeTime: null,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                lastMessageChangeTime: updatedMessage1.contentUpdatedTime,
                newMessages: [],
                messageChangesResult: {
                    type: "Available",
                    changes: [
                        {type: "UpdateContent", index: message3.index, content: content2},
                        {type: "UpdateContent", index: message1.index, content: content2},
                    ],
                },
            });

            const originalDateNow = Date.now;
            const mockTime = getMessageChangeLogExpirationTimeFromChangeTime(
                updatedMessage1.contentUpdatedTime,
            );
            Date.now = () => mockTime.getTime();

            try {
                expect(
                    massageMessageBackfill(
                        await backfillMessages(context.action(session1), {
                            roomKey: room.key,
                            clientMessageCount: 3,
                            clientLastMessageChangeTime: null,
                            newMessageLimit: 100,
                        }),
                    ),
                ).toEqual({
                    messageCount: 3,
                    lastMessageChangeTime: updatedMessage1.contentUpdatedTime,
                    newMessages: [],
                    messageChangesResult: {type: "Unavailable"},
                });

                expect(
                    massageMessageBackfill(
                        await backfillMessages(context.action(session1), {
                            roomKey: room.key,
                            clientMessageCount: 3,
                            clientLastMessageChangeTime: updatedMessage3.contentUpdatedTime,
                            newMessageLimit: 100,
                        }),
                    ),
                ).toEqual({
                    messageCount: 3,
                    lastMessageChangeTime: updatedMessage1.contentUpdatedTime,
                    newMessages: [],
                    messageChangesResult: {type: "Unavailable"},
                });

                expect(
                    massageMessageBackfill(
                        await backfillMessages(context.action(session1), {
                            roomKey: room.key,
                            clientMessageCount: 3,
                            clientLastMessageChangeTime: updatedMessage1.contentUpdatedTime,
                            newMessageLimit: 100,
                        }),
                    ),
                ).toEqual({
                    messageCount: 3,
                    lastMessageChangeTime: updatedMessage1.contentUpdatedTime,
                    newMessages: [],
                    messageChangesResult: {
                        type: "Available",
                        changes: [],
                    },
                });
            } finally {
                Date.now = originalDateNow;
            }
        });

        test("recursively loads parent messages when loading from end", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: message1.index,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: message3.index,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 4,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                otherReferencedMessages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: message1.index,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("recursively loads parent messages when loading from start", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content2,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: message1.index,
                content: content3,
                fileIds: [],
            });

            const message4 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: message3.index,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parentMessageIndex: null,
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 4,
                        afterMessageIndex: message4.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 8,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: message3.index,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                otherReferencedMessages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parentMessageIndex: message1.index,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });
        });
    });
}
