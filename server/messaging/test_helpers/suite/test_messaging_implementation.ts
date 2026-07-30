/* eslint-disable cyberworlds/string-quotes */
import {addDays, addMinutes} from "date-fns";
import {Fragment, Mark, Node, Slice} from "prosemirror-model";
import {ReplaceStep, Step} from "prosemirror-transform";
import {TestLocalJobSender} from "~/admin/environment/test/unit/test_local_job_sender.js";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {
    ServerAccountActionContext,
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {ServerSessionActionContextWithPush} from "~/server/context/server_session_action_context_with_push.js";
import {createTestPushContextModules} from "~/server/dynamo/test_helpers/create_test_push_context_modules.js";
import {
    TestSessionItem,
    createTestSession,
} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {attachFileAsUploader} from "~/server/files/data/files_actions.js";
import {uploadTestFile} from "~/server/files/test_helpers/test_file.js";
import {messageStreamTimeoutMs} from "~/server/messaging/helpers/message_stream_timeout_ms.js";
import {
    messagingBackfillSafetyWindowMinutes,
    messagingEventExpirationDays,
} from "~/server/messaging/helpers/run_backfill_message_updates.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {
    TestAccountActionContext,
    TestActionContext,
    TestBotActionContext,
    TestSessionActionContext,
} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {
    MessageContent,
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/content/message_content_schema.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
    UnauthenticatedError,
} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {AccountId, FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageModel, MessageRoomKeyType} from "~/shared/messaging/message_model.js";
import {
    MessageContentPayloadContentUpdate,
    MessageContentPayloadParent,
    MessageExperimentalApproval,
    MessageExperimentalApprovalDecisionOption,
    MessageExperimentalApprovalDecisionValue,
    MessagePayload,
    MessageStreamExperimentalApprovalsPartPayload,
    MessageStreamPartPayload,
} from "~/shared/messaging/message_schema.js";
import {MessageUpdatesBackfillResult} from "~/shared/messaging/messaging_realtime_protocol.js";
import {PutMessageApprovalDecisionsPayload} from "~/shared/messaging/put_message_approval_decisions_payload_schema.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {
    ServerSynchronizationCheckpoint,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const schema = MessageContentProsemirrorSchema;

/**
 * Create a new message in a room.
 */
type CreateMessageFunctionForTest<RoomKey extends string> = (
    context: TestAccountActionContext,
    options: {
        roomKey: RoomKey;
        parent: MessageContentPayloadParent | null;
        content: MessageContent;
        fileIds: ReadonlyArray<FileId>;
        createdTimeZone?: TimeZone;
        isStream?: boolean;
    },
) => Promise<{
    index: number;
    createdTime: Date;
}>;

/**
 * Get a message.
 */
type GetMessageFunctionForTest<Message extends MessageModel> = (
    context: ServerSessionActionContext,
    options: {
        roomKey: MessageRoomKeyType<Message>;
        messageIndex: number;
    },
) => Promise<Message>;

/**
 * Get only a message payload.
 */
type GetMessagePayloadFunctionForTest<Message extends MessageModel> = (
    context: ServerAccountActionContext,
    options: {
        roomKey: MessageRoomKeyType<Message>;
        messageIndex: number;
    },
) => Promise<{
    payload: MessagePayload;
    stream: {
        completedTime: Date | null;
        lastPingTime: Date | null;
        parts: ReadonlyArray<{
            version: number;
            payload: MessageStreamPartPayload;
        }>;
    } | null;
}>;

/**
 * Get the content without references for a message parent
 */
type GetMessageParentContentFunctionForTest<Message extends MessageModel> = (
    context: ServerAccountActionContext,
    options: {
        roomKey: MessageRoomKeyType<Message>;
        parent: MessageContentPayloadParent;
    },
) => Promise<{
    content: MessageContent;
    authorId: AccountId;
}>;

/**
 * Update the content of a message.
 *
 * We will record the time at which the content was updated and show that the
 * message was edited.
 */
type UpdateMessageContentFunctionForTest<RoomKey extends string> = (
    context: ServerAccountActionContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
        contentVersion: number;
        steps: ReadonlyArray<Step>;
    },
) => Promise<{
    content: MessageContent;
    contentUpdate: MessageContentPayloadContentUpdate;
}>;

/**
 * Delete a message.
 */
type DeleteMessageFunctionForTest<RoomKey extends string> = (
    context: ServerAccountActionContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
    },
) => Promise<{
    deletedTime: Date;
}>;

/**
 * Ping a message stream
 */
type PingMessageStreamFunctionForTest<RoomKey extends string> = (
    context: TestBotActionContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
    },
) => Promise<{spaceId: SpaceId; lastPingTime: Date; completedTime?: Date}>;

/**
 * Put a stream part for a streaming message.
 */
type PutMessageStreamPartFunctionForTest<RoomKey extends string> = (
    context: TestActionContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
        partIndex: number | "Create";
        payload: MessageStreamPartPayload;
        isTimeoutErrorCompletion?: boolean;
        approvalDecisionExpectedVersion?: number;
    },
) => Promise<{createdTime: Date}>;

/**
 * Put approval decisions for a streaming message.
 */
type PutMessageApprovalDecisionsFunctionForTest<RoomKey extends string> = (
    context: TestActionContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
        payload: PutMessageApprovalDecisionsPayload;
    },
) => Promise<{approvals: ReadonlyArray<MessageExperimentalApproval>}>;

/**
 * Complete a message stream. After this parts can't be added or updated.
 */
type CompleteMessageStreamFunctionForTest<RoomKey extends string> = (
    context: TestBotActionContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
    },
) => Promise<{completedTime: Date}>;

/**
 * Sets a reaction on a message.
 */
type SetMessageReactionFunctionForTest<RoomKey extends string> = (
    context: ServerSessionActionContextWithPush,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
        contentVersion: number;
        pos: number;
        reaction: Reaction | "GenericLike";
    },
) => Promise<{}>;

/**
 * Deletes a reaction from a message.
 */
type DeleteMessageReactionFunctionForTest<RoomKey extends string> = (
    context: TestSessionActionContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
        contentVersion: number;
        pos: number;
    },
) => Promise<{}>;

/**
 * Load a range of messages starting from the beginning of the room (or starting
 * after a message ID) and loading forwards in time.
 */
type GetMessagesFromStartForTest<Message extends MessageModel> = (
    context: ServerActionContext,
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
}>;

/**
 * Load a range of messages starting from the end of the room (or starting before a
 * message ID) and loading backwards in time.
 */
type GetMessagesFromEndForTest<Message extends MessageModel> = (
    context: ServerActionContext,
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
}>;

/**
 * Load a range of message payloads (doesn't load references) starting from the
 * beginning of the room (or starting after a message ID) and loading forwards in
 * time.
 */
type GetMessagePayloadsFromStartForTest<Message extends MessageModel> = (
    context: ServerActionContext,
    options: {
        roomKey: MessageRoomKeyType<Message>;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
) => Promise<{
    messageCount: number;
    messages: Array<{
        index: number;
        createdTime: Date;
        authorId: AccountId;
        payload: MessagePayload;
        stream: {
            completedTime: Date | null;
            parts: ReadonlyArray<{version: number; payload: MessageStreamPartPayload}>;
        } | null;
    }>;
}>;

/**
 * Load a range of message payloads (doesn't load references) starting from the end
 * of the room (or starting before a message ID) and loading backwards in time.
 */
type GetMessagePayloadsFromEndForTest<Message extends MessageModel> = (
    context: ServerActionContext,
    options: {
        roomKey: MessageRoomKeyType<Message>;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
) => Promise<{
    messageCount: number;
    messages: Array<{
        index: number;
        createdTime: Date;
        authorId: AccountId;
        payload: MessagePayload;
        stream: {
            completedTime: Date | null;
            parts: ReadonlyArray<{
                version: number;
                payload: MessageStreamPartPayload;
            }>;
        } | null;
    }>;
}>;

/**
 * Backfill messages and message changes the client is missing. Realtime could be
 * implemented by polling this method. However, this method is also important for
 * implementing push-based realtime as it fills the gap between when data was
 * loaded and when we connected to our realtime WebSocket.
 */
type BackfillMessagesFunctionForTest<Message extends MessageModel> = (
    context: ServerSessionActionContext,
    options: {
        roomKey: MessageRoomKeyType<Message>;
        checkpoint: ServerSynchronizationCheckpoint;
        clientMessageCount: number;
        newMessageLimit: number;
    },
) => Promise<{
    messageCount: number;
    newMessages: ReadonlyArray<Message>;
    newOtherReferencedMessages: ReadonlyArray<Message>;
    messageUpdatesResult: MessageUpdatesBackfillResult<Message>;
}>;

/**
 * Wherever we want to create some space for conversation in our product we use a
 * consistent messaging UI. We also eventually want to make this messaging UI
 * embeddable in other products through an API! Whenever a user sees the messaging
 * UI they know what to do, there's no new features to learn.
 *
 * We do not have one implementation of the messaging UI backend. Instead every
 * entity that can have messages owns their own data so they can store it in an
 * optimal way. Some implementation variations we expect across products:
 *
 * - Task comments or chat rooms may have system update messages like "title
 *   changed" in between messages.
 * - Document comments may store the first few messages separately to render a
 *   preview.
 * - A document has many messaging threads. We want realtime events to go through
 *   the document durable object instead of a durable object for each messaging
 *   thread.
 * - For posts we keep track of how many messages for each individual author so we
 *   can show a preview of the thread.
 *
 * However we expect each implementation to behave the same in some ways so we know
 * the behavior of our messaging UI component will be consistent.
 *
 * This type lays out the interface our messaging UI expects so that we can write
 * tests against it. These tests help us make sure our messaging implementations
 * stay consistent as we evolve them over time.
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
        sessions: Array<{accountId: AccountId}>,
    ) => Promise<RoomInterface<RoomKey>>;

    /**
     * Create a new private room in which messages will live. Same as `createRoom` but
     * only `insideSession` has access. `outsideSession` should not have access to the
     * room and an error should be thrown when they try.
     */
    createPrivateRoom: (
        context: TestSessionActionContext,
        spaceId: SpaceId,
        options: {
            insideSessions: Array<{accountId: AccountId}>;
            insideViewerSession: {accountId: AccountId} | null;
            insideBotAccount: {accountId: AccountId} | null;
            outsideSession: {accountId: AccountId};
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
     * Get a bot scope for the provided room key.
     */
    getRoomBotScope: (key: RoomKey) => BotTokenPayloadScope;

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
     * Gets the content without references for a message parent
     */
    getMessageParentContent: GetMessageParentContentFunctionForTest<MessageModel<RoomKey>>;

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
     * Put a stream part for a streaming message.
     */
    pingMessageStream: PingMessageStreamFunctionForTest<RoomKey>;

    /**
     * Put a stream part for a streaming message.
     */
    putMessageStreamPart: PutMessageStreamPartFunctionForTest<RoomKey>;

    /**
     * Put approval decisions for a streaming message.
     */
    putMessageApprovalDecisions: PutMessageApprovalDecisionsFunctionForTest<RoomKey>;

    /**
     * Complete a message stream. After this parts can't be added or updated.
     */
    completeMessageStream: CompleteMessageStreamFunctionForTest<RoomKey>;

    /**
     * Sets a reaction on a message.
     */
    setMessageReaction: SetMessageReactionFunctionForTest<RoomKey>;

    /**
     * Deletes a reaction from a message.
     */
    deleteMessageReaction: DeleteMessageReactionFunctionForTest<RoomKey>;

    /**
     * Load a range of messages starting from the beginning of the room (or starting
     * after a message ID) and loading forwards in time.
     */
    getMessagesFromStart: GetMessagesFromStartForTest<MessageModel<RoomKey>>;

    /**
     * Load a range of messages starting from the end of the room (or starting before a
     * message ID) and loading backwards in time.
     */
    getMessagesFromEnd: GetMessagesFromEndForTest<MessageModel<RoomKey>>;

    /**
     * Load a range of message payloads (doesn't load references) starting from the
     * beginning of the room (or starting after a message ID) and loading forwards in
     * time.
     */
    getMessagePayloadsFromStart: GetMessagePayloadsFromStartForTest<MessageModel<RoomKey>>;

    /**
     * Load a range of message payloads (doesn't load references) starting from the end
     * of the room (or starting before a message ID) and loading backwards in time.
     */
    getMessagePayloadsFromEnd: GetMessagePayloadsFromEndForTest<MessageModel<RoomKey>>;

    /**
     * Backfill messages and message changes the client is missing. Realtime could be
     * implemented by polling this method. However, this method is also important for
     * implementing push-based realtime as it fills the gap between when data was
     * loaded and when we connected to our realtime WebSocket.
     */
    backfillMessages: BackfillMessagesFunctionForTest<MessageModel<RoomKey>>;

    /**
     * When the user doesn't have access to a space, it's typically caught by a
     * `authorizeSpaceAccess()` which throws a `PermissionDeniedError` with a message
     * of "Account doesn't have access to space". However, sometimes a different error
     * message maybe used when account doesn't have access to a space. This property
     * allows us to configure what error message the test suite expects when the
     * account doesn't have access to a space.
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

    readonly messageNoun: "message" | "comment";
};

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(MessageContentProsemirrorSchema.text(text)), 0, 0);
}

export function testMessagingImplementation<RoomKey extends string>(
    context: TestActualContext,
    {
        createRoom: actuallyCreateRoom,
        createPrivateRoom: actuallyCreatePrivateRoom,
        getRoom,
        getMissingRoomKey,
        getRoomFileAuthorizer,
        getRoomBotScope,
        createMessage,
        getMessage,
        getMessagePayload,
        getMessageParentContent,
        getMessagesFromStart,
        getMessagesFromEnd,
        getMessagePayloadsFromStart,
        getMessagePayloadsFromEnd,
        updateMessageContent,
        deleteMessage,
        pingMessageStream,
        putMessageStreamPart,
        putMessageApprovalDecisions,
        completeMessageStream,
        setMessageReaction,
        deleteMessageReaction,
        backfillMessages,
        spacePermissionDeniedErrorMessage = "Account doesn\u2019t have access to space",
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
        return actuallyCreateRoom(context, spaceId, [session1, session2, session3]);
    };

    const createPrivateRoom = (context: TestSessionActionContext, spaceId: SpaceId) => {
        return actuallyCreatePrivateRoom(context, spaceId, {
            insideSessions: [session1, session2, session3],
            insideViewerSession: session5,
            insideBotAccount: null,
            outsideSession: session4,
        });
    };

    function massageMessage(message: MessageModel | null) {
        if (!message) return null;

        switch (message.payload.type) {
            case "Content": {
                return {
                    author: message.author,
                    parent: message.payload.parent,
                    content: message.payload.content.doc,
                    hasContentUpdated: message.payload.contentUpdate !== null,
                    ...(message.payload.files.length > 0
                        ? {
                              fileIds: message.payload.files.map(file =>
                                  file.type === "Null"
                                      ? file.fileId
                                      : file.type === "FileEntity"
                                        ? file.fileEntityId
                                        : file.file.id,
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
                    parent: payload.parent,
                    content: payload.content,
                    hasContentUpdated: payload.contentUpdate !== null,
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

    function massageMessageBackfill(result: {
        messageCount: number;
        newMessages: ReadonlyArray<MessageModel<RoomKey>>;
        newOtherReferencedMessages: ReadonlyArray<MessageModel<RoomKey>>;
        messageUpdatesResult: MessageUpdatesBackfillResult<MessageModel<RoomKey>>;
    }) {
        return {
            messageCount: result.messageCount,
            newMessages: result.newMessages.map(massageMessage),
            ...(result.newOtherReferencedMessages.length > 0
                ? {
                      newOtherReferencedMessages:
                          result.newOtherReferencedMessages.map(massageMessage),
                  }
                : {}),
            messageUpdatesResult: result.messageUpdatesResult,
        };
    }

    async function expectGetMessage(
        context: ServerSessionActionContext,
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
                (
                    await getMessagePayload(context, {
                        roomKey,
                        messageIndex,
                    })
                ).payload,
            ),
        ).toEqual(omitObject(expected, ["author"]));
    }

    async function expectGetMessageAndGetMessagePayloadNotToBeNull(
        context: ServerSessionActionContext,
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
                (
                    await getMessagePayload(context, {
                        roomKey,
                        messageIndex,
                    })
                ).payload,
            ),
        ).not.toBeNull();
    }

    async function expectGetMessageAndGetMessagePayloadToThrow(
        context: ServerSessionActionContext,
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

    async function getMessageContentPayload(
        session: TestSessionItem,
        roomKey: RoomKey,
        messageIndex: number,
    ) {
        const message = await getMessage(context.action(session), {
            roomKey,
            messageIndex,
        });
        return message.payload.content?.doc.toString();
    }

    describe("Messaging implementation", () => {
        test("can create room", async () => {
            const room = await createRoom(context.action(session1), space.id);

            expect(room.messageCount).toEqual(0);
        });

        test("can\u2019t create room in a space you don\u2019t have access to", async () => {
            await expect(createRoom(context.action(session1), otherSpace.id)).rejects.toThrow(
                PermissionDeniedError,
            );
        });

        test("can get room", async () => {
            const room1 = await createRoom(context.action(session1), space.id);

            const room2 = await getRoom(context.action(session1), room1.key);

            expect(room2?.messageCount).toEqual(0);
        });

        test("can\u2019t get room in a space you don\u2019t have access to", async () => {
            const room1 = await createRoom(context.action(session1), space.id);

            await expect(getRoom(context.action(otherSpaceSession), room1.key)).rejects.toThrow(
                PermissionDeniedError,
            );
        });

        test("can\u2019t get private room when you don\u2019t have access", async () => {
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
                parent: null,
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("createdTimeZone is reflected in returned message model", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const testTimeZone = "America/Los_Angeles" as TimeZone;

            const createdMessage = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
                createdTimeZone: testTimeZone,
            });

            const retrievedMessage = await getMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: createdMessage.index,
            });

            expect(retrievedMessage.createdTimeZone).toEqual(testTimeZone);
        });

        test("can create multiple messages", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
                    content: content2,
                    hasContentUpdated: false,
                },
            );

            const message3 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
                    content: content3,
                    hasContentUpdated: false,
                },
            );
        });

        test("race condition: can create lots of messages at the exact same time", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const createMessageCount = 8;

            const messages = await runAllPromises(
                createArrayWithLength(createMessageCount, index =>
                    createMessage(context.action(session1), {
                        roomKey: room.key,
                        parent: null,
                        content: createSimpleMessageContent(`Message ${index + 1}`),
                        fileIds: [],
                    }),
                ),
            );

            expect(messages.map(message => message.index).sort((a, b) => a - b)).toEqual(
                createArrayWithLength(createMessageCount, index => room.messageCount + index),
            );
        });

        test("can create message from a different account", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("can\u2019t create message in a room that doesn\u2019t exist", async () => {
            await expect(
                createMessage(context.action(session1), {
                    roomKey: getMissingRoomKey(),
                    parent: null,
                    content: content1,
                    fileIds: [],
                }),
            ).rejects.toThrow(/not found/);
        });

        test("can\u2019t create message in a different space", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                createMessage(context.action(otherSpaceSession), {
                    roomKey: room.key,
                    parent: null,
                    content: content1,
                    fileIds: [],
                }),
            ).rejects.toThrow(new PermissionDeniedError(spacePermissionDeniedErrorMessage));
        });

        test("can\u2019t create message in private room from an account without access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await expect(
                createMessage(context.action(session4), {
                    roomKey: room.key,
                    parent: null,
                    content: content4,
                    fileIds: [],
                }),
            ).rejects.toThrow(PermissionDeniedError);

            if (room.doesInsideViewerSessionHaveRoomAccess !== "Unimplemented") {
                await expect(
                    createMessage(context.action(session5), {
                        roomKey: room.key,
                        parent: null,
                        content: content4,
                        fileIds: [],
                    }),
                ).rejects.toThrow(PermissionDeniedError);
            }
        });

        test("can\u2019t create message with invalid content", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const content = assertMessageContent(
                schema.nodes.doc.create({}, [
                    schema.nodes.unorderedListItem.create({}, [schema.text("Hello, world!")]),
                ]),
            );

            await expect(
                createMessage(context.action(session2), {
                    roomKey: room.key,
                    parent: null,
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
                fileId,
                getRoomFileAuthorizer(room.key),
            );

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
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
                    file1Id,
                    getRoomFileAuthorizer(room.key),
                ),
                attachFileAsUploader(
                    context.action(session1),
                    file2Id,
                    getRoomFileAuthorizer(room.key),
                ),
                attachFileAsUploader(
                    context.action(session1),
                    file3Id,
                    getRoomFileAuthorizer(room.key),
                ),
            ]);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                    fileIds: [file1Id, file2Id, file3Id],
                },
            );
        });

        test("can\u2019t create message with file if file isn\u2019t attached", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const {fileId} = await uploadTestFile(context.action(session1), space.id);

            await expect(
                createMessage(context.action(session1), {
                    roomKey: room.key,
                    parent: null,
                    content: content1,
                    fileIds: [fileId],
                }),
            ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

            await expectGetMessageAndGetMessagePayloadToThrow(
                context.action(session1),
                {roomKey: room.key, messageIndex: 0},
                NotFoundError,
            );
        });

        test("can\u2019t create message with file that doesn\u2019t exist", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                createMessage(context.action(session1), {
                    roomKey: room.key,
                    parent: null,
                    content: content1,
                    fileIds: [generateChronologicalId()],
                }),
            ).rejects.toThrow("File not found");

            await expectGetMessageAndGetMessagePayloadToThrow(
                context.action(session1),
                {roomKey: room.key, messageIndex: 0},
                NotFoundError,
            );
        });

        test("can\u2019t create message with file attached to another room", async () => {
            const room1 = await createRoom(context.action(session1), space.id);
            const room2 = await createRoom(context.action(session1), space.id);

            const {fileId} = await uploadTestFile(context.action(session1), space.id);

            await attachFileAsUploader(
                context.action(session1),
                fileId,
                getRoomFileAuthorizer(room2.key),
            );

            await expect(
                createMessage(context.action(session1), {
                    roomKey: room1.key,
                    parent: null,
                    content: content1,
                    fileIds: [fileId],
                }),
            ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

            await expectGetMessageAndGetMessagePayloadToThrow(
                context.action(session1),
                {roomKey: room1.key, messageIndex: 0},
                NotFoundError,
            );
        });

        test("can\u2019t create message with file from a different space", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const {fileId} = await uploadTestFile(context.action(otherSpaceSession), otherSpace.id);

            await expect(
                createMessage(context.action(session1), {
                    roomKey: room.key,
                    parent: null,
                    content: content1,
                    fileIds: [fileId],
                }),
            ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

            await expectGetMessageAndGetMessagePayloadToThrow(
                context.action(session1),
                {roomKey: room.key, messageIndex: 0},
                NotFoundError,
            );
        });

        test("can\u2019t get a message which doesn\u2019t exist", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await expectGetMessageAndGetMessagePayloadToThrow(
                context.action(session1),
                {roomKey: room.key, messageIndex: 42},
                NotFoundError,
            );
        });

        test("can\u2019t get a message in a different space", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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

        test("can\u2019t get a message in a private room when account doesn\u2019t have access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: {type: "Message", index: message1.index},
                content: content2,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: {type: "Message", index: message2.index},
                content: content3,
                fileIds: [],
            });

            const message4 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: {type: "Message", index: message2.index},
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
                    parent: null,
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
                    parent: {type: "Message", index: message1.index},
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
                    parent: {type: "Message", index: message2.index},
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
                    parent: {type: "Message", index: message2.index},
                    content: content4,
                    hasContentUpdated: false,
                },
            );
        });

        test("can\u2019t create message with a parent that doesn\u2019t exist", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                createMessage(context.action(session1), {
                    roomKey: room.key,
                    parent: {type: "Message", index: 42},
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            expect((await getRoom(context.action(session1), room.key))?.messageCount).toEqual(1);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            expect((await getRoom(context.action(session1), room.key))?.messageCount).toEqual(2);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                parent: null,
                content: content4,
                fileIds: [],
            });

            expect((await getRoom(context.action(session1), room.key))?.messageCount).toEqual(4);
        });

        test("can update message with different content", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("2"))],
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
                    parent: null,
                    content: content2,
                    hasContentUpdated: true,
                },
            );
        });

        test("can update message with different content multiple times", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            expect(await getMessageContentPayload(session1, room.key, message.index)).toEqual(
                'doc(paragraph("test1"))',
            );

            await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("2"))],
            });

            expect(await getMessageContentPayload(session1, room.key, message.index)).toEqual(
                'doc(paragraph("test2"))',
            );

            await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message.index,
                contentVersion: 1,
                steps: [new ReplaceStep(5, 6, textSlice("3"))],
            });

            expect(await getMessageContentPayload(session1, room.key, message.index)).toEqual(
                'doc(paragraph("test3"))',
            );
        });

        test("can\u2019t update message with the wrong version", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            expect(await getMessageContentPayload(session1, room.key, message.index)).toEqual(
                'doc(paragraph("test1"))',
            );

            await expect(
                updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 1,
                    steps: [new ReplaceStep(5, 6, textSlice("2"))],
                }),
            ).rejects.toThrow(/mismatched content version/);

            expect(await getMessageContentPayload(session1, room.key, message.index)).toEqual(
                'doc(paragraph("test1"))',
            );
        });

        test("can update message with the wrong version after a successful update", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            expect(await getMessageContentPayload(session1, room.key, message.index)).toEqual(
                'doc(paragraph("test1"))',
            );

            await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("2"))],
            });

            expect(await getMessageContentPayload(session1, room.key, message.index)).toEqual(
                'doc(paragraph("test2"))',
            );

            await expect(
                updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    steps: [new ReplaceStep(5, 6, textSlice("3"))],
                }),
            ).rejects.toThrow(/mismatched content version/);

            expect(await getMessageContentPayload(session1, room.key, message.index)).toEqual(
                'doc(paragraph("test2"))',
            );
        });

        test("can update message with the wrong version (future version) after a successful update", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            expect(await getMessageContentPayload(session1, room.key, message.index)).toEqual(
                'doc(paragraph("test1"))',
            );

            await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("2"))],
            });

            expect(await getMessageContentPayload(session1, room.key, message.index)).toEqual(
                'doc(paragraph("test2"))',
            );

            await expect(
                updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 2,
                    steps: [new ReplaceStep(5, 6, textSlice("3"))],
                }),
            ).rejects.toThrow(/mismatched content version/);

            expect(await getMessageContentPayload(session1, room.key, message.index)).toEqual(
                'doc(paragraph("test2"))',
            );
        });

        test("can\u2019t update message on room that doesn\u2019t exist", async () => {
            await expect(
                updateMessageContent(context.action(session2), {
                    roomKey: getMissingRoomKey(),
                    messageIndex: 42,
                    contentVersion: 0,
                    steps: [new ReplaceStep(5, 6, textSlice("2"))],
                }),
            ).rejects.toThrow(/not found/);
        });

        test("can\u2019t update message that doesn\u2019t exist", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                updateMessageContent(context.action(session2), {
                    roomKey: room.key,
                    messageIndex: 42,
                    contentVersion: 0,
                    steps: [new ReplaceStep(5, 6, textSlice("2"))],
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("can\u2019t update message from different author", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await expect(
                updateMessageContent(context.action(session2), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    steps: [new ReplaceStep(5, 6, textSlice("2"))],
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("can\u2019t update message from different space", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await expect(
                updateMessageContent(context.action(otherSpaceSession), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    steps: [new ReplaceStep(5, 6, textSlice("2"))],
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("can update message in private room from account with access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await updateMessageContent(context.action(session2), {
                roomKey: room.key,
                messageIndex: message.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("2"))],
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
                    parent: null,
                    content: content2,
                    hasContentUpdated: true,
                },
            );
        });

        test("can\u2019t update message in private room from account which loses access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);
            if (room.revokeInsideSession === "Unimplemented") return;

            const message = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await updateMessageContent(context.action(session2), {
                roomKey: room.key,
                messageIndex: message.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("2"))],
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
                    parent: null,
                    content: content2,
                    hasContentUpdated: true,
                },
            );

            await room.revokeInsideSession(context.action(session1), session2);

            await expect(
                updateMessageContent(context.action(session2), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 1,
                    steps: [new ReplaceStep(5, 6, textSlice("3"))],
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
                    parent: null,
                    content: content2,
                    hasContentUpdated: true,
                },
            );
        });

        test("can\u2019t update message in private room from account without access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await expect(
                updateMessageContent(context.action(session4), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    steps: [new ReplaceStep(5, 6, textSlice("2"))],
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            if (room.doesInsideViewerSessionHaveRoomAccess !== "Unimplemented") {
                await expect(
                    updateMessageContent(context.action(session5), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 0,
                        steps: [new ReplaceStep(5, 6, textSlice("2"))],
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                );
            }
        });

        test("can\u2019t update message with invalid content", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );

            await expect(
                updateMessageContent(context.action(session1), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    steps: [
                        new ReplaceStep(
                            0,
                            7,
                            new Slice(
                                Fragment.from(
                                    schema.nodes.doc.create({}, [
                                        schema.nodes.unorderedListItem.create({}, [
                                            schema.text("Hello, world!"),
                                        ]),
                                    ]),
                                ),
                                0,
                                0,
                            ),
                        ),
                    ],
                }),
            ).rejects.toThrow(FailedPreconditionError);

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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("can delete message", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
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

        test("can\u2019t delete message on room that doesn\u2019t exist", async () => {
            await expect(
                deleteMessage(context.action(session2), {
                    roomKey: getMissingRoomKey(),
                    messageIndex: 42,
                }),
            ).rejects.toThrow(/not found/);
        });

        test("can\u2019t delete message that doesn\u2019t exist", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                deleteMessage(context.action(session2), {
                    roomKey: room.key,
                    messageIndex: 42,
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("can\u2019t delete message from different author", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("can\u2019t delete message from different space", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("can delete message in private room from account with access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
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

        test("can\u2019t delete message in private room from account after revoking access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);
            if (room.revokeInsideSession === "Unimplemented") return;

            const message = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
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
                    parent: null,
                    content: content1,
                    hasContentUpdated: false,
                },
            );
        });

        test("can\u2019t delete message in private room from account without access", async () => {
            const room = await createPrivateRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
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
                    parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                );
            }
        });

        test("can\u2019t delete a message twice", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
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

        test("can\u2019t update a deleted message", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
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
                    parent: null,
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
                    contentVersion: 0,
                    steps: [new ReplaceStep(5, 6, textSlice("2"))],
                }),
            ).rejects.toThrow(FailedPreconditionError);
        });

        test("can get messages from start", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("gets no messages from start when before cursor is greater than after cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            expect(
                await getMessagesFromStart(context.action(session1), {
                    roomKey: room.key,
                    limit: 100,
                    afterMessageIndex: 10,
                    beforeMessageIndex: 5,
                }),
            ).toEqual({
                messageCount: 8,
                messages: [],
                otherReferencedMessages: [],
            });
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
                parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can\u2019t get messages for room that doesn\u2019t exist", async () => {
            await expect(
                getMessagesFromStart(context.action(session1), {
                    roomKey: getMissingRoomKey(),
                    limit: 100,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow(/not found/);
        });

        test("can\u2019t get messages for room in a different space", async () => {
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

        test("can\u2019t get messages for anonymous actor", async () => {
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

        test("can\u2019t get messages for private room from account who doesn\u2019t have access", async () => {
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            const message8 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            const message8 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            const message8 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            const message7 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("gets no messages from end when before cursor is greater than after cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            expect(
                await getMessagesFromEnd(context.action(session1), {
                    roomKey: room.key,
                    limit: 100,
                    afterMessageIndex: 10,
                    beforeMessageIndex: 5,
                }),
            ).toEqual({
                messageCount: 8,
                messages: [],
                otherReferencedMessages: [],
            });
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
                parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can\u2019t get messages from end for room that doesn\u2019t exist", async () => {
            await expect(
                getMessagesFromEnd(context.action(session1), {
                    roomKey: getMissingRoomKey(),
                    limit: 100,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow(/not found/);
        });

        test("can\u2019t get messages from end for room in a different space", async () => {
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

        test("can\u2019t get messages from end for anonymous actor", async () => {
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

        test("can\u2019t get messages from end for private room account doesn\u2019t have access to", async () => {
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            const message8 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            const message8 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const message4 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message6 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            const message7 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const message4 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("2"))],
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
                        parent: null,
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
                        parent: null,
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
                        parent: null,
                        content: content2,
                        hasContentUpdated: true,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const message4 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const message5 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("2"))],
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
                        parent: null,
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
                        parent: null,
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
                        parent: null,
                        content: content2,
                        hasContentUpdated: true,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("will get messages referenced outside the queried range when loading from start", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: {type: "Message", index: message3.index},
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: {type: "Message", index: message3.index},
                content: content1,
                fileIds: [],
            });

            const message6 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: {type: "Message", index: message6.index},
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: {type: "Message", index: message2.index},
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: {type: "Message", index: message3.index},
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: {type: "Message", index: message3.index},
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: {type: "Message", index: message6.index},
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: {type: "Message", index: message2.index},
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
                        parent: {type: "Message", index: message3.index},
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: {type: "Message", index: message3.index},
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: {type: "Message", index: message6.index},
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: {type: "Message", index: message2.index},
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
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
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
                        parent: {type: "Message", index: message3.index},
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: {type: "Message", index: message3.index},
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
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
                        parent: null,
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: {type: "Message", index: message3.index},
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: {type: "Message", index: message3.index},
                content: content1,
                fileIds: [],
            });

            const message6 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            const message7 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: {type: "Message", index: message6.index},
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: {type: "Message", index: message2.index},
                content: content4,
                fileIds: [],
            });

            const message9 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: {type: "Message", index: message3.index},
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: {type: "Message", index: message3.index},
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: {type: "Message", index: message6.index},
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: {type: "Message", index: message2.index},
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
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
                        parent: {type: "Message", index: message3.index},
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: {type: "Message", index: message3.index},
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: {type: "Message", index: message6.index},
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: {type: "Message", index: message2.index},
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
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
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
                        parent: {type: "Message", index: message3.index},
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: {type: "Message", index: message3.index},
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
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
                        parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: {type: "Message", index: message3.index},
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: {type: "Message", index: message3.index},
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("backfill returns nothing if client is up-to-date", async () => {
            const room = await createRoom(context.action(session1), space.id);

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint: generateServerSynchronizationCheckpoint(),
                        clientMessageCount: 0,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 0,
                newMessages: [],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [],
                },
            });

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint: generateServerSynchronizationCheckpoint(),
                        clientMessageCount: 3,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                newMessages: [],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [],
                },
            });

            await updateMessageContent(context.action(session3), {
                roomKey: room.key,
                messageIndex: message3.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("2"))],
            });

            await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("2"))],
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint: addMinutes(generateServerSynchronizationCheckpoint(), 5),
                        clientMessageCount: 3,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                newMessages: [],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [],
                },
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint: addMinutes(generateServerSynchronizationCheckpoint(), 5),
                        clientMessageCount: 4,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 4,
                newMessages: [],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [],
                },
            });
        });

        test("backfill returns missing changes", async () => {
            const checkpoint = generateServerSynchronizationCheckpoint();

            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint,
                        clientMessageCount: 0,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [],
                },
            });

            const updatedMessage3 = await updateMessageContent(context.action(session3), {
                roomKey: room.key,
                messageIndex: message3.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("2"))],
            });

            // Wait for the clock to advance at least 10ms before making the second update.
            {
                const waitStartTime = new Date();
                while (true) {
                    await wait(10);
                    if (new Date().getTime() >= waitStartTime.getTime() + 10) break;
                }
            }

            const updatedMessage1 = await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("2"))],
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint,
                        clientMessageCount: 0,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: true,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: true,
                    },
                ],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [
                        expect.objectContaining({
                            index: message1.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                        expect.objectContaining({
                            index: message3.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                },
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint,
                        clientMessageCount: 1,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: true,
                    },
                ],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [
                        expect.objectContaining({
                            index: message1.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                        expect.objectContaining({
                            index: message3.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                },
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint,
                        clientMessageCount: 3,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                newMessages: [],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [
                        expect.objectContaining({
                            index: message1.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                        expect.objectContaining({
                            index: message3.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                },
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint: addMinutes(
                            new Date(updatedMessage3.contentUpdate.time.getTime() + 5),
                            messagingBackfillSafetyWindowMinutes,
                        ),
                        clientMessageCount: 3,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                newMessages: [],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [
                        expect.objectContaining({
                            index: message1.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                },
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint: addMinutes(
                            new Date(updatedMessage3.contentUpdate.time.getTime() + 5),
                            messagingBackfillSafetyWindowMinutes,
                        ),
                        clientMessageCount: 2,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: true,
                    },
                ],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [
                        expect.objectContaining({
                            index: message1.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                },
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            // Wait for the clock to advance at least 10ms before making the second update.
            {
                const waitStartTime = new Date();
                while (true) {
                    await wait(10);
                    if (new Date().getTime() >= waitStartTime.getTime() + 10) break;
                }
            }

            await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint,
                        clientMessageCount: 0,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 4,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: true,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [
                        expect.objectContaining({
                            index: message1.index,
                            payload: expect.objectContaining({type: "Deleted"}),
                        }),
                        expect.objectContaining({
                            index: message3.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                },
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint,
                        clientMessageCount: 3,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 4,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [
                        expect.objectContaining({
                            index: message1.index,
                            payload: expect.objectContaining({type: "Deleted"}),
                        }),
                        expect.objectContaining({
                            index: message3.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                },
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint: addMinutes(
                            new Date(updatedMessage1.contentUpdate.time.getTime() + 5),
                            messagingBackfillSafetyWindowMinutes,
                        ),
                        clientMessageCount: 3,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 4,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [
                        expect.objectContaining({
                            index: message1.index,
                            payload: expect.objectContaining({type: "Deleted"}),
                        }),
                    ],
                },
            });
        });

        test("can\u2019t backfill messages for room that doesn\u2019t exist", async () => {
            const checkpoint = generateServerSynchronizationCheckpoint();

            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await expect(
                backfillMessages(context.action(session1), {
                    roomKey: getMissingRoomKey(),
                    checkpoint,
                    clientMessageCount: 0,
                    newMessageLimit: 100,
                }),
            ).rejects.toThrow(/not found/);
        });

        test("can\u2019t backfill messages for a room in a different space", async () => {
            const checkpoint = generateServerSynchronizationCheckpoint();

            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await expect(
                backfillMessages(context.action(otherSpaceSession), {
                    roomKey: room.key,
                    checkpoint,
                    clientMessageCount: 0,
                    newMessageLimit: 100,
                }),
            ).rejects.toThrow(new PermissionDeniedError(spacePermissionDeniedErrorMessage));
        });

        test("can\u2019t backfill messages for a private room account doesn\u2019t have access to", async () => {
            const checkpoint = generateServerSynchronizationCheckpoint();

            const room = await createPrivateRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint,
                        clientMessageCount: 0,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [],
                },
            });

            await expect(
                backfillMessages(context.action(session4), {
                    roomKey: room.key,
                    checkpoint,
                    clientMessageCount: 0,
                    newMessageLimit: 100,
                }),
            ).rejects.toThrow(PermissionDeniedError);

            if (room.doesInsideViewerSessionHaveRoomAccess !== "Unimplemented") {
                if (room.doesInsideViewerSessionHaveRoomAccess) {
                    expect(
                        massageMessageBackfill(
                            await backfillMessages(context.action(session5), {
                                roomKey: room.key,
                                checkpoint,
                                clientMessageCount: 0,
                                newMessageLimit: 100,
                            }),
                        ),
                    ).toEqual({
                        messageCount: 3,
                        newMessages: [
                            {
                                author: await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
                                parent: null,
                                content: content1,
                                hasContentUpdated: false,
                            },
                            {
                                author: await getAccount(
                                    context.action(session2),
                                    space.id,
                                    session2.accountId,
                                ),
                                parent: null,
                                content: content1,
                                hasContentUpdated: false,
                            },
                            {
                                author: await getAccount(
                                    context.action(session3),
                                    space.id,
                                    session3.accountId,
                                ),
                                parent: null,
                                content: content1,
                                hasContentUpdated: false,
                            },
                        ],
                        messageUpdatesResult: {
                            type: "Available",
                            checkpoint: expect.any(Date),
                            messages: [],
                        },
                    });
                } else {
                    await expect(
                        backfillMessages(context.action(session5), {
                            roomKey: room.key,
                            checkpoint,
                            clientMessageCount: 0,
                            newMessageLimit: 100,
                        }),
                    ).rejects.toThrow(PermissionDeniedError);
                }
            }
        });

        test("limits the number of new messages when backfilling", async () => {
            const checkpoint = generateServerSynchronizationCheckpoint();

            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint,
                        clientMessageCount: 0,
                        newMessageLimit: 3,
                    }),
                ),
            ).toEqual({
                messageCount: 6,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [],
                },
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint,
                        clientMessageCount: 2,
                        newMessageLimit: 3,
                    }),
                ),
            ).toEqual({
                messageCount: 6,
                newMessages: [
                    {
                        author: await getAccount(
                            context.action(session3),
                            space.id,
                            session3.accountId,
                        ),
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [],
                },
            });
        });

        test("changes are not available for backfill after a certain amount of time", async () => {
            const checkpoint = generateServerSynchronizationCheckpoint();

            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session3), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await updateMessageContent(context.action(session3), {
                roomKey: room.key,
                messageIndex: message3.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("2"))],
            });

            await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("2"))],
            });

            expect(
                massageMessageBackfill(
                    await backfillMessages(context.action(session1), {
                        roomKey: room.key,
                        checkpoint,
                        clientMessageCount: 3,
                        newMessageLimit: 100,
                    }),
                ),
            ).toEqual({
                messageCount: 3,
                newMessages: [],
                messageUpdatesResult: {
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [
                        expect.objectContaining({
                            index: message1.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                        expect.objectContaining({
                            index: message3.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                },
            });

            const originalDateNow = Date.now;
            const mockTime = addDays(checkpoint, messagingEventExpirationDays);
            Date.now = () => mockTime.getTime();

            try {
                expect(
                    massageMessageBackfill(
                        await backfillMessages(context.action(session1), {
                            roomKey: room.key,
                            checkpoint,
                            clientMessageCount: 3,
                            newMessageLimit: 100,
                        }),
                    ),
                ).toEqual({
                    messageCount: 3,
                    newMessages: [],
                    messageUpdatesResult: {type: "Unavailable"},
                });

                expect(
                    massageMessageBackfill(
                        await backfillMessages(context.action(session1), {
                            roomKey: room.key,
                            checkpoint: addMinutes(checkpoint, 5),
                            clientMessageCount: 3,
                            newMessageLimit: 100,
                        }),
                    ),
                ).toEqual({
                    messageCount: 3,
                    newMessages: [],
                    messageUpdatesResult: {
                        type: "Available",
                        checkpoint: expect.any(Date),
                        messages: [],
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: {type: "Message", index: message1.index},
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: {type: "Message", index: message3.index},
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: {type: "Message", index: message3.index},
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: {type: "Message", index: message1.index},
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
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: {type: "Message", index: message1.index},
                content: content3,
                fileIds: [],
            });

            const message4 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: {type: "Message", index: message3.index},
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: {type: "Message", index: message3.index},
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: {type: "Message", index: message1.index},
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("can get message payloads from start", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            const result = await getMessagePayloadsFromStart(context.action(session1), {
                roomKey: room.key,
                limit: 10,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            });

            expect(result.messageCount).toBe(2);
            expect(result.messages).toHaveLength(2);
            expect(result.messages[0]!.payload.content).toEqual(content1);
            expect(result.messages[1]!.payload.content).toEqual(content2);
        });

        test("can get message payloads from end", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            const result = await getMessagePayloadsFromEnd(context.action(session1), {
                roomKey: room.key,
                limit: 10,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            });

            expect(result.messageCount).toBe(2);
            expect(result.messages).toHaveLength(2);
            // FromEnd returns messages in the same order as fromStart (not reversed)
            expect(result.messages[0]!.payload.content).toEqual(content1);
            expect(result.messages[1]!.payload.content).toEqual(content2);
        });

        test("can\u2019t get message payloads for room that doesn\u2019t exist", async () => {
            await expect(
                getMessagePayloadsFromStart(context.action(session1), {
                    roomKey: getMissingRoomKey(),
                    limit: 10,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow();
        });

        test("can\u2019t get message payloads for room in a different space", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                getMessagePayloadsFromStart(context.action(otherSpaceSession), {
                    roomKey: room.key,
                    limit: 10,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow(spacePermissionDeniedErrorMessage);
        });

        test("can\u2019t get message payloads for anonymous actor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                getMessagePayloadsFromStart(context.anonymousAction(), {
                    roomKey: room.key,
                    limit: 10,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow();
        });

        test("can get message payloads from start with limit", async () => {
            const room = await createRoom(context.action(session1), space.id);

            // Create 5 messages
            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const result = await getMessagePayloadsFromStart(context.action(session1), {
                roomKey: room.key,
                limit: 2,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            });

            expect(result.messageCount).toBe(3);
            expect(result.messages).toHaveLength(2);
            expect(result.messages[0]!.payload.content).toEqual(content1);
            expect(result.messages[1]!.payload.content).toEqual(content2);
        });

        test("can get message payloads from end with limit", async () => {
            const room = await createRoom(context.action(session1), space.id);

            // Create 3 messages
            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const result = await getMessagePayloadsFromEnd(context.action(session1), {
                roomKey: room.key,
                limit: 2,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            });

            expect(result.messageCount).toBe(3);
            expect(result.messages).toHaveLength(2);
            expect(result.messages[0]!.payload.content).toEqual(content2);
            expect(result.messages[1]!.payload.content).toEqual(content3);
        });

        test("can\u2019t get message payloads from end for room that doesn\u2019t exist", async () => {
            await expect(
                getMessagePayloadsFromEnd(context.action(session1), {
                    roomKey: getMissingRoomKey(),
                    limit: 10,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow();
        });

        test("can\u2019t get message payloads from end for room in a different space", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                getMessagePayloadsFromEnd(context.action(otherSpaceSession), {
                    roomKey: room.key,
                    limit: 10,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow(spacePermissionDeniedErrorMessage);
        });

        test("can\u2019t get message payloads from end for anonymous actor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await expect(
                getMessagePayloadsFromEnd(context.anonymousAction(), {
                    roomKey: room.key,
                    limit: 10,
                    afterMessageIndex: null,
                    beforeMessageIndex: null,
                }),
            ).rejects.toThrow();
        });

        test("can get message payloads from end with after cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const result = await getMessagePayloadsFromEnd(context.action(session1), {
                roomKey: room.key,
                limit: 10,
                afterMessageIndex: message1.index,
                beforeMessageIndex: null,
            });

            expect(result.messageCount).toBe(3);
            expect(result.messages).toHaveLength(2);
            expect(result.messages[0]!.payload.content).toEqual(content2);
            expect(result.messages[1]!.payload.content).toEqual(content3);
        });

        test("can get message payloads from end with before cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const result = await getMessagePayloadsFromEnd(context.action(session1), {
                roomKey: room.key,
                limit: 10,
                afterMessageIndex: null,
                beforeMessageIndex: message2.index,
            });

            expect(result.messageCount).toBe(3);
            expect(result.messages).toHaveLength(1);
            expect(result.messages[0]!.payload.content).toEqual(content1);
        });

        test("can get message payloads from start with after cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const result = await getMessagePayloadsFromStart(context.action(session1), {
                roomKey: room.key,
                limit: 10,
                afterMessageIndex: message1.index,
                beforeMessageIndex: null,
            });

            expect(result.messageCount).toBe(3);
            expect(result.messages).toHaveLength(2);
            expect(result.messages[0]!.payload.content).toEqual(content2);
            expect(result.messages[1]!.payload.content).toEqual(content3);
        });

        test("can get message payloads from start with before cursor", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            const result = await getMessagePayloadsFromStart(context.action(session1), {
                roomKey: room.key,
                limit: 10,
                afterMessageIndex: null,
                beforeMessageIndex: message2.index,
            });

            expect(result.messageCount).toBe(3);
            expect(result.messages).toHaveLength(1);
            expect(result.messages[0]!.payload.content).toEqual(content1);
        });

        test("can\u2019t create message with invalid single message range", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await expect(
                createMessage(context.action(session2), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: 42,
                        startPos: 0,
                        startContentVersion: 0,
                        endIndex: 42,
                        endPos: 4,
                        endContentVersion: 0,
                    },
                    content: content4,
                    fileIds: [],
                }),
            ).rejects.toThrow("Parent messages for range not found");
        });

        test("can\u2019t create message with invalid messages range", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await expect(
                createMessage(context.action(session2), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: 42,
                        startPos: 0,
                        startContentVersion: 0,
                        endIndex: 45,
                        endPos: 2,
                        endContentVersion: 0,
                    },
                    content: content4,
                    fileIds: [],
                }),
            ).rejects.toThrow("Parent messages for range not found");
        });

        test("can\u2019t create message with message range that starts and ends in same deleted message", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
            });

            await expect(
                createMessage(context.action(session2), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: message1.index,
                        startPos: 0,
                        startContentVersion: 0,
                        endIndex: message1.index,
                        endPos: 2,
                        endContentVersion: 0,
                    },
                    content: content4,
                    fileIds: [],
                }),
            ).rejects.toThrow("Message range starts in deleted message");
        });

        test("can\u2019t create message with message range that starts and ends in deleted message", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
            });

            await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message2.index,
            });

            await expect(
                createMessage(context.action(session2), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: message1.index,
                        startPos: 0,
                        startContentVersion: 0,
                        endIndex: message2.index,
                        endPos: 2,
                        endContentVersion: 0,
                    },
                    content: content4,
                    fileIds: [],
                }),
            ).rejects.toThrow("Message range starts in deleted message");
        });

        test("can\u2019t create message with message range that starts in deleted message", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
            });

            await expect(
                createMessage(context.action(session2), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: message1.index,
                        startPos: 0,
                        startContentVersion: 0,
                        endIndex: message2.index,
                        endPos: 2,
                        endContentVersion: 0,
                    },
                    content: content4,
                    fileIds: [],
                }),
            ).rejects.toThrow("Message range starts in deleted message");
        });

        test("can\u2019t create message with message range that ends in deleted message", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await deleteMessage(context.action(session1), {
                roomKey: room.key,
                messageIndex: message2.index,
            });

            await expect(
                createMessage(context.action(session2), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: message1.index,
                        startPos: 0,
                        startContentVersion: 0,
                        endIndex: message2.index,
                        endPos: 2,
                        endContentVersion: 0,
                    },
                    content: content4,
                    fileIds: [],
                }),
            ).rejects.toThrow("Message range ends in deleted message");
        });

        test("can\u2019t create message with message range with an invalid start version", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("4"))],
            });

            await expect(
                createMessage(context.action(session2), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: message1.index,
                        startPos: 0,
                        startContentVersion: 42,
                        endIndex: message1.index,
                        endPos: 2,
                        endContentVersion: 42,
                    },
                    content: content4,
                    fileIds: [],
                }),
            ).rejects.toThrow("Invalid message range start content version");
        });

        test("can\u2019t create message with message range that starts with an invalid start version", async () => {
            const room = await createRoom(context.action(session1), space.id);

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("4"))],
            });

            await expect(
                createMessage(context.action(session2), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: message1.index,
                        startPos: 0,
                        startContentVersion: 42,
                        endIndex: message2.index,
                        endPos: 2,
                        endContentVersion: 0,
                    },
                    content: content4,
                    fileIds: [],
                }),
            ).rejects.toThrow("Invalid message range start content version");
        });

        test("can\u2019t create message with message range that ends with an invalid start version", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("4"))],
            });

            await expect(
                createMessage(context.action(session2), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: message2.index,
                        startPos: 0,
                        startContentVersion: 0,
                        endIndex: message1.index,
                        endPos: 2,
                        endContentVersion: 42,
                    },
                    content: content4,
                    fileIds: [],
                }),
            ).rejects.toThrow("Invalid message range end content version");
        });

        test("can create message with message range parent", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: {
                    type: "MessagesRange",
                    startIndex: message1.index,
                    startPos: 2,
                    startContentVersion: 0,
                    endIndex: message2.index,
                    endPos: 2,
                    endContentVersion: 0,
                },
                content: content4,
                fileIds: [],
            });
        });

        test("can create message with message range parent on start message with later version", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message1.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("4"))],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: {
                    type: "MessagesRange",
                    startIndex: message1.index,
                    startPos: 2,
                    startContentVersion: 1,
                    endIndex: message2.index,
                    endPos: 2,
                    endContentVersion: 0,
                },
                content: content4,
                fileIds: [],
            });
        });

        test("can create message with message range parent on end message with later version", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await updateMessageContent(context.action(session1), {
                roomKey: room.key,
                messageIndex: message2.index,
                contentVersion: 0,
                steps: [new ReplaceStep(5, 6, textSlice("4"))],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: {
                    type: "MessagesRange",
                    startIndex: message1.index,
                    startPos: 2,
                    startContentVersion: 0,
                    endIndex: message2.index,
                    endPos: 2,
                    endContentVersion: 1,
                },
                content: content4,
                fileIds: [],
            });
        });

        test("doesn\u2019t currently check start or end position when creating message with message range parent", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            // NOTE(calebmer): We could check position in the future. Mostly not doing so out
            // of laziness right now since we'd have to map positions that are from different
            // versions.
            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: {
                    type: "MessagesRange",
                    startIndex: message1.index,
                    startPos: 42,
                    startContentVersion: 0,
                    endIndex: message2.index,
                    endPos: 42,
                    endContentVersion: 0,
                },
                content: content4,
                fileIds: [],
            });
        });

        test("can\u2019t create message with message range parent that contains two messages and the last one has a parent", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: {type: "Message", index: message1.index},
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await expect(
                createMessage(context.action(session2), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: message1.index,
                        startPos: 2,
                        startContentVersion: 0,
                        endIndex: message2.index,
                        endPos: 2,
                        endContentVersion: 0,
                    },
                    content: content4,
                    fileIds: [],
                }),
            ).rejects.toThrow("Message range can\u2019t contain message with parent");
        });

        test("can\u2019t create message with message range parent that contains three messages and the middle one has a parent", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: {type: "Message", index: message1.index},
                content: content2,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await expect(
                createMessage(context.action(session2), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: message1.index,
                        startPos: 2,
                        startContentVersion: 0,
                        endIndex: message3.index,
                        endPos: 2,
                        endContentVersion: 0,
                    },
                    content: content1,
                    fileIds: [],
                }),
            ).rejects.toThrow("Message range can\u2019t contain message with parent");
        });

        test("can create message with message range parent that contains two messages and the first one has a parent", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: {type: "Message", index: message1.index},
                content: content2,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: {
                    type: "MessagesRange",
                    startIndex: message2.index,
                    startPos: 2,
                    startContentVersion: 0,
                    endIndex: message3.index,
                    endPos: 2,
                    endContentVersion: 0,
                },
                content: content1,
                fileIds: [],
            });
        });

        test("can\u2019t create message with message range parent that contains two messages and the last one has a different author", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await expect(
                createMessage(context.action(session2), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: message1.index,
                        startPos: 2,
                        startContentVersion: 0,
                        endIndex: message2.index,
                        endPos: 2,
                        endContentVersion: 0,
                    },
                    content: content4,
                    fileIds: [],
                }),
            ).rejects.toThrow("Message range can\u2019t contain messages from different authors");
        });

        test("can\u2019t create message with message range parent that contains three messages and the middle one has a different author", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content4,
                fileIds: [],
            });

            await expect(
                createMessage(context.action(session2), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: message1.index,
                        startPos: 2,
                        startContentVersion: 0,
                        endIndex: message3.index,
                        endPos: 2,
                        endContentVersion: 0,
                    },
                    content: content1,
                    fileIds: [],
                }),
            ).rejects.toThrow("Message range can\u2019t contain messages from different authors");
        });

        test("loading messages from end when a message includes message range parent includes all messages in the range", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: {
                    type: "MessagesRange",
                    startIndex: message1.index,
                    startPos: 2,
                    startContentVersion: 0,
                    endIndex: message2.index,
                    endPos: 2,
                    endContentVersion: 0,
                },
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.action(session1), {
                        roomKey: room.key,
                        limit: 2,
                        afterMessageIndex: null,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 7,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: {
                            type: "MessagesRange",
                            startIndex: message1.index,
                            startPos: 2,
                            startContentVersion: 0,
                            endIndex: message2.index,
                            endPos: 2,
                            endContentVersion: 0,
                        },
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        test("loading messages from start when a message includes message range parent includes all messages in the range", async () => {
            const room = await createRoom(context.action(session1), space.id);

            const message1 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message2 = await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session1), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content1,
                fileIds: [],
            });

            const message3 = await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content2,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: null,
                content: content3,
                fileIds: [],
            });

            await createMessage(context.action(session2), {
                roomKey: room.key,
                parent: {
                    type: "MessagesRange",
                    startIndex: message1.index,
                    startPos: 2,
                    startContentVersion: 0,
                    endIndex: message2.index,
                    endPos: 2,
                    endContentVersion: 0,
                },
                content: content4,
                fileIds: [],
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.action(session1), {
                        roomKey: room.key,
                        limit: 2,
                        afterMessageIndex: message3.index,
                        beforeMessageIndex: null,
                    }),
                ),
            ).toEqual({
                messageCount: 7,
                messages: [
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session2),
                            space.id,
                            session2.accountId,
                        ),
                        parent: {
                            type: "MessagesRange",
                            startIndex: message1.index,
                            startPos: 2,
                            startContentVersion: 0,
                            endIndex: message2.index,
                            endPos: 2,
                            endContentVersion: 0,
                        },
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
                        parent: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: await getAccount(
                            context.action(session1),
                            space.id,
                            session1.accountId,
                        ),
                        parent: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                ],
            });
        });

        describe("streams", () => {
            test("can create stream message as a bot actor", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent("Hello, world!"),
                    fileIds: [],
                    isStream: true,
                });

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [],
                    }),
                );
            });

            test("can\u2019t update stream message", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: content1,
                    fileIds: [],
                    isStream: true,
                });

                await expect(
                    updateMessageContent(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 0,
                        steps: [new ReplaceStep(5, 6, textSlice("2"))],
                    }),
                ).rejects.toThrow(/^Can\u2019t update clerical (message|comment) content$/);
            });

            test("can\u2019t delete stream message", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent("Hello, world!"),
                    fileIds: [],
                    isStream: true,
                });

                await expect(
                    deleteMessage(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }),
                ).rejects.toThrow(/^Can\u2019t delete clerical (messages|comments)$/);
            });

            test("message payload stream is null for non-stream message", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent("Hello, world!"),
                    fileIds: [],
                });

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toBeNull();
            });

            test("can\u2019t create stream message as a session actor", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                await expect(
                    createMessage(session.action(), {
                        roomKey: room.key,
                        parent: null,
                        content: createSimpleMessageContent("Hello, world!"),
                        fileIds: [],
                        isStream: true,
                    }),
                ).rejects.toThrow("Only bots can send `Stream` messages");
            });

            test("can create stream message with empty content", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [],
                    }),
                );
            });

            test("can put stream message part", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can put stream message part with `Create` index as first part", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: "Create",
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can put stream message part with `Create` index as third part", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 1,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 2"),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: "Create",
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 3"),
                    },
                });

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 2"),
                                },
                            },
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 3"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can put stream message part with `Create` index two parts in a row", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 1,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 2"),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: "Create",
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 3"),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: "Create",
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 4"),
                    },
                });

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 2"),
                                },
                            },
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 3"),
                                },
                            },
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 4"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can\u2019t put stream message part if message isn\u2019t a stream", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                });

                await expect(
                    putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    }),
                ).rejects.toThrow("Message isn\u2019t a stream");
            });

            test("can\u2019t put stream message part if bot is removed from the space", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await space.removeAccount(botAccount);

                await expect(
                    putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    }),
                ).rejects.toThrow(
                    /^(Bot actor doesn\u2019t have access to chat|Account doesn\u2019t have access to space)$/,
                );

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [],
                    }),
                );
            });

            test("can\u2019t put stream stream message part as a bot actor with the wrong scope", async () => {
                const space = await TestSpace.create(context);
                const session1 = await space.createSession({role: "Admin"});
                const session2 = await space.createSession();

                const botAccount = await TestBot.createAndInstantiate(session1);

                const room1 = await actuallyCreatePrivateRoom(context.action(session1), space.id, {
                    insideSessions: [{accountId: session1.account.id}],
                    insideViewerSession: null,
                    insideBotAccount: {accountId: botAccount.id},
                    outsideSession: {accountId: session2.account.id},
                });

                const room2 = await actuallyCreatePrivateRoom(context.action(session2), space.id, {
                    insideSessions: [{accountId: session2.account.id}],
                    insideViewerSession: null,
                    insideBotAccount: {accountId: botAccount.id},
                    outsideSession: {accountId: session1.account.id},
                });

                const message1 = await createMessage(
                    botAccount.action(getRoomBotScope(room1.key)),
                    {
                        roomKey: room1.key,
                        parent: null,
                        content: createSimpleMessageContent(),
                        fileIds: [],
                        isStream: true,
                    },
                );

                await expect(
                    putMessageStreamPart(botAccount.action(getRoomBotScope(room2.key)), {
                        roomKey: room1.key,
                        messageIndex: message1.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    }),
                ).rejects.toThrow(
                    /^(Bot actor doesn\u2019t have access to chat|Actor doesn\u2019t have `(Comment|Edit)` access level)$/,
                );

                expect(
                    await getMessagePayload(session1.action(), {
                        roomKey: room1.key,
                        messageIndex: message1.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [],
                    }),
                );
            });

            test("can\u2019t put stream message part as the wrong bot", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const bot1Account = await TestBot.createAndInstantiate(session);
                const bot2Account = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: bot1Account.id},
                    {accountId: bot2Account.id},
                ]);

                const message = await createMessage(bot1Account.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await expect(
                    putMessageStreamPart(bot2Account.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    }),
                ).rejects.toThrow("Can\u2019t access account that\u2019s not the actor\u2019s");

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [],
                    }),
                );
            });

            test("can put multiple stream message parts", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 1,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 2"),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 2,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 3"),
                    },
                });

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 2"),
                                },
                            },
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 3"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can put the same stream message part multiple times", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 2"),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 3"),
                    },
                });

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 3"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can put the same stream message part after adding other parts multiple times", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 1,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 2"),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 2,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 3"),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 2,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 4"),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 2,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 5"),
                    },
                });

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 2"),
                                },
                            },
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 5"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can\u2019t put a same stream message part that\u2019s not the last part", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 1,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 2"),
                    },
                });

                await expect(
                    putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 3"),
                        },
                    }),
                ).rejects.toThrow(
                    "Only the last part of the stream or the next part can be updated",
                );

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 2"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can complete stream message", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                const {completedTime} = await completeMessageStream(
                    botAccount.action(getRoomBotScope(room.key)),
                    {
                        roomKey: room.key,
                        messageIndex: message.index,
                    },
                );

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can complete stream message with multiple parts", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                const {createdTime: createdTime1} = await putMessageStreamPart(
                    botAccount.action(getRoomBotScope(room.key)),
                    {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    },
                );

                const {createdTime: createdTime2} = await putMessageStreamPart(
                    botAccount.action(getRoomBotScope(room.key)),
                    {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 1,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 2"),
                        },
                    },
                );

                const {createdTime: createdTime3} = await putMessageStreamPart(
                    botAccount.action(getRoomBotScope(room.key)),
                    {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 2,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 3"),
                        },
                    },
                );

                const {completedTime} = await completeMessageStream(
                    botAccount.action(getRoomBotScope(room.key)),
                    {
                        roomKey: room.key,
                        messageIndex: message.index,
                    },
                );

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: createdTime1,
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                            {
                                version: expect.any(Number),
                                createdTime: createdTime2,
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 2"),
                                },
                            },
                            {
                                version: expect.any(Number),
                                createdTime: createdTime3,
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 3"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can\u2019t add more parts after completing stream message", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                const {completedTime} = await completeMessageStream(
                    botAccount.action(getRoomBotScope(room.key)),
                    {
                        roomKey: room.key,
                        messageIndex: message.index,
                    },
                );

                await expect(
                    putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 1,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 2"),
                        },
                    }),
                ).rejects.toThrow("The stream has already been completed");

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can\u2019t update part after completing stream message", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                const {completedTime} = await completeMessageStream(
                    botAccount.action(getRoomBotScope(room.key)),
                    {
                        roomKey: room.key,
                        messageIndex: message.index,
                    },
                );

                await expect(
                    putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 2"),
                        },
                    }),
                ).rejects.toThrow("The stream has already been completed");

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                        ],
                    }),
                );
            });

            describe("approvals", () => {
                const defaultApprovalDecisionOptions: ReadonlyArray<MessageExperimentalApprovalDecisionOption> =
                    [{type: "Approved"}, {type: "Rejected"}];

                function createPendingApprovalsPayload(
                    approvalCount: number,
                    options: ReadonlyArray<MessageExperimentalApprovalDecisionOption> = defaultApprovalDecisionOptions,
                ): MessageStreamExperimentalApprovalsPartPayload {
                    return {
                        type: "ExperimentalApprovals",
                        approvals: createArrayWithLength(approvalCount, approvalIndex => ({
                            summary: createSimpleMessageContent(
                                `Approval request ${approvalIndex + 1}`,
                            ),
                            decision: {schema: {options}},
                        })),
                    };
                }

                function createPendingApprovalPayload(
                    options: ReadonlyArray<MessageExperimentalApprovalDecisionOption> = defaultApprovalDecisionOptions,
                ): MessageStreamExperimentalApprovalsPartPayload {
                    return createPendingApprovalsPayload(1, options);
                }

                async function createMessageWithFinalApprovalPart(
                    approval: MessageStreamExperimentalApprovalsPartPayload = createPendingApprovalPayload(),
                ) {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);
                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent(),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: approval,
                    });

                    const stream = assertExists(
                        (
                            await getMessagePayload(session.action(), {
                                roomKey: room.key,
                                messageIndex: message.index,
                            })
                        ).stream,
                    );

                    return {space, session, botAccount, room, message, approval, stream};
                }

                test("can decide a final approval request after completing stream message", async () => {
                    const {session, botAccount, room, message} =
                        await createMessageWithFinalApprovalPart();
                    await completeMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    });

                    await putMessageApprovalDecisions(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        payload: {
                            type: "ExperimentalDecisions",
                            decisions: [{index: 0, value: {type: "Approved"}}],
                        },
                    });

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => stream),
                    ).toEqual(
                        expect.objectContaining({
                            completedTime: expect.any(Date),
                            parts: [
                                expect.objectContaining({
                                    payload: expect.objectContaining({
                                        approvals: [
                                            expect.objectContaining({
                                                decision: expect.objectContaining({
                                                    value: {
                                                        type: "Approved",
                                                        decider: {
                                                            account: {id: session.account.id},
                                                        },
                                                    },
                                                }),
                                            }),
                                        ],
                                    }),
                                }),
                            ],
                        }),
                    );
                });

                test("can\u2019t decide a final approval request that is already decided", async () => {
                    const {session, room, message} = await createMessageWithFinalApprovalPart();

                    await putMessageApprovalDecisions(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        payload: {
                            type: "ExperimentalDecisions",
                            decisions: [{index: 0, value: {type: "Approved"}}],
                        },
                    });

                    await expect(
                        putMessageApprovalDecisions(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            payload: {
                                type: "ExperimentalDecisions",
                                decisions: [{index: 0, value: {type: "Rejected"}}],
                            },
                        }),
                    ).rejects.toThrow("Approval request has already been decided");
                });

                test("can\u2019t decide approval request with a decision value that isn\u2019t an option", async () => {
                    const approval = createPendingApprovalPayload([{type: "Approved"}]);
                    const {session, room, message} =
                        await createMessageWithFinalApprovalPart(approval);

                    await expect(
                        putMessageApprovalDecisions(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            payload: {
                                type: "ExperimentalDecisions",
                                decisions: [{index: 0, value: {type: "Rejected"}}],
                            },
                        }),
                    ).rejects.toThrow("Invalid approval decision.");
                });

                test("can\u2019t decide approval request if the last stream part is not an approval", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);
                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent(),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    });

                    await expect(
                        putMessageApprovalDecisions(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            payload: {
                                type: "ExperimentalDecisions",
                                decisions: [{index: 0, value: {type: "Approved"}}],
                            },
                        }),
                    ).rejects.toThrow("Approval request not found");
                });

                test("can\u2019t decide approval request if the message is not a stream", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);
                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent(),
                            fileIds: [],
                        },
                    );

                    await expect(
                        putMessageApprovalDecisions(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            payload: {
                                type: "ExperimentalDecisions",
                                decisions: [{index: 0, value: {type: "Approved"}}],
                            },
                        }),
                    ).rejects.toThrow("Message approvals can only be sent with message streams");
                });

                test("can\u2019t decide approval request if the message doesn\u2019t exist", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);
                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);

                    await expect(
                        putMessageApprovalDecisions(session.action(), {
                            roomKey: room.key,
                            messageIndex: 100,
                            payload: {
                                type: "ExperimentalDecisions",
                                decisions: [{index: 0, value: {type: "Approved"}}],
                            },
                        }),
                    ).rejects.toThrow(/not found/);
                });

                describe("batch", () => {
                    test("can decide multiple final approval requests at once", async () => {
                        const approval = createPendingApprovalsPayload(2);
                        const {session, room, message} =
                            await createMessageWithFinalApprovalPart(approval);
                        const approvedDecisionValue: MessageExperimentalApprovalDecisionValue = {
                            type: "Approved",
                            decider: {account: {id: session.account.id}},
                        };
                        const rejectedDecisionValue: MessageExperimentalApprovalDecisionValue = {
                            type: "Rejected",
                            decider: {account: {id: session.account.id}},
                        };

                        const {approvals} = await putMessageApprovalDecisions(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            payload: {
                                type: "ExperimentalDecisions",
                                decisions: [
                                    {index: 0, value: {type: "Approved"}},
                                    {index: 1, value: {type: "Rejected"}},
                                ],
                            },
                        });

                        expect({
                            approvals,
                            stream: await getMessagePayload(session.action(), {
                                roomKey: room.key,
                                messageIndex: message.index,
                            }).then(({stream}) => stream),
                        }).toEqual({
                            approvals: [
                                expect.objectContaining({
                                    decision: expect.objectContaining({
                                        value: approvedDecisionValue,
                                    }),
                                }),
                                expect.objectContaining({
                                    decision: expect.objectContaining({
                                        value: rejectedDecisionValue,
                                    }),
                                }),
                            ],
                            stream: expect.objectContaining({
                                parts: [
                                    expect.objectContaining({
                                        payload: expect.objectContaining({
                                            approvals: [
                                                expect.objectContaining({
                                                    decision: expect.objectContaining({
                                                        value: approvedDecisionValue,
                                                    }),
                                                }),
                                                expect.objectContaining({
                                                    decision: expect.objectContaining({
                                                        value: rejectedDecisionValue,
                                                    }),
                                                }),
                                            ],
                                        }),
                                    }),
                                ],
                            }),
                        });
                    });

                    test("fails if one decision value isn\u2019t an option", async () => {
                        const approval = createPendingApprovalsPayload(2, [{type: "Approved"}]);
                        const {session, botAccount, room, message} =
                            await createMessageWithFinalApprovalPart(approval);

                        await expect(
                            putMessageApprovalDecisions(
                                botAccount.action(getRoomBotScope(room.key)),
                                {
                                    roomKey: room.key,
                                    messageIndex: message.index,
                                    payload: {
                                        type: "ExperimentalDecisions",
                                        decisions: [
                                            {index: 0, value: {type: "Approved"}},
                                            {index: 1, value: {type: "Rejected"}},
                                        ],
                                    },
                                },
                            ),
                        ).rejects.toThrow("Invalid approval decision.");

                        expect(
                            await getMessagePayload(session.action(), {
                                roomKey: room.key,
                                messageIndex: message.index,
                            }).then(({stream}) => stream),
                        ).toEqual(
                            expect.objectContaining({
                                parts: [
                                    expect.objectContaining({
                                        payload: approval,
                                    }),
                                ],
                            }),
                        );
                    });

                    test("fails if one approval is already decided", async () => {
                        const approval = createPendingApprovalsPayload(2);
                        const {session, botAccount, room, message} =
                            await createMessageWithFinalApprovalPart(approval);

                        await putMessageApprovalDecisions(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                messageIndex: message.index,
                                payload: {
                                    type: "ExperimentalDecisions",
                                    decisions: [{index: 0, value: {type: "Approved"}}],
                                },
                            },
                        );

                        const decidedStream = await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => stream);

                        await expect(
                            putMessageApprovalDecisions(
                                botAccount.action(getRoomBotScope(room.key)),
                                {
                                    roomKey: room.key,
                                    messageIndex: message.index,
                                    payload: {
                                        type: "ExperimentalDecisions",
                                        decisions: [
                                            {index: 1, value: {type: "Rejected"}},
                                            {index: 0, value: {type: "Rejected"}},
                                        ],
                                    },
                                },
                            ),
                        ).rejects.toThrow("Approval request has already been decided");

                        expect(
                            await getMessagePayload(session.action(), {
                                roomKey: room.key,
                                messageIndex: message.index,
                            }).then(({stream}) => stream),
                        ).toEqual(decidedStream);
                    });
                });
            });

            test("completing stream message is idempotent", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                const {completedTime: completedTime1} = await completeMessageStream(
                    botAccount.action(getRoomBotScope(room.key)),
                    {
                        roomKey: room.key,
                        messageIndex: message.index,
                    },
                );

                const {completedTime: completedTime2} = await completeMessageStream(
                    botAccount.action(getRoomBotScope(room.key)),
                    {
                        roomKey: room.key,
                        messageIndex: message.index,
                    },
                );

                const {completedTime: completedTime3} = await completeMessageStream(
                    botAccount.action(getRoomBotScope(room.key)),
                    {
                        roomKey: room.key,
                        messageIndex: message.index,
                    },
                );

                expect(completedTime1).toEqual(completedTime2);
                expect(completedTime1).toEqual(completedTime3);

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: completedTime1,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can\u2019t complete stream message part if message isn\u2019t a stream", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                });

                await expect(
                    completeMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }),
                ).rejects.toThrow("Message isn\u2019t a stream");
            });

            test("can\u2019t complete stream message part if bot is removed from the space", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                await space.removeAccount(botAccount);

                await expect(
                    completeMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }),
                ).rejects.toThrow(
                    /^(Bot actor doesn\u2019t have access to chat|Account doesn\u2019t have access to space)$/,
                );

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can\u2019t complete stream stream message part as a bot actor with the wrong scope", async () => {
                const space = await TestSpace.create(context);
                const session1 = await space.createSession({role: "Admin"});
                const session2 = await space.createSession();

                const botAccount = await TestBot.createAndInstantiate(session1);

                const room1 = await actuallyCreatePrivateRoom(context.action(session1), space.id, {
                    insideSessions: [{accountId: session1.account.id}],
                    insideViewerSession: null,
                    insideBotAccount: {accountId: botAccount.id},
                    outsideSession: {accountId: session2.account.id},
                });

                const room2 = await actuallyCreatePrivateRoom(context.action(session2), space.id, {
                    insideSessions: [{accountId: session2.account.id}],
                    insideViewerSession: null,
                    insideBotAccount: {accountId: botAccount.id},
                    outsideSession: {accountId: session1.account.id},
                });

                const message1 = await createMessage(
                    botAccount.action(getRoomBotScope(room1.key)),
                    {
                        roomKey: room1.key,
                        parent: null,
                        content: createSimpleMessageContent(),
                        fileIds: [],
                        isStream: true,
                    },
                );

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room1.key)), {
                    roomKey: room1.key,
                    messageIndex: message1.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                await expect(
                    completeMessageStream(botAccount.action(getRoomBotScope(room2.key)), {
                        roomKey: room1.key,
                        messageIndex: message1.index,
                    }),
                ).rejects.toThrow(
                    /^(Bot actor doesn\u2019t have access to chat|Actor doesn\u2019t have `(Comment|Edit)` access level)$/,
                );

                expect(
                    await getMessagePayload(session1.action(), {
                        roomKey: room1.key,
                        messageIndex: message1.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can\u2019t complete stream message as the wrong bot", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const bot1Account = await TestBot.createAndInstantiate(session);
                const bot2Account = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: bot1Account.id},
                    {accountId: bot2Account.id},
                ]);

                const message = await createMessage(bot1Account.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(bot1Account.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                await expect(
                    completeMessageStream(bot2Account.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }),
                ).rejects.toThrow("Can\u2019t access account that\u2019s not the actor\u2019s");

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can create message with message range parent when message is a stream", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 2"),
                    },
                });

                await completeMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                });

                await createMessage(session.action(), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: message.index,
                        startPos: 10,
                        startContentVersion: 0,
                        endIndex: message.index,
                        endPos: 12,
                        endContentVersion: 0,
                    },
                    content: content2,
                    fileIds: [],
                });
            });

            describe("pagination", () => {
                type ExpectedResult = Array<
                    `Message:${number}` | `StreamMessage:${number}` | `OtherStreamMessage:${number}`
                >;

                const testCases: Record<
                    "FirstMessageIsStream" | "LastMessageIsStream" | "MiddleMessagesAreStreams",
                    Record<
                        "FromStart" | "FromEnd",
                        [
                            {
                                limit: 100;
                                afterMessageIndex: null;
                                beforeMessageIndex: null;
                                expectedResult: ExpectedResult;
                            },
                            {
                                limit: 3;
                                afterMessageIndex: null;
                                beforeMessageIndex: null;
                                expectedResult: ExpectedResult;
                            },
                            {
                                limit: 100;
                                afterMessageIndex: 2;
                                beforeMessageIndex: null;
                                expectedResult: ExpectedResult;
                            },
                            {
                                limit: 100;
                                afterMessageIndex: null;
                                beforeMessageIndex: 3;
                                expectedResult: ExpectedResult;
                            },
                            {
                                limit: 2;
                                afterMessageIndex: 1;
                                beforeMessageIndex: null;
                                expectedResult: ExpectedResult;
                            },
                            {
                                limit: 2;
                                afterMessageIndex: null;
                                beforeMessageIndex: 3;
                                expectedResult: ExpectedResult;
                            },
                        ]
                    >
                > = {
                    FirstMessageIsStream: {
                        FromStart: [
                            {
                                limit: 100,
                                afterMessageIndex: null,
                                beforeMessageIndex: null,
                                expectedResult: [
                                    "StreamMessage:0",
                                    "Message:1",
                                    "Message:2",
                                    "Message:3",
                                    "Message:4",
                                ],
                            },
                            {
                                limit: 3,
                                afterMessageIndex: null,
                                beforeMessageIndex: null,
                                expectedResult: ["StreamMessage:0", "Message:1", "Message:2"],
                            },
                            {
                                limit: 100,
                                afterMessageIndex: 2,
                                beforeMessageIndex: null,
                                expectedResult: ["Message:3", "Message:4"],
                            },
                            {
                                limit: 100,
                                afterMessageIndex: null,
                                beforeMessageIndex: 3,
                                expectedResult: ["StreamMessage:0", "Message:1", "Message:2"],
                            },
                            {
                                limit: 2,
                                afterMessageIndex: 1,
                                beforeMessageIndex: null,
                                expectedResult: ["Message:2", "Message:3"],
                            },
                            {
                                limit: 2,
                                afterMessageIndex: null,
                                beforeMessageIndex: 3,
                                expectedResult: ["StreamMessage:0", "Message:1"],
                            },
                        ],
                        FromEnd: [
                            {
                                limit: 100,
                                afterMessageIndex: null,
                                beforeMessageIndex: null,
                                expectedResult: [
                                    "StreamMessage:0",
                                    "Message:1",
                                    "Message:2",
                                    "Message:3",
                                    "Message:4",
                                ],
                            },
                            {
                                limit: 3,
                                afterMessageIndex: null,
                                beforeMessageIndex: null,
                                expectedResult: ["Message:2", "Message:3", "Message:4"],
                            },
                            {
                                limit: 100,
                                afterMessageIndex: 2,
                                beforeMessageIndex: null,
                                expectedResult: ["Message:3", "Message:4"],
                            },
                            {
                                limit: 100,
                                afterMessageIndex: null,
                                beforeMessageIndex: 3,
                                expectedResult: ["StreamMessage:0", "Message:1", "Message:2"],
                            },
                            {
                                limit: 2,
                                afterMessageIndex: 1,
                                beforeMessageIndex: null,
                                expectedResult: ["Message:3", "Message:4"],
                            },
                            {
                                limit: 2,
                                afterMessageIndex: null,
                                beforeMessageIndex: 3,
                                expectedResult: ["Message:1", "Message:2"],
                            },
                        ],
                    },
                    LastMessageIsStream: {
                        FromStart: [
                            {
                                limit: 100,
                                afterMessageIndex: null,
                                beforeMessageIndex: null,
                                expectedResult: [
                                    "Message:0",
                                    "Message:1",
                                    "Message:2",
                                    "Message:3",
                                    "StreamMessage:4",
                                ],
                            },
                            {
                                limit: 3,
                                afterMessageIndex: null,
                                beforeMessageIndex: null,
                                expectedResult: ["Message:0", "Message:1", "Message:2"],
                            },
                            {
                                limit: 100,
                                afterMessageIndex: 2,
                                beforeMessageIndex: null,
                                expectedResult: ["Message:3", "StreamMessage:4"],
                            },
                            {
                                limit: 100,
                                afterMessageIndex: null,
                                beforeMessageIndex: 3,
                                expectedResult: ["Message:0", "Message:1", "Message:2"],
                            },
                            {
                                limit: 2,
                                afterMessageIndex: 1,
                                beforeMessageIndex: null,
                                expectedResult: ["Message:2", "Message:3"],
                            },
                            {
                                limit: 2,
                                afterMessageIndex: null,
                                beforeMessageIndex: 3,
                                expectedResult: ["Message:0", "Message:1"],
                            },
                        ],
                        FromEnd: [
                            {
                                limit: 100,
                                afterMessageIndex: null,
                                beforeMessageIndex: null,
                                expectedResult: [
                                    "Message:0",
                                    "Message:1",
                                    "Message:2",
                                    "Message:3",
                                    "StreamMessage:4",
                                ],
                            },
                            {
                                limit: 3,
                                afterMessageIndex: null,
                                beforeMessageIndex: null,
                                expectedResult: ["Message:2", "Message:3", "StreamMessage:4"],
                            },
                            {
                                limit: 100,
                                afterMessageIndex: 2,
                                beforeMessageIndex: null,
                                expectedResult: ["Message:3", "StreamMessage:4"],
                            },
                            {
                                limit: 100,
                                afterMessageIndex: null,
                                beforeMessageIndex: 3,
                                expectedResult: ["Message:0", "Message:1", "Message:2"],
                            },
                            {
                                limit: 2,
                                afterMessageIndex: 1,
                                beforeMessageIndex: null,
                                expectedResult: ["Message:3", "StreamMessage:4"],
                            },
                            {
                                limit: 2,
                                afterMessageIndex: null,
                                beforeMessageIndex: 3,
                                expectedResult: ["Message:1", "Message:2"],
                            },
                        ],
                    },
                    MiddleMessagesAreStreams: {
                        FromStart: [
                            {
                                limit: 100,
                                afterMessageIndex: null,
                                beforeMessageIndex: null,
                                expectedResult: [
                                    "Message:0",
                                    "StreamMessage:1",
                                    "Message:2",
                                    "OtherStreamMessage:3",
                                    "Message:4",
                                    "Message:5",
                                ],
                            },
                            {
                                limit: 3,
                                afterMessageIndex: null,
                                beforeMessageIndex: null,
                                expectedResult: ["Message:0", "StreamMessage:1", "Message:2"],
                            },
                            {
                                limit: 100,
                                afterMessageIndex: 2,
                                beforeMessageIndex: null,
                                expectedResult: ["OtherStreamMessage:3", "Message:4", "Message:5"],
                            },
                            {
                                limit: 100,
                                afterMessageIndex: null,
                                beforeMessageIndex: 3,
                                expectedResult: ["Message:0", "StreamMessage:1", "Message:2"],
                            },
                            {
                                limit: 2,
                                afterMessageIndex: 1,
                                beforeMessageIndex: null,
                                expectedResult: ["Message:2", "OtherStreamMessage:3"],
                            },
                            {
                                limit: 2,
                                afterMessageIndex: null,
                                beforeMessageIndex: 3,
                                expectedResult: ["Message:0", "StreamMessage:1"],
                            },
                        ],
                        FromEnd: [
                            {
                                limit: 100,
                                afterMessageIndex: null,
                                beforeMessageIndex: null,
                                expectedResult: [
                                    "Message:0",
                                    "StreamMessage:1",
                                    "Message:2",
                                    "OtherStreamMessage:3",
                                    "Message:4",
                                    "Message:5",
                                ],
                            },
                            {
                                limit: 3,
                                afterMessageIndex: null,
                                beforeMessageIndex: null,
                                expectedResult: ["OtherStreamMessage:3", "Message:4", "Message:5"],
                            },
                            {
                                limit: 100,
                                afterMessageIndex: 2,
                                beforeMessageIndex: null,
                                expectedResult: ["OtherStreamMessage:3", "Message:4", "Message:5"],
                            },
                            {
                                limit: 100,
                                afterMessageIndex: null,
                                beforeMessageIndex: 3,
                                expectedResult: ["Message:0", "StreamMessage:1", "Message:2"],
                            },
                            {
                                limit: 2,
                                afterMessageIndex: 1,
                                beforeMessageIndex: null,
                                expectedResult: ["Message:4", "Message:5"],
                            },
                            {
                                limit: 2,
                                afterMessageIndex: null,
                                beforeMessageIndex: 3,
                                expectedResult: ["StreamMessage:1", "Message:2"],
                            },
                        ],
                    },
                };

                for (const [scenario, testCases2] of getObjectEntriesWithKeyofType(testCases)) {
                    for (const [direction, testCases3] of getObjectEntriesWithKeyofType(
                        testCases2,
                    )) {
                        for (const {
                            limit,
                            afterMessageIndex,
                            beforeMessageIndex,
                            expectedResult,
                        } of testCases3) {
                            test(
                                // eslint-disable-next-line jest/valid-title
                                quote`${scenario}, ${direction}, \`limit\` = ${limit}, \`afterMessageIndex\` = ${afterMessageIndex}, \`beforeMessageIndex\` = ${beforeMessageIndex}`,
                                async () => {
                                    const space = await TestSpace.create(context);
                                    const session = await space.createSession({role: "Admin"});

                                    const botAccount = await TestBot.createAndInstantiate(session);

                                    const room = await actuallyCreateRoom(
                                        context.action(session),
                                        space.id,
                                        [
                                            {accountId: session.account.id},
                                            {accountId: botAccount.id},
                                        ],
                                    );

                                    let streamMessageCompletedTime: Date | null = null;
                                    let otherStreamMessageCompletedTime: Date | null = null;

                                    switch (scenario) {
                                        case "FirstMessageIsStream": {
                                            const streamMessage = await createMessage(
                                                botAccount.action(getRoomBotScope(room.key)),
                                                {
                                                    roomKey: room.key,
                                                    parent: null,
                                                    content: createSimpleMessageContent(),
                                                    fileIds: [],
                                                    isStream: true,
                                                },
                                            );

                                            for (let i = 0; i < 3; i++) {
                                                await putMessageStreamPart(
                                                    botAccount.action(getRoomBotScope(room.key)),
                                                    {
                                                        roomKey: room.key,
                                                        messageIndex: streamMessage.index,
                                                        partIndex: i,
                                                        payload: {
                                                            type: "Content",
                                                            content: createSimpleMessageContent(
                                                                `Test part ${i + 1}`,
                                                            ),
                                                        },
                                                    },
                                                );
                                            }

                                            ({completedTime: streamMessageCompletedTime} =
                                                await completeMessageStream(
                                                    botAccount.action(getRoomBotScope(room.key)),
                                                    {
                                                        roomKey: room.key,
                                                        messageIndex: streamMessage.index,
                                                    },
                                                ));

                                            for (let i = 0; i < 4; i++) {
                                                await createMessage(session.action(), {
                                                    roomKey: room.key,
                                                    parent: null,
                                                    content: createSimpleMessageContent(
                                                        `Test message ${i + 1}`,
                                                    ),
                                                    fileIds: [],
                                                });
                                            }
                                            break;
                                        }
                                        case "LastMessageIsStream": {
                                            for (let i = 0; i < 4; i++) {
                                                await createMessage(session.action(), {
                                                    roomKey: room.key,
                                                    parent: null,
                                                    content: createSimpleMessageContent(
                                                        `Test message ${i + 1}`,
                                                    ),
                                                    fileIds: [],
                                                });
                                            }

                                            const streamMessage = await createMessage(
                                                botAccount.action(getRoomBotScope(room.key)),
                                                {
                                                    roomKey: room.key,
                                                    parent: null,
                                                    content: createSimpleMessageContent(),
                                                    fileIds: [],
                                                    isStream: true,
                                                },
                                            );

                                            for (let i = 0; i < 3; i++) {
                                                await putMessageStreamPart(
                                                    botAccount.action(getRoomBotScope(room.key)),
                                                    {
                                                        roomKey: room.key,
                                                        messageIndex: streamMessage.index,
                                                        partIndex: i,
                                                        payload: {
                                                            type: "Content",
                                                            content: createSimpleMessageContent(
                                                                `Test part ${i + 1}`,
                                                            ),
                                                        },
                                                    },
                                                );
                                            }

                                            ({completedTime: streamMessageCompletedTime} =
                                                await completeMessageStream(
                                                    botAccount.action(getRoomBotScope(room.key)),
                                                    {
                                                        roomKey: room.key,
                                                        messageIndex: streamMessage.index,
                                                    },
                                                ));
                                            break;
                                        }
                                        case "MiddleMessagesAreStreams": {
                                            for (let i = 0; i < 1; i++) {
                                                await createMessage(session.action(), {
                                                    roomKey: room.key,
                                                    parent: null,
                                                    content: createSimpleMessageContent(
                                                        `Test message ${i + 1}`,
                                                    ),
                                                    fileIds: [],
                                                });
                                            }

                                            const streamMessage = await createMessage(
                                                botAccount.action(getRoomBotScope(room.key)),
                                                {
                                                    roomKey: room.key,
                                                    parent: null,
                                                    content: createSimpleMessageContent(),
                                                    fileIds: [],
                                                    isStream: true,
                                                },
                                            );

                                            for (let i = 0; i < 3; i++) {
                                                await putMessageStreamPart(
                                                    botAccount.action(getRoomBotScope(room.key)),
                                                    {
                                                        roomKey: room.key,
                                                        messageIndex: streamMessage.index,
                                                        partIndex: i,
                                                        payload: {
                                                            type: "Content",
                                                            content: createSimpleMessageContent(
                                                                `Test part ${i + 1}`,
                                                            ),
                                                        },
                                                    },
                                                );
                                            }

                                            ({completedTime: streamMessageCompletedTime} =
                                                await completeMessageStream(
                                                    botAccount.action(getRoomBotScope(room.key)),
                                                    {
                                                        roomKey: room.key,
                                                        messageIndex: streamMessage.index,
                                                    },
                                                ));

                                            for (let i = 0; i < 1; i++) {
                                                await createMessage(session.action(), {
                                                    roomKey: room.key,
                                                    parent: null,
                                                    content: createSimpleMessageContent(
                                                        `Test message ${i + 2}`,
                                                    ),
                                                    fileIds: [],
                                                });
                                            }

                                            const otherStreamMessage = await createMessage(
                                                botAccount.action(getRoomBotScope(room.key)),
                                                {
                                                    roomKey: room.key,
                                                    parent: null,
                                                    content: createSimpleMessageContent(),
                                                    fileIds: [],
                                                    isStream: true,
                                                },
                                            );

                                            for (let i = 0; i < 5; i++) {
                                                await putMessageStreamPart(
                                                    botAccount.action(getRoomBotScope(room.key)),
                                                    {
                                                        roomKey: room.key,
                                                        messageIndex: otherStreamMessage.index,
                                                        partIndex: i,
                                                        payload: {
                                                            type: "Content",
                                                            content: createSimpleMessageContent(
                                                                `Test part ${i + 1}`,
                                                            ),
                                                        },
                                                    },
                                                );
                                            }

                                            ({completedTime: otherStreamMessageCompletedTime} =
                                                await completeMessageStream(
                                                    botAccount.action(getRoomBotScope(room.key)),
                                                    {
                                                        roomKey: room.key,
                                                        messageIndex: otherStreamMessage.index,
                                                    },
                                                ));

                                            for (let i = 0; i < 2; i++) {
                                                await createMessage(session.action(), {
                                                    roomKey: room.key,
                                                    parent: null,
                                                    content: createSimpleMessageContent(
                                                        `Test message ${i + 3}`,
                                                    ),
                                                    fileIds: [],
                                                });
                                            }
                                            break;
                                        }
                                        default:
                                            throw exhaustive(scenario);
                                    }

                                    expect(
                                        (direction === "FromEnd"
                                            ? await getMessagePayloadsFromEnd(session.action(), {
                                                  roomKey: room.key,
                                                  limit,
                                                  afterMessageIndex,
                                                  beforeMessageIndex,
                                              })
                                            : await getMessagePayloadsFromStart(session.action(), {
                                                  roomKey: room.key,
                                                  limit,
                                                  afterMessageIndex,
                                                  beforeMessageIndex,
                                              })
                                        ).messages.map(message => {
                                            if (message.stream === null) {
                                                return `Message:${message.index}`;
                                            }

                                            if (
                                                message.stream.completedTime !== null &&
                                                message.stream.completedTime.toJSON() ===
                                                    streamMessageCompletedTime?.toJSON()
                                            ) {
                                                expect(message.stream.parts).toEqual(
                                                    createArrayWithLength(3, i => ({
                                                        version: expect.any(Number),
                                                        createdTime: expect.any(Date),
                                                        payload: {
                                                            type: "Content",
                                                            content: createSimpleMessageContent(
                                                                `Test part ${i + 1}`,
                                                            ),
                                                        },
                                                    })),
                                                );

                                                return `StreamMessage:${message.index}`;
                                            }

                                            if (
                                                message.stream.completedTime !== null &&
                                                message.stream.completedTime.toJSON() ===
                                                    otherStreamMessageCompletedTime?.toJSON()
                                            ) {
                                                expect(message.stream.parts).toEqual(
                                                    createArrayWithLength(5, i => ({
                                                        version: expect.any(Number),
                                                        createdTime: expect.any(Date),
                                                        payload: {
                                                            type: "Content",
                                                            content: createSimpleMessageContent(
                                                                `Test part ${i + 1}`,
                                                            ),
                                                        },
                                                    })),
                                                );

                                                return `OtherStreamMessage:${message.index}`;
                                            }

                                            throw new InternalError("Unrecognized stream message");
                                        }),
                                    ).toEqual(expectedResult);
                                },
                            );
                        }
                    }
                }
            });

            test("putting a stream part update doesn\u2019t change the parts original created time", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent("Hello, world!"),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    const {createdTime: originalCreatedTime} = await putMessageStreamPart(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Test part 1"),
                            },
                        },
                    );

                    const {createdTime: createdTimeAfterUpdate} = await putMessageStreamPart(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Test part 2"),
                            },
                        },
                    );

                    const {createdTime: createdTimeAfterSecondUpdate} = await putMessageStreamPart(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Test part 3"),
                            },
                        },
                    );

                    const {createdTime: originalCreatedTimeForSecondPart} =
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 1,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Test part 3"),
                            },
                        });

                    const {createdTime: createdTimeAfterUpdateForSecondPart} =
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 1,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Test part 4"),
                            },
                        });

                    expect(createdTimeAfterUpdate.getTime()).toEqual(originalCreatedTime.getTime());
                    expect(createdTimeAfterSecondUpdate.getTime()).toEqual(
                        originalCreatedTime.getTime(),
                    );
                    expect(createdTimeAfterUpdateForSecondPart.getTime()).toEqual(
                        originalCreatedTimeForSecondPart.getTime(),
                    );
                });

                expect(
                    sentJobs.filter(
                        ({job}) =>
                            job.type === "IndexSearchEntity" &&
                            (job.update.type.includes("Message") ||
                                job.update.type.includes("Comment")),
                    ),
                ).toEqual([
                    {
                        delaySeconds: 20,
                        job: expect.objectContaining({type: "IndexSearchEntity"}),
                    },
                ]);
            });

            test("new stream message is indexed after a delay", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                    await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        parent: null,
                        content: createSimpleMessageContent("Hello, world!"),
                        fileIds: [],
                        isStream: true,
                    });
                });

                expect(
                    sentJobs.filter(
                        ({job}) =>
                            job.type === "IndexSearchEntity" &&
                            (job.update.type.includes("Message") ||
                                job.update.type.includes("Comment")),
                    ),
                ).toEqual([
                    {
                        delaySeconds: 20,
                        job: expect.objectContaining({type: "IndexSearchEntity"}),
                    },
                ]);
            });

            test("immediately putting a new stream part doesn\u2019t send new index job", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent("Hello, world!"),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    });
                });

                expect(
                    sentJobs.filter(
                        ({job}) =>
                            job.type === "IndexSearchEntity" &&
                            (job.update.type.includes("Message") ||
                                job.update.type.includes("Comment")),
                    ),
                ).toEqual([
                    {
                        delaySeconds: 20,
                        job: expect.objectContaining({type: "IndexSearchEntity"}),
                    },
                ]);
            });

            test("immediately putting multiple stream parts doesn\u2019t send new index job", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent("Hello, world!"),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    });

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 1,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 2"),
                        },
                    });

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 2,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 2"),
                        },
                    });
                });

                expect(
                    sentJobs.filter(
                        ({job}) =>
                            job.type === "IndexSearchEntity" &&
                            (job.update.type.includes("Message") ||
                                job.update.type.includes("Comment")),
                    ),
                ).toEqual([
                    {
                        delaySeconds: 20,
                        job: expect.objectContaining({type: "IndexSearchEntity"}),
                    },
                ]);
            });

            test("immediately putting a stream part update doesn\u2019t send new index job", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent("Hello, world!"),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    });

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 2"),
                        },
                    });

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 3"),
                        },
                    });
                });

                expect(
                    sentJobs.filter(
                        ({job}) =>
                            job.type === "IndexSearchEntity" &&
                            (job.update.type.includes("Message") ||
                                job.update.type.includes("Comment")),
                    ),
                ).toEqual([
                    {
                        delaySeconds: 20,
                        job: expect.objectContaining({type: "IndexSearchEntity"}),
                    },
                ]);
            });

            test("putting new stream part after a delay does send new index job", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                    const originalTime = Date.now();
                    const originalDateNow = Date.now;

                    let currentTime = originalTime;
                    Date.now = () => currentTime;

                    try {
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: null,
                                content: createSimpleMessageContent("Hello, world!"),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Test part 1"),
                            },
                        });

                        currentTime += 3 * 1000;

                        await pingMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        });

                        currentTime += 8 * 1000;

                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 1,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Test part 2"),
                            },
                        });

                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 2,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Test part 2"),
                            },
                        });
                    } finally {
                        Date.now = originalDateNow;
                    }
                });

                expect(
                    sentJobs.filter(
                        ({job}) =>
                            job.type === "IndexSearchEntity" &&
                            (job.update.type.includes("Message") ||
                                job.update.type.includes("Comment")),
                    ),
                ).toEqual([
                    {
                        delaySeconds: 20,
                        job: expect.objectContaining({type: "IndexSearchEntity"}),
                    },
                    {
                        delaySeconds: 20,
                        job: expect.objectContaining({type: "IndexSearchEntity"}),
                    },
                ]);
            });

            test("putting stream part update after a delay does send new index job", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                    const originalTime = Date.now();
                    const originalDateNow = Date.now;

                    let currentTime = originalTime;
                    Date.now = () => currentTime;

                    try {
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: null,
                                content: createSimpleMessageContent("Hello, world!"),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Test part 1"),
                            },
                        });

                        currentTime += 3 * 1000;

                        await pingMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        });

                        currentTime += 8 * 1000;

                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Test part 2"),
                            },
                        });

                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Test part 2"),
                            },
                        });
                    } finally {
                        Date.now = originalDateNow;
                    }
                });

                expect(
                    sentJobs.filter(
                        ({job}) =>
                            job.type === "IndexSearchEntity" &&
                            (job.update.type.includes("Message") ||
                                job.update.type.includes("Comment")),
                    ),
                ).toEqual([
                    {
                        delaySeconds: 20,
                        job: expect.objectContaining({type: "IndexSearchEntity"}),
                    },
                    {
                        delaySeconds: 20,
                        job: expect.objectContaining({type: "IndexSearchEntity"}),
                    },
                ]);
            });

            test("pinging stream after a delay does send new index job", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                    const originalTime = Date.now();
                    const originalDateNow = Date.now;

                    let currentTime = originalTime;
                    Date.now = () => currentTime;

                    try {
                        // Stream created at T0, timeoutTime = T10, indexSearchEntity.jobTime = T20
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: null,
                                content: createSimpleMessageContent("Hello, world!"),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        currentTime += 5 * 1000;

                        // stream updated at T5, timeoutTime = T15, indexSearchEntity.jobTime = T20 (no new
                        // job)
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Test part 1"),
                            },
                        });

                        // stream updated at T11, timeoutTime = T21, indexSearchEntity.jobTime = T31 (new
                        // job is scheduled)
                        currentTime += 6 * 1000;

                        await pingMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        });
                    } finally {
                        Date.now = originalDateNow;
                    }
                });

                expect(
                    sentJobs.filter(
                        ({job}) =>
                            job.type === "IndexSearchEntity" &&
                            (job.update.type.includes("Message") ||
                                job.update.type.includes("Comment")),
                    ),
                ).toEqual([
                    {
                        delaySeconds: 20,
                        job: expect.objectContaining({type: "IndexSearchEntity"}),
                    },
                    {
                        delaySeconds: 20,
                        job: expect.objectContaining({type: "IndexSearchEntity"}),
                    },
                ]);
            });

            test("putting stream part after creation fails if `messageStreamTimeoutMs` has passed", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const originalDateNow = Date.now;
                const originalTime = Date.now();

                let currentTime = originalTime;
                Date.now = () => currentTime;
                try {
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent("Hello, world!"),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    currentTime += messageStreamTimeoutMs + 1000;

                    await expect(
                        putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Test part 1"),
                            },
                        }),
                    ).rejects.toThrow(new FailedPreconditionError("The stream has timed out"));
                } finally {
                    Date.now = originalDateNow;
                }
            });

            test("putting stream part fails after `messageStreamTimeoutMs` limit", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const originalDateNow = Date.now;
                const originalTime = Date.now();

                try {
                    let currentTime = originalTime;
                    Date.now = () => currentTime;

                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent("Hello, world!"),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    });

                    currentTime += messageStreamTimeoutMs + 1000;

                    await expect(
                        putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Test part 2"),
                            },
                        }),
                    ).rejects.toThrow(new FailedPreconditionError("The stream has timed out"));
                } finally {
                    Date.now = originalDateNow;
                }
            });

            test("putting stream part update after `messageStreamTimeoutMs` throws an exception", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const originalDateNow = Date.now;
                const originalTime = Date.now();

                let currentTime = originalTime;
                Date.now = () => currentTime;

                try {
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent("Hello, world!"),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    });

                    currentTime += messageStreamTimeoutMs + 1000;

                    await expect(
                        putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Test part 2"),
                            },
                        }),
                    ).rejects.toThrow(new FailedPreconditionError("The stream has timed out"));
                } finally {
                    Date.now = originalDateNow;
                }
            });

            test("putting timeout error stream part succeeds after `messageStreamTimeoutMs` limit", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const originalDateNow = Date.now;
                const originalTime = Date.now();

                try {
                    let currentTime = originalTime;
                    Date.now = () => currentTime;

                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent("Hello, world!"),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    });

                    currentTime += messageStreamTimeoutMs + 1000;

                    await putMessageStreamPart(space.systemAction(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: "Create",
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Timeout error"),
                        },
                        isTimeoutErrorCompletion: true,
                    });
                } finally {
                    Date.now = originalDateNow;
                }
            });

            test("can't complete stale stream", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const originalDateNow = Date.now;
                const originalTime = Date.now();

                let currentTime = originalTime;
                Date.now = () => currentTime;

                try {
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent("Hello, world!"),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    });

                    currentTime += messageStreamTimeoutMs + 1000;

                    await expect(
                        completeMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }),
                    ).rejects.toThrow(new FailedPreconditionError("The stream has timed out"));
                } finally {
                    Date.now = originalDateNow;
                }
            });

            test("can complete stream message and put new part for timeout error", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                await putMessageStreamPart(space.systemAction(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: "Create",
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Timeout error"),
                    },
                    isTimeoutErrorCompletion: true,
                });

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: expect.any(Date),
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Timeout error"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can\u2019t complete stream message and put part update for timeout error", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                await expect(
                    putMessageStreamPart(space.systemAction(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Timeout error"),
                        },
                        isTimeoutErrorCompletion: true,
                    }),
                ).rejects.toThrow(
                    "Must create a new part when setting `isTimeoutErrorCompletion` to true",
                );

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can\u2019t complete stream message and put new part for timeout error if not system actor", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                await expect(
                    putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: "Create",
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Timeout error"),
                        },
                        isTimeoutErrorCompletion: true,
                    }),
                ).rejects.toThrow("Only system actors can complete a message stream after timeout");

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: null,
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can complete stream message and put new part for timeout error twice (it\u2019s idempotent)", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                await putMessageStreamPart(space.systemAction(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: "Create",
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Timeout error 1"),
                    },
                    isTimeoutErrorCompletion: true,
                });

                await putMessageStreamPart(space.systemAction(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: "Create",
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Timeout error 2"),
                    },
                    isTimeoutErrorCompletion: true,
                });

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: expect.any(Date),
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Timeout error 1"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("can complete stream message with timeout error (noop) after stream has been completed", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Test part 1"),
                    },
                });

                await completeMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                });

                await putMessageStreamPart(space.systemAction(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: "Create",
                    payload: {
                        type: "Content",
                        content: createSimpleMessageContent("Timeout error"),
                    },
                    isTimeoutErrorCompletion: true,
                });

                expect(
                    await getMessagePayload(session.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    }).then(({stream}) => stream),
                ).toEqual(
                    expect.objectContaining({
                        completedTime: expect.any(Date),
                        parts: [
                            {
                                version: expect.any(Number),
                                createdTime: expect.any(Date),
                                payload: {
                                    type: "Content",
                                    content: createSimpleMessageContent("Test part 1"),
                                },
                            },
                        ],
                    }),
                );
            });

            test("ping updates the stream ping time", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const originalTime = Date.now();
                const originalDateNow = Date.now;

                let currentTime = originalTime;
                Date.now = () => currentTime;

                try {
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent(),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(null);

                    currentTime += 5000;

                    await pingMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    });

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(currentTime);

                    currentTime += 5000;

                    await pingMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    });

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(currentTime);
                } finally {
                    Date.now = originalDateNow;
                }
            });

            test("ping updates the stream ping time monotonically", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const originalTime = Date.now();
                const originalDateNow = Date.now;

                let currentTime = originalTime;
                Date.now = () => currentTime;

                try {
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent(),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(null);

                    currentTime += 5000;

                    await pingMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    });

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(currentTime);

                    const lastCurrentTime = currentTime;
                    currentTime -= 1000;

                    await pingMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                    });

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(lastCurrentTime + 1);
                } finally {
                    Date.now = originalDateNow;
                }
            });

            test("putting a new stream part updates the stream ping time", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const originalTime = Date.now();
                const originalDateNow = Date.now;

                let currentTime = originalTime;
                Date.now = () => currentTime;

                try {
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent(),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(null);

                    currentTime += 5000;

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    });

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(currentTime);

                    currentTime += 5000;

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 1,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 2"),
                        },
                    });

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(currentTime);
                } finally {
                    Date.now = originalDateNow;
                }
            });

            test("putting a new stream part updates the stream ping time monotonically", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const originalTime = Date.now();
                const originalDateNow = Date.now;

                let currentTime = originalTime;
                Date.now = () => currentTime;

                try {
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent(),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(null);

                    currentTime += 5000;

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    });

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(currentTime);

                    const lastCurrentTime = currentTime;
                    currentTime -= 1000;

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 1,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 2"),
                        },
                    });

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(lastCurrentTime + 1);
                } finally {
                    Date.now = originalDateNow;
                }
            });

            test("putting an updated stream part updates the stream ping time", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const originalTime = Date.now();
                const originalDateNow = Date.now;

                let currentTime = originalTime;
                Date.now = () => currentTime;

                try {
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent(),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(null);

                    currentTime += 5000;

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    });

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(currentTime);

                    currentTime += 5000;

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 2"),
                        },
                    });

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(currentTime);
                } finally {
                    Date.now = originalDateNow;
                }
            });

            test("putting an updated stream part updates the stream ping time monotonically", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                    {accountId: botAccount.id},
                ]);

                const originalTime = Date.now();
                const originalDateNow = Date.now;

                let currentTime = originalTime;
                Date.now = () => currentTime;

                try {
                    const message = await createMessage(
                        botAccount.action(getRoomBotScope(room.key)),
                        {
                            roomKey: room.key,
                            parent: null,
                            content: createSimpleMessageContent(),
                            fileIds: [],
                            isStream: true,
                        },
                    );

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(null);

                    currentTime += 5000;

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 1"),
                        },
                    });

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(currentTime);

                    const lastCurrentTime = currentTime;
                    currentTime -= 1000;

                    await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        partIndex: 0,
                        payload: {
                            type: "Content",
                            content: createSimpleMessageContent("Test part 2"),
                        },
                    });

                    expect(
                        await getMessagePayload(session.action(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        }).then(({stream}) => assertExists(stream).lastPingTime?.getTime() ?? null),
                    ).toEqual(lastCurrentTime + 1);
                } finally {
                    Date.now = originalDateNow;
                }
            });

            describe("notification events", () => {
                test("sends notification event after first content part finishes", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);

                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);

                    const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: null,
                                content: createSimpleMessageContent(),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        // First content part - notification not sent yet (part in progress)
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("First content"),
                            },
                        });

                        // Second part - this finishes the first content part, triggers notification
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 1,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Second content"),
                            },
                        });
                    });

                    const notificationJobs = sentJobs.filter(
                        ({job}) => job.type === "NotificationEvent",
                    );
                    expect(notificationJobs).toHaveLength(1);
                    expect(notificationJobs[0]?.job).toMatchObject({
                        type: "NotificationEvent",
                        event: expect.objectContaining({
                            contentSnippet: createSimpleMessageContent("First content"),
                        }),
                    });
                });

                test("sends notification event with parent after first content part finishes", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);

                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);

                    const parentMessage = await createMessage(context.action(session), {
                        roomKey: room.key,
                        parent: null,
                        content: createSimpleMessageContent(),
                        fileIds: [],
                    });

                    const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: {
                                    type: "Message",
                                    index: parentMessage.index,
                                },
                                content: createSimpleMessageContent(),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        // First content part - notification not sent yet (part in progress)
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("First content"),
                            },
                        });

                        // Second part - this finishes the first content part, triggers notification
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 1,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Second content"),
                            },
                        });
                    });

                    const notificationJobs = sentJobs.filter(
                        ({job}) => job.type === "NotificationEvent",
                    );
                    expect(notificationJobs).toHaveLength(1);
                    expect(notificationJobs[0]?.job).toMatchObject({
                        type: "NotificationEvent",
                        event: expect.objectContaining({
                            contentSnippet: createSimpleMessageContent("First content"),
                            parent: expect.objectContaining({
                                type: "Message",
                                index: parentMessage.index,
                                author: expect.objectContaining({id: session.account.id}),
                            }),
                        }),
                    });
                });

                test("sends notification event only once even with multiple content parts", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);

                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);

                    const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: null,
                                content: createSimpleMessageContent(),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("First content"),
                            },
                        });

                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 1,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Second content"),
                            },
                        });

                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 2,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Third content"),
                            },
                        });
                    });

                    const notificationJobs = sentJobs.filter(
                        ({job}) => job.type === "NotificationEvent",
                    );
                    expect(notificationJobs).toHaveLength(1);
                });

                test("sends notification event immediately if stream created with non-empty content", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);

                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);

                    const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: null,
                                content: createSimpleMessageContent("Initial content"),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        // Add more parts
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("More content"),
                            },
                        });

                        // Complete stream
                        await completeMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        });
                    });

                    const notificationJobs = sentJobs.filter(
                        ({job}) => job.type === "NotificationEvent",
                    );
                    // Only one notification should be sent at message creation time
                    expect(notificationJobs).toHaveLength(1);
                    expect(notificationJobs[0]?.job).toMatchObject({
                        type: "NotificationEvent",
                        event: expect.objectContaining({
                            contentSnippet: createSimpleMessageContent("Initial content"),
                        }),
                    });
                });

                test("does not send notification when only non-content parts are added", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);

                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);

                    const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: null,
                                content: createSimpleMessageContent(),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        // Add tool call part
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "ToolCall",
                                call: {type: "Search", query: "test query"},
                            },
                        });

                        // Add reasoning part
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 1,
                            payload: {
                                type: "Reasoning",
                                content: createSimpleMessageContent("Thinking..."),
                            },
                        });
                    });

                    const notificationJobs = sentJobs.filter(
                        ({job}) => job.type === "NotificationEvent",
                    );
                    expect(notificationJobs).toHaveLength(0);
                });

                test("sends notification after content part even if non-content parts came first", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);

                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);

                    const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: null,
                                content: createSimpleMessageContent(),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        // Add reasoning part first (no notification)
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Reasoning",
                                content: createSimpleMessageContent("Thinking..."),
                            },
                        });

                        // Add content part (no notification yet - part in progress)
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 1,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("First content"),
                            },
                        });

                        // Add another content part (triggers notification with first content)
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 2,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Second content"),
                            },
                        });
                    });

                    const notificationJobs = sentJobs.filter(
                        ({job}) => job.type === "NotificationEvent",
                    );
                    expect(notificationJobs).toHaveLength(1);
                    expect(notificationJobs[0]?.job).toMatchObject({
                        type: "NotificationEvent",
                        event: expect.objectContaining({
                            contentSnippet: createSimpleMessageContent("First content"),
                        }),
                    });
                });

                test("sends notification on complete when stream has no parts", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);

                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);

                    const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: null,
                                content: createSimpleMessageContent(),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        // Complete stream immediately without adding any parts
                        await completeMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        });
                    });

                    const notificationJobs = sentJobs.filter(
                        ({job}) => job.type === "NotificationEvent",
                    );
                    expect(notificationJobs).toHaveLength(1);
                    expect(notificationJobs[0]?.job).toMatchObject({
                        type: "NotificationEvent",
                        event: expect.objectContaining({
                            contentSnippet: createSimpleMessageContent(),
                        }),
                    });
                });

                test("sends notification on complete when stream only had non-content parts", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);

                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);

                    const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: null,
                                content: createSimpleMessageContent(),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        // Add tool call part
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "ToolCall",
                                call: {type: "Search", query: "test query"},
                            },
                        });

                        // Add reasoning part
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 1,
                            payload: {
                                type: "Reasoning",
                                content: createSimpleMessageContent("Thinking..."),
                            },
                        });

                        // Complete stream
                        await completeMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        });
                    });

                    const notificationJobs = sentJobs.filter(
                        ({job}) => job.type === "NotificationEvent",
                    );
                    expect(notificationJobs).toHaveLength(1);
                    expect(notificationJobs[0]?.job).toMatchObject({
                        type: "NotificationEvent",
                        event: expect.objectContaining({
                            contentSnippet: createSimpleMessageContent(),
                        }),
                    });
                });

                test("sends notification using current content when completing with timeout error on content part", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);

                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);

                    const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: null,
                                content: createSimpleMessageContent(),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        // Use timeout error completion with a Content part
                        await putMessageStreamPart(space.systemAction(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: "Create",
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Timeout content"),
                            },
                            isTimeoutErrorCompletion: true,
                        });
                    });

                    const notificationJobs = sentJobs.filter(
                        ({job}) => job.type === "NotificationEvent",
                    );
                    expect(notificationJobs).toHaveLength(1);
                    expect(notificationJobs[0]?.job).toMatchObject({
                        type: "NotificationEvent",
                        event: expect.objectContaining({
                            contentSnippet: createSimpleMessageContent("Timeout content"),
                        }),
                    });
                });

                test("sends notification using current content when completing with timeout error on content part even when there\u2019s a previous unfinished content part", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);

                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);

                    const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: null,
                                content: createSimpleMessageContent(),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        await putMessageStreamPart(space.systemAction(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: "Create",
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("First content"),
                            },
                        });

                        // Use timeout error completion with a Content part
                        await putMessageStreamPart(space.systemAction(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: "Create",
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Timeout content"),
                            },
                            isTimeoutErrorCompletion: true,
                        });
                    });

                    const notificationJobs = sentJobs.filter(
                        ({job}) => job.type === "NotificationEvent",
                    );
                    expect(notificationJobs).toHaveLength(1);
                    expect(notificationJobs[0]?.job).toMatchObject({
                        type: "NotificationEvent",
                        event: expect.objectContaining({
                            contentSnippet: createSimpleMessageContent("Timeout content"),
                        }),
                    });
                });

                test("doesn\u2019t send notification when completing with timeout error if there was a previous finished content part", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);

                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);

                    const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: null,
                                content: createSimpleMessageContent(),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        await putMessageStreamPart(space.systemAction(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: "Create",
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("First content"),
                            },
                        });

                        await putMessageStreamPart(space.systemAction(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: "Create",
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Second content"),
                            },
                        });

                        // Use timeout error completion with a Content part
                        await putMessageStreamPart(space.systemAction(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: "Create",
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Timeout content"),
                            },
                            isTimeoutErrorCompletion: true,
                        });
                    });

                    const notificationJobs = sentJobs.filter(
                        ({job}) => job.type === "NotificationEvent",
                    );
                    expect(notificationJobs).toHaveLength(1);
                    expect(notificationJobs[0]?.job).toMatchObject({
                        type: "NotificationEvent",
                        event: expect.objectContaining({
                            contentSnippet: createSimpleMessageContent("First content"),
                        }),
                    });
                });

                test("sends notification when completing non-content part with timeout error", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);

                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);

                    const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: null,
                                content: createSimpleMessageContent(),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        // Use timeout error completion with a ToolCall part - no notification is sent
                        // because ToolCall is not a Content part, and notifications only include Content.
                        await putMessageStreamPart(space.systemAction(), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: "Create",
                            payload: {
                                type: "ToolCall",
                                call: {type: "Search", query: "test query"},
                            },
                            isTimeoutErrorCompletion: true,
                        });
                    });

                    const notificationJobs = sentJobs.filter(
                        ({job}) => job.type === "NotificationEvent",
                    );
                    expect(notificationJobs).toHaveLength(1);
                    expect(notificationJobs[0]?.job).toMatchObject({
                        type: "NotificationEvent",
                        event: expect.objectContaining({
                            contentSnippet: createSimpleMessageContent(),
                        }),
                    });
                });

                test("does not send duplicate notifications on stream complete if already sent", async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);

                    const room = await actuallyCreateRoom(context.action(session), space.id, [
                        {accountId: session.account.id},
                        {accountId: botAccount.id},
                    ]);

                    const sentJobs = await TestLocalJobSender.captureSentJobs(async () => {
                        const message = await createMessage(
                            botAccount.action(getRoomBotScope(room.key)),
                            {
                                roomKey: room.key,
                                parent: null,
                                content: createSimpleMessageContent(),
                                fileIds: [],
                                isStream: true,
                            },
                        );

                        // First content part
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 0,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("First content"),
                            },
                        });

                        // Second content part (triggers notification)
                        await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                            partIndex: 1,
                            payload: {
                                type: "Content",
                                content: createSimpleMessageContent("Second content"),
                            },
                        });

                        // Complete stream - should NOT send another notification
                        await completeMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                            roomKey: room.key,
                            messageIndex: message.index,
                        });
                    });

                    const notificationJobs = sentJobs.filter(
                        ({job}) => job.type === "NotificationEvent",
                    );
                    expect(notificationJobs).toHaveLength(1);
                });
            });
        });

        describe("reactions", () => {
            const reaction1: Reaction = {
                character: {type: "Cat", variant: "Grey"},
                emotion: "Celebrate",
            };

            const reaction2: Reaction = {
                character: {type: "Tree", variant: "Green"},
                emotion: "Yes",
            };

            const reaction3: Reaction = {
                character: {type: "Tree", variant: "Pink"},
                emotion: "No",
            };

            const reaction4: Reaction = {
                character: {type: "Yeti", variant: "Blue"},
                emotion: "Happy",
            };

            const reaction5: Reaction = {
                character: {type: "Cat", variant: "Yellow"},
                emotion: "Lolsob",
            };

            const reaction6: Reaction = {
                character: {type: "Yeti", variant: "Olive"},
                emotion: "Shock",
            };

            const getMessageReactionsByPos = async (
                session: TestSession,
                room: {key: RoomKey},
                messageIndex: number,
            ) => {
                const {payload} = await getMessagePayload(session.action(), {
                    roomKey: room.key,
                    messageIndex,
                });
                if (!payload.reactionsByPos) return null;

                return new Map(
                    mapIterable(payload.reactionsByPos, ([pos, reactions]) => [
                        pos,
                        // Since order is important, return maps as arrays from this function.
                        Array.from(reactions.get()),
                    ]),
                );
            };

            test("can add a reaction to first paragraph in message", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 13,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[13, [[session2.account.id, "GenericLike"]]]]),
                );
            });

            test("can add a reaction to second paragraph in message", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[26, [[session2.account.id, "GenericLike"]]]]),
                );
            });

            test("can add a reaction to third paragraph in message", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 39,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[39, [[session2.account.id, "GenericLike"]]]]),
                );
            });

            test("can add a reaction to first, second, and third paragraph in message", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[26, [[session2.account.id, "GenericLike"]]]]),
                );

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 39,
                    reaction: reaction1,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([
                        [26, [[session2.account.id, "GenericLike"]]],
                        [39, [[session2.account.id, reaction1]]],
                    ]),
                );

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 13,
                    reaction: reaction2,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([
                        [13, [[session2.account.id, reaction2]]],
                        [26, [[session2.account.id, "GenericLike"]]],
                        [39, [[session2.account.id, reaction1]]],
                    ]),
                );
            });

            test("can add a reaction to first, second, and third paragraph in message as multiple accounts", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2, session3, session4] = await space.createSessions(4);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                    {accountId: session3.account.id},
                    {accountId: session4.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await setMessageReaction(session3.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[26, [[session3.account.id, "GenericLike"]]]]),
                );

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 39,
                    reaction: reaction1,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([
                        [26, [[session3.account.id, "GenericLike"]]],
                        [39, [[session2.account.id, reaction1]]],
                    ]),
                );

                await setMessageReaction(session4.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: reaction2,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([
                        [
                            26,
                            [
                                [session3.account.id, "GenericLike"],
                                [session4.account.id, reaction2],
                            ],
                        ],
                        [39, [[session2.account.id, reaction1]]],
                    ]),
                );

                await setMessageReaction(session1.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: reaction3,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([
                        [
                            26,
                            [
                                [session3.account.id, "GenericLike"],
                                [session4.account.id, reaction2],
                                [session1.account.id, reaction3],
                            ],
                        ],
                        [39, [[session2.account.id, reaction1]]],
                    ]),
                );

                await setMessageReaction(session3.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 39,
                    reaction: reaction4,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([
                        [
                            26,
                            [
                                [session3.account.id, "GenericLike"],
                                [session4.account.id, reaction2],
                                [session1.account.id, reaction3],
                            ],
                        ],
                        [
                            39,
                            [
                                [session2.account.id, reaction1],
                                [session3.account.id, reaction4],
                            ],
                        ],
                    ]),
                );
            });

            test("can replace own reaction", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[26, [[session2.account.id, "GenericLike"]]]]),
                );

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: reaction1,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[26, [[session2.account.id, reaction1]]]]),
                );
            });

            test("replacing own reaction preserves order in reaction set", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await setMessageReaction(session1.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 13,
                    reaction: "GenericLike",
                });

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 13,
                    reaction: "GenericLike",
                });

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: "GenericLike",
                });

                await setMessageReaction(session1.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([
                        [
                            13,
                            [
                                [session1.account.id, "GenericLike"],
                                [session2.account.id, "GenericLike"],
                            ],
                        ],
                        [
                            26,
                            [
                                [session2.account.id, "GenericLike"],
                                [session1.account.id, "GenericLike"],
                            ],
                        ],
                    ]),
                );

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: reaction1,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([
                        [
                            13,
                            [
                                [session1.account.id, "GenericLike"],
                                [session2.account.id, "GenericLike"],
                            ],
                        ],
                        [
                            26,
                            [
                                [session2.account.id, reaction1],
                                [session1.account.id, "GenericLike"],
                            ],
                        ],
                    ]),
                );
            });

            test("can\u2019t add a reaction to room that doesn\u2019t exist", async () => {
                const space = await TestSpace.create(context);
                const [, session2] = await space.createSessions(2);

                await expect(
                    setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                        roomKey: getMissingRoomKey(),
                        messageIndex: 0,
                        contentVersion: 0,
                        pos: 26,
                        reaction: "GenericLike",
                    }),
                ).rejects.toThrow(/not found/);
            });

            test("can\u2019t add a reaction to message if session doesn\u2019t have access to room", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2, session3] = await space.createSessions(3);

                const room = await actuallyCreatePrivateRoom(context.action(session1), space.id, {
                    insideSessions: [
                        {accountId: session1.account.id},
                        {accountId: session2.account.id},
                    ],
                    insideViewerSession: null,
                    insideBotAccount: null,
                    outsideSession: {accountId: session3.account.id},
                });

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await expect(
                    setMessageReaction(session3.action().clone(createTestPushContextModules()), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 0,
                        pos: 26,
                        reaction: "GenericLike",
                    }),
                ).rejects.toThrow(
                    /^(Account doesn\u2019t have access to chat|Actor doesn\u2019t have `(Comment|Edit)` access level)$/,
                );

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );
            });

            test("can\u2019t add a reaction to deleted message", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                await deleteMessage(session1.action(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                });

                await expect(
                    setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 0,
                        pos: 26,
                        reaction: "GenericLike",
                    }),
                ).rejects.toThrow("Can\u2019t set reaction on messages with a non-content payload");
            });

            test("can\u2019t add a reaction beyond the end of the message", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                await expect(
                    setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 0,
                        pos: 100,
                        reaction: "GenericLike",
                    }),
                ).rejects.toThrow(
                    "Can\u2019t set reaction with position outside the message\u2019s bounds",
                );
            });

            test("can\u2019t add a reaction to position that\u2019s at the end of a block node not after the block node", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await expect(
                    setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 0,
                        pos: 25,
                        reaction: "GenericLike",
                    }),
                ).rejects.toThrow(
                    "Can only set reaction on position immediately after a block node",
                );

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );
            });

            test("can\u2019t add a reaction to position that\u2019s within a block node's content", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await expect(
                    setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 0,
                        pos: 22,
                        reaction: "GenericLike",
                    }),
                ).rejects.toThrow(
                    "Can only set reaction on position immediately after a block node",
                );

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );
            });

            test("can\u2019t add a reaction to position at the start of a block node's content", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await expect(
                    setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 0,
                        pos: 27,
                        reaction: "GenericLike",
                    }),
                ).rejects.toThrow(
                    "Can only set reaction on position immediately after a block node",
                );

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );
            });

            test("can\u2019t add a reaction to position immediately after a nested block node", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("quoteBlock", {}, [
                                schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                                schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            ]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await expect(
                    setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 0,
                        pos: 27,
                        reaction: "GenericLike",
                    }),
                ).rejects.toThrow(
                    "Can only set reaction on position immediately after a block node",
                );

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );
            });

            test("can add a reaction to position immediately after a block node with nested blocks", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("quoteBlock", {}, [
                                schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                                schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            ]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 41,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[41, [[session2.account.id, "GenericLike"]]]]),
                );
            });

            test("can\u2019t add a reaction to position that\u2019s at the start of the message", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await expect(
                    setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 0,
                        pos: 0,
                        reaction: "GenericLike",
                    }),
                ).rejects.toThrow("Can\u2019t set reaction on the content\u2019s start position");

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );
            });

            test("can\u2019t add a reaction to position that\u2019s at the start of the first paragraph", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await expect(
                    setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 0,
                        pos: 1,
                        reaction: "GenericLike",
                    }),
                ).rejects.toThrow(
                    "Can only set reaction on position immediately after a block node",
                );

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );
            });

            test("can add a reaction to second paragraph on content version after update that inserts content", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                await updateMessageContent(session1.action(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    steps: [new ReplaceStep(24, 24, textSlice("TEST "))],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 1,
                    pos: 31,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[31, [[session2.account.id, "GenericLike"]]]]),
                );
            });

            test("can add a reaction to second paragraph on content version before update that inserts content", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                await updateMessageContent(session1.action(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    steps: [new ReplaceStep(24, 24, textSlice("TEST "))],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await expect(
                    setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 1,
                        pos: 26,
                        reaction: "GenericLike",
                    }),
                ).rejects.toThrow(
                    "Can only set reaction on position immediately after a block node",
                );

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[31, [[session2.account.id, "GenericLike"]]]]),
                );
            });

            test("can add a reaction to second paragraph on content version before update that deletes content", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                await updateMessageContent(session1.action(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    steps: [new ReplaceStep(17, 23, textSlice(""))],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await expect(
                    setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 1,
                        pos: 26,
                        reaction: "GenericLike",
                    }),
                ).rejects.toThrow(
                    "Can only set reaction on position immediately after a block node",
                );

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[20, [[session2.account.id, "GenericLike"]]]]),
                );
            });

            test("can\u2019t add a reaction to future content version", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await expect(
                    setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 1,
                        pos: 31,
                        reaction: "GenericLike",
                    }),
                ).rejects.toThrow("Can\u2019t set reaction with future content version");

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );
            });

            test("can\u2019t add a reaction with negative content version", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await expect(
                    setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: -1,
                        pos: 31,
                        reaction: "GenericLike",
                    }),
                ).rejects.toThrow("Can\u2019t set reaction with negative content version");

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );
            });

            test("can add a reaction to first paragraph in stream message", async () => {
                const space = await TestSpace.create(context);
                const session1 = await space.createSession({role: "Admin"});
                const botAccount = await TestBot.createAndInstantiate(session1);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: assertMessageContent(
                            schema.node("doc", {}, [
                                schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            ]),
                        ),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 1,
                    payload: {
                        type: "Content",
                        content: assertMessageContent(
                            schema.node("doc", {}, [
                                schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            ]),
                        ),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 2,
                    payload: {
                        type: "Content",
                        content: assertMessageContent(
                            schema.node("doc", {}, [
                                schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                            ]),
                        ),
                    },
                });

                await completeMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await setMessageReaction(session1.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 13,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[13, [[session1.account.id, "GenericLike"]]]]),
                );
            });

            test("can add a reaction to third paragraph in stream message", async () => {
                const space = await TestSpace.create(context);
                const session1 = await space.createSession({role: "Admin"});
                const botAccount = await TestBot.createAndInstantiate(session1);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: assertMessageContent(
                            schema.node("doc", {}, [
                                schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            ]),
                        ),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 1,
                    payload: {
                        type: "Content",
                        content: assertMessageContent(
                            schema.node("doc", {}, [
                                schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            ]),
                        ),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 2,
                    payload: {
                        type: "Content",
                        content: assertMessageContent(
                            schema.node("doc", {}, [
                                schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                            ]),
                        ),
                    },
                });

                await completeMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await setMessageReaction(session1.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 39,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[39, [[session1.account.id, "GenericLike"]]]]),
                );
            });

            test("can\u2019t add a reaction to the last stream message part if stream isn\u2019t complete", async () => {
                const space = await TestSpace.create(context);
                const session1 = await space.createSession({role: "Admin"});
                const botAccount = await TestBot.createAndInstantiate(session1);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent(),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: assertMessageContent(
                            schema.node("doc", {}, [
                                schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            ]),
                        ),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 1,
                    payload: {
                        type: "Content",
                        content: assertMessageContent(
                            schema.node("doc", {}, [
                                schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            ]),
                        ),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 2,
                    payload: {
                        type: "Content",
                        content: assertMessageContent(
                            schema.node("doc", {}, [
                                schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                            ]),
                        ),
                    },
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await expect(
                    setMessageReaction(session1.action().clone(createTestPushContextModules()), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 0,
                        pos: 39,
                        reaction: "GenericLike",
                    }),
                ).rejects.toThrow(
                    "Can\u2019t set reaction with position outside the message\u2019s bounds",
                );

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );
            });

            test("can add a reaction to third paragraph in stream message if first paragraph has content", async () => {
                const space = await TestSpace.create(context);
                const session1 = await space.createSession({role: "Admin"});
                const botAccount = await TestBot.createAndInstantiate(session1);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: botAccount.id},
                ]);

                const message = await createMessage(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent("Paragraph 1"),
                    fileIds: [],
                    isStream: true,
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: assertMessageContent(
                            schema.node("doc", {}, [
                                schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            ]),
                        ),
                    },
                });

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    partIndex: 1,
                    payload: {
                        type: "Content",
                        content: assertMessageContent(
                            schema.node("doc", {}, [
                                schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                            ]),
                        ),
                    },
                });

                await completeMessageStream(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: message.index,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );

                await setMessageReaction(session1.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 39,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[39, [[session1.account.id, "GenericLike"]]]]),
                );
            });

            test("updating content by adding text moves reaction positions", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[26, [[session2.account.id, "GenericLike"]]]]),
                );

                await updateMessageContent(session1.action(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    steps: [new ReplaceStep(24, 24, textSlice("TEST "))],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[31, [[session2.account.id, "GenericLike"]]]]),
                );
            });

            test("updating content by deleting text moves reaction positions", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[26, [[session2.account.id, "GenericLike"]]]]),
                );

                await updateMessageContent(session1.action(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    steps: [new ReplaceStep(17, 23, textSlice(""))],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[20, [[session2.account.id, "GenericLike"]]]]),
                );
            });

            test("updating content by merging paragraphs merges any reactions between the two paragraphs", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2, session3, session4, session5] =
                    await space.createSessions(5);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                    {accountId: session3.account.id},
                    {accountId: session4.account.id},
                    {accountId: session5.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                await setMessageReaction(session3.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: reaction1,
                });

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: reaction2,
                });

                await setMessageReaction(session4.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: reaction3,
                });

                // Test adding the first paragraph reactions last. They'll appear first in the
                // merged reaction set even though they were added last.
                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 13,
                    reaction: reaction4,
                });

                await setMessageReaction(session1.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 13,
                    reaction: reaction5,
                });

                await setMessageReaction(session5.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 13,
                    reaction: reaction6,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([
                        [
                            13,
                            [
                                [session2.account.id, reaction4],
                                [session1.account.id, reaction5],
                                [session5.account.id, reaction6],
                            ],
                        ],
                        [
                            26,
                            [
                                [session3.account.id, reaction1],
                                [session2.account.id, reaction2],
                                [session4.account.id, reaction3],
                            ],
                        ],
                    ]),
                );

                await updateMessageContent(session1.action(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    steps: [new ReplaceStep(3, 19, textSlice(""))],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([
                        [
                            10,
                            [
                                [session1.account.id, reaction5],
                                [session5.account.id, reaction6],
                                [session3.account.id, reaction1],
                                [session2.account.id, reaction2],
                                [session4.account.id, reaction3],
                            ],
                        ],
                    ]),
                );
            });

            test("can delete a reaction", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 39,
                    reaction: "GenericLike",
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[39, [[session2.account.id, "GenericLike"]]]]),
                );

                await deleteMessageReaction(session2.action(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 39,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );
            });

            test("can delete a single reaction when account has left multiple", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 13,
                    reaction: reaction1,
                });

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: reaction2,
                });

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 39,
                    reaction: reaction3,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([
                        [13, [[session2.account.id, reaction1]]],
                        [26, [[session2.account.id, reaction2]]],
                        [39, [[session2.account.id, reaction3]]],
                    ]),
                );

                await deleteMessageReaction(session2.action(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([
                        [13, [[session2.account.id, reaction1]]],
                        [39, [[session2.account.id, reaction3]]],
                    ]),
                );
            });

            test("can delete a reaction when another account has left a reaction too", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2, session3] = await space.createSessions(3);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                    {accountId: session3.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 13,
                    reaction: reaction1,
                });

                await setMessageReaction(session3.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 13,
                    reaction: reaction2,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([
                        [
                            13,
                            [
                                [session2.account.id, reaction1],
                                [session3.account.id, reaction2],
                            ],
                        ],
                    ]),
                );

                await deleteMessageReaction(session2.action(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 13,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[13, [[session3.account.id, reaction2]]]]),
                );
            });

            test("will rebase a reaction deletion on an old content version", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: reaction1,
                });

                await updateMessageContent(session1.action(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    steps: [new ReplaceStep(24, 24, textSlice("TEST "))],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[31, [[session2.account.id, reaction1]]]]),
                );

                await deleteMessageReaction(session2.action(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map(),
                );
            });

            test("must get the position right if deleting a reaction on the current content version", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 26,
                    reaction: reaction1,
                });

                await updateMessageContent(session1.action(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    steps: [new ReplaceStep(24, 24, textSlice("TEST "))],
                });

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[31, [[session2.account.id, reaction1]]]]),
                );

                await expect(
                    deleteMessageReaction(session2.action(), {
                        roomKey: room.key,
                        messageIndex: message.index,
                        contentVersion: 1,
                        pos: 26,
                    }),
                ).rejects.toThrow(
                    "Can only delete reaction on position immediately after a block node",
                );

                expect(await getMessageReactionsByPos(session1, room, message.index)).toEqual(
                    new Map([[31, [[session2.account.id, reaction1]]]]),
                );
            });

            test("will backfill a message update when adding a reaction", async () => {
                const checkpoint = generateServerSynchronizationCheckpoint();

                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(
                    await backfillMessages(session1.action(), {
                        roomKey: room.key,
                        checkpoint,
                        clientMessageCount: 1,
                        newMessageLimit: 100,
                    }).then(({messageUpdatesResult}) => messageUpdatesResult),
                ).toEqual({
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [],
                });

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 39,
                    reaction: "GenericLike",
                });

                expect(
                    await backfillMessages(session1.action(), {
                        roomKey: room.key,
                        checkpoint,
                        clientMessageCount: 1,
                        newMessageLimit: 100,
                    }).then(({messageUpdatesResult}) => messageUpdatesResult),
                ).toEqual({
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [expect.objectContaining({index: message.index, version: 1})],
                });
            });

            test("will backfill a message update when deleting a reaction", async () => {
                const checkpoint = generateServerSynchronizationCheckpoint();

                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);

                const message = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: assertMessageContent(
                        schema.node("doc", {}, [
                            schema.node("paragraph", {}, [schema.text("Paragraph 1")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 2")]),
                            schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                        ]),
                    ),
                    fileIds: [],
                });

                expect(
                    await backfillMessages(session1.action(), {
                        roomKey: room.key,
                        checkpoint,
                        clientMessageCount: 1,
                        newMessageLimit: 100,
                    }).then(({messageUpdatesResult}) => messageUpdatesResult),
                ).toEqual({
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [],
                });

                await setMessageReaction(session2.action().clone(createTestPushContextModules()), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 39,
                    reaction: "GenericLike",
                });

                expect(
                    await backfillMessages(session1.action(), {
                        roomKey: room.key,
                        checkpoint,
                        clientMessageCount: 1,
                        newMessageLimit: 100,
                    }).then(({messageUpdatesResult}) => messageUpdatesResult),
                ).toEqual({
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [expect.objectContaining({index: message.index, version: 1})],
                });

                await deleteMessageReaction(session2.action(), {
                    roomKey: room.key,
                    messageIndex: message.index,
                    contentVersion: 0,
                    pos: 39,
                });

                expect(
                    await backfillMessages(session1.action(), {
                        roomKey: room.key,
                        checkpoint,
                        clientMessageCount: 1,
                        newMessageLimit: 100,
                    }).then(({messageUpdatesResult}) => messageUpdatesResult),
                ).toEqual({
                    type: "Available",
                    checkpoint: expect.any(Date),
                    messages: [expect.objectContaining({index: message.index, version: 2})],
                });
            });
        });

        describe("getMessageParentContent", () => {
            const doc = (...content: Array<Node>) => schema.nodes.doc.create(null, content);
            const paragraph = (...content: Array<Node>) =>
                schema.nodes.paragraph.create(null, content);
            const text = (string: string, marks?: Array<Mark>) => schema.text(string, marks);

            test("can get content for Message parent type", async () => {
                const space = await TestSpace.create(context);
                const session1 = await space.createSession();
                const session2 = await space.createSession();

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);
                const parentMessage = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent("Parent message content"),
                    fileIds: [],
                });

                const {content, authorId} = await getMessageParentContent(session1.action(), {
                    roomKey: room.key,
                    parent: {type: "Message", index: parentMessage.index},
                });

                expect(content).toEqual(createSimpleMessageContent("Parent message content"));
                expect(authorId).toEqual(session1.account.id);
            });

            test("can get content for Message parent if parent is a Message stream", async () => {
                const space = await TestSpace.create(context);
                const session1 = await space.createSession({role: "Admin"});
                const session2 = await space.createSession();
                const botAccount = await TestBot.createAndInstantiate(session1);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                    {accountId: botAccount.id},
                ]);
                const parentMessage = await createMessage(
                    botAccount.action(getRoomBotScope(room.key)),
                    {
                        roomKey: room.key,
                        parent: null,
                        fileIds: [],
                        isStream: true,
                        content: assertMessageContent(doc(paragraph(text("Paragraph 1")))),
                    },
                );

                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: parentMessage.index,
                    partIndex: 0,
                    payload: {
                        type: "Content",
                        content: assertMessageContent(doc(paragraph(text("Paragraph 2")))),
                    },
                });
                await putMessageStreamPart(botAccount.action(getRoomBotScope(room.key)), {
                    roomKey: room.key,
                    messageIndex: parentMessage.index,
                    partIndex: 1,
                    payload: {
                        type: "Content",
                        content: assertMessageContent(
                            schema.node("doc", {}, [
                                schema.node("paragraph", {}, [schema.text("Paragraph 3")]),
                            ]),
                        ),
                    },
                });

                const {content, authorId} = await getMessageParentContent(session1.action(), {
                    roomKey: room.key,
                    parent: {type: "Message", index: parentMessage.index},
                });

                expect(content).toEqual(
                    doc(
                        paragraph(text("Paragraph 1")),
                        paragraph(text("Paragraph 2")),
                        paragraph(text("Paragraph 3")),
                    ),
                );
                expect(authorId).toEqual(botAccount.id);
            });

            test("can get content for MessagesRange parent type including deleted messages", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                const room = await actuallyCreateRoom(context.action(session1), space.id, [
                    {accountId: session1.account.id},
                    {accountId: session2.account.id},
                ]);
                const message1 = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent("First message in range"),
                    fileIds: [],
                });
                await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent("Second message in range"),
                    fileIds: [],
                });
                const message3 = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent("Third message in range"),
                    fileIds: [],
                });
                const message4 = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent("Fourth message in range"),
                    fileIds: [],
                });

                await deleteMessage(session1.action(), {
                    roomKey: room.key,
                    messageIndex: message3.index,
                });

                const {content, authorId} = await getMessageParentContent(session1.action(), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: message1.index,
                        endIndex: message4.index,
                        startContentVersion: 0,
                        startPos: 0,
                        endContentVersion: 0,
                        endPos: 100,
                    },
                });

                expect(authorId).toEqual(session1.account.id);
                // The content should be truncated and combined from the range
                expect(content).toEqual(
                    doc(
                        paragraph(text("First message in range")),
                        paragraph(text("Second message in range")),
                        paragraph(text(`Deleted ${room.messageNoun}`)),
                        paragraph(text("Fourth message in range")),
                    ),
                );
            });

            test("can get content for MessagesRange parent type including if first and last messages are deleted", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                ]);
                const message1 = await createMessage(session.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent("First message in range"),
                    fileIds: [],
                });
                await createMessage(session.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent("Second message in range"),
                    fileIds: [],
                });
                await createMessage(session.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent("Third message in range"),
                    fileIds: [],
                });
                const message4 = await createMessage(session.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent("Fourth message in range"),
                    fileIds: [],
                });

                await runAllPromises([
                    deleteMessage(session.action(), {
                        roomKey: room.key,
                        messageIndex: message1.index,
                    }),
                    deleteMessage(session.action(), {
                        roomKey: room.key,
                        messageIndex: message4.index,
                    }),
                ]);

                const {content, authorId} = await getMessageParentContent(session.action(), {
                    roomKey: room.key,
                    parent: {
                        type: "MessagesRange",
                        startIndex: message1.index,
                        endIndex: message4.index,
                        startContentVersion: 0,
                        startPos: 0,
                        endContentVersion: 0,
                        endPos: 100,
                    },
                });

                const deletedMessage = paragraph(text(`Deleted ${room.messageNoun}`));

                expect(authorId).toEqual(session.account.id);
                // The content should be truncated and combined from the range
                expect(content).toEqual(
                    doc(
                        deletedMessage,
                        paragraph(text("Second message in range")),
                        paragraph(text("Third message in range")),
                        deletedMessage,
                    ),
                );
            });

            test("throws error when parent message doesn\u2019t exist", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                ]);

                await expect(
                    getMessageParentContent(session.action(), {
                        roomKey: room.key,
                        parent: {type: "Message", index: 999},
                    }),
                ).rejects.toThrow(NotFoundError);
            });

            test("throws error when user doesn\u2019t have access to chat", async () => {
                const space = await TestSpace.create(context);
                const [session1, session2, session3] = await space.createSessions(3);

                const room = await actuallyCreatePrivateRoom(context.action(session1), space.id, {
                    insideSessions: [
                        {accountId: session1.account.id},
                        {accountId: session2.account.id},
                    ],
                    insideViewerSession: null,
                    insideBotAccount: null,
                    outsideSession: {accountId: session3.account.id},
                });
                const parentMessage = await createMessage(session1.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent("Parent message"),
                    fileIds: [],
                });

                await expect(
                    getMessageParentContent(session3.action(), {
                        roomKey: room.key,
                        parent: {type: "Message", index: parentMessage.index},
                    }),
                ).rejects.toThrow(PermissionDeniedError);
            });

            test("returns \u2018Deleted message\u2019 content for deleted Message parent", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();

                const room = await actuallyCreateRoom(context.action(session), space.id, [
                    {accountId: session.account.id},
                ]);
                const parentMessage = await createMessage(session.action(), {
                    roomKey: room.key,
                    parent: null,
                    content: createSimpleMessageContent("This will be deleted"),
                    fileIds: [],
                });
                await deleteMessage(session.action(), {
                    roomKey: room.key,
                    messageIndex: parentMessage.index,
                });

                const {content, authorId} = await getMessageParentContent(session.action(), {
                    roomKey: room.key,
                    parent: {type: "Message", index: parentMessage.index},
                });

                expect(content).toEqual(createSimpleMessageContent(`Deleted ${room.messageNoun}`));
                expect(authorId).toEqual(session.account.id);
            });
        });
    });
}
