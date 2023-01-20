import {RequestContext} from "~/server/dynamo/context/request_context";
import {TestContext} from "~/server/dynamo/test/create_test_context";
import {createTestSession} from "~/server/dynamo/test/create_test_session";
import {createTestSpace} from "~/server/dynamo/test/create_test_space";
import {
    MessageContent,
    assertMessageContent,
    MessageContentProsemirrorSchema as schema,
} from "~/shared/content/message_content_schema";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error";
import {SpaceId} from "~/shared/id/types/id_types";
import {MessageInterface} from "~/shared/models/message_interface";

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
export type MessagingImplementation<RoomKey> = {
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
    createRoom: (context: RequestContext, spaceId: SpaceId) => Promise<RoomInterface<RoomKey>>;

    /**
     * Gets an existing room.
     */
    getRoom: (context: RequestContext, key: RoomKey) => Promise<RoomInterface<RoomKey> | null>;

    /**
     * Get the key for a room that doesn't exist.
     */
    getMissingRoomKey: () => RoomKey;

    /**
     * Create a new message in a room.
     */
    createMessage: (
        context: RequestContext,
        options: {
            roomKey: RoomKey;
            parentMessageId: number | null;
            content: MessageContent;
        },
    ) => Promise<{
        id: number;
        createdTime: Date;
    }>;

    /**
     * Get a message.
     */
    getMessage: (
        context: RequestContext,
        options: {
            roomKey: RoomKey;
            messageId: number;
        },
    ) => Promise<MessageInterface | null>;

    /**
     * Update the content of a message.
     *
     * We will record the time at which the content was updated and show that the
     * message was edited.
     */
    updateMessageContent: (
        context: RequestContext,
        options: {
            roomKey: RoomKey;
            messageId: number;
            content: MessageContent;
        },
    ) => Promise<{
        contentUpdatedTime: Date;
    }>;

    /**
     * Delete a message.
     */
    deleteMessage: (
        context: RequestContext,
        options: {
            roomKey: RoomKey;
            messageId: number;
        },
    ) => Promise<void>;

    /**
     * Load a range of messages starting from the beginning of the room (or
     * starting after a message ID) and loading forwards in time.
     */
    getMessagesFromStart(
        context: RequestContext,
        options: {
            roomKey: RoomKey;
            limit: number;
            afterMessageId: number | null;
        },
    ): Promise<{
        messages: Array<MessageInterface>;
        hasMoreMessagesAfter: boolean;
    }>;

    /**
     * Load a range of messages starting from the end of the room (or
     * starting before a message ID) and loading backwards in time.
     */
    getMessagesFromEnd(
        context: RequestContext,
        options: {
            roomKey: RoomKey;
            limit: number;
            beforeMessageId: number | null;
        },
    ): Promise<{
        messages: Array<MessageInterface>;
        hasMoreMessagesBefore: boolean;
    }>;
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
     * The count of messages in the room. Incremented when we create a message and
     * decremented when we delete a message.
     */
    readonly messageCount: number;
};

export function testMessageImplementation<RoomKey>(
    context: TestContext,
    {
        createRoom,
        getRoom,
        getMissingRoomKey,
        createMessage,
        getMessage,
        getMessagesFromStart,
        getMessagesFromEnd,
        updateMessageContent,
        deleteMessage,
    }: MessagingImplementation<RoomKey>,
) {
    const space = createTestSpace(context);
    const session1 = createTestSession(context, space);
    const session2 = createTestSession(context, space);
    const session3 = createTestSession(context, space);
    const otherSpace = createTestSpace(context);
    const otherSession = createTestSession(context, otherSpace);

    const content1 = assertMessageContent(
        schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("test1")])]),
    );
    const content2 = assertMessageContent(
        schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("test2")])]),
    );
    const content3 = assertMessageContent(
        schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("test3")])]),
    );
    const content4 = assertMessageContent(
        schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("test4")])]),
    );

    function massageMessage(message: MessageInterface | null) {
        if (!message) return null;

        return {
            author: message.author,
            parentMessageId: message.parentMessageId,
            content: message.content,
            hasContentUpdated: message.contentUpdatedTime !== null,
        };
    }

    function massageMessages(result: {messages: Array<MessageInterface>}) {
        return {
            ...result,
            messages: result.messages.map(massageMessage),
        };
    }

    describe("Messaging implementation", () => {
        test("can create room", async () => {
            const room = await createRoom(context.request(session1), space.id);

            expect(room.messageCount).toEqual(0);
        });

        test("can not create room in a space you don't have access to", async () => {
            await expect(createRoom(context.request(session1), otherSpace.id)).rejects.toThrow(
                PermissionDeniedError,
            );
        });

        test("can get room", async () => {
            const room1 = await createRoom(context.request(session1), space.id);

            const room2 = await getRoom(context.request(session1), room1.key);

            expect(room2?.messageCount).toEqual(0);
        });

        test("can not get room in a space you don't have access to", async () => {
            const room1 = await createRoom(context.request(session1), space.id);

            await expect(getRoom(context.request(otherSession), room1.key)).rejects.toThrow(
                PermissionDeniedError,
            );
        });

        test("can create message", async () => {
            const room = await createRoom(context.request(session1), space.id);

            const message = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: null,
                content: content1,
                hasContentUpdated: false,
            });
        });

        test("can create message from a different account", async () => {
            const room = await createRoom(context.request(session1), space.id);

            const message = await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message.id,
                    }),
                ),
            ).toEqual({
                author: session2.account,
                parentMessageId: null,
                content: content1,
                hasContentUpdated: false,
            });
        });

        test("can not create message in a room that doesn't exist", async () => {
            await expect(
                createMessage(context.request(session1), {
                    roomKey: getMissingRoomKey(),
                    parentMessageId: null,
                    content: content1,
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("can not create message in a different space", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await expect(
                createMessage(context.request(otherSession), {
                    roomKey: room.key,
                    parentMessageId: null,
                    content: content1,
                }),
            ).rejects.toThrow(new PermissionDeniedError("Account does not have access to space"));
        });

        test("can not get a message which doesn't exist", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            expect(
                await getMessage(context.request(session1), {roomKey: room.key, messageId: 42}),
            ).toEqual(null);
        });

        test("can not get a message in a different space", async () => {
            const room = await createRoom(context.request(session1), space.id);

            const message = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            await expect(
                getMessage(context.request(otherSession), {
                    roomKey: room.key,
                    messageId: message.id,
                }),
            ).rejects.toEqual(new PermissionDeniedError("Account does not have access to space"));
        });

        test("can create a message with a parent", async () => {
            const room = await createRoom(context.request(session1), space.id);

            const message1 = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            const message2 = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: message1.id,
                content: content2,
            });

            const message3 = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: message2.id,
                content: content3,
            });

            const message4 = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: message2.id,
                content: content4,
            });

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message1.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: null,
                content: content1,
                hasContentUpdated: false,
            });

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message2.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: message1.id,
                content: content2,
                hasContentUpdated: false,
            });

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message3.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: message2.id,
                content: content3,
                hasContentUpdated: false,
            });

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message4.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: message2.id,
                content: content4,
                hasContentUpdated: false,
            });
        });

        test("can not create message with a parent that doesn't exist", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await expect(
                createMessage(context.request(session1), {
                    roomKey: room.key,
                    parentMessageId: 42,
                    content: content1,
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("room keeps track of message count", async () => {
            const room = await createRoom(context.request(session1), space.id);

            expect((await getRoom(context.request(session1), room.key))?.messageCount).toEqual(0);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            expect((await getRoom(context.request(session1), room.key))?.messageCount).toEqual(1);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            expect((await getRoom(context.request(session1), room.key))?.messageCount).toEqual(2);

            const message = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            expect((await getRoom(context.request(session1), room.key))?.messageCount).toEqual(3);

            await deleteMessage(context.request(session1), {
                roomKey: room.key,
                messageId: message.id,
            });

            expect((await getRoom(context.request(session1), room.key))?.messageCount).toEqual(2);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            expect((await getRoom(context.request(session1), room.key))?.messageCount).toEqual(3);
        });

        test("can update message with different content", async () => {
            const room = await createRoom(context.request(session1), space.id);

            const message = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: null,
                content: content1,
                hasContentUpdated: false,
            });

            await updateMessageContent(context.request(session1), {
                roomKey: room.key,
                messageId: message.id,
                content: content2,
            });

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: null,
                content: content2,
                hasContentUpdated: true,
            });
        });

        test("can not update message on room that doesn't exist", async () => {
            await expect(
                updateMessageContent(context.request(session2), {
                    roomKey: getMissingRoomKey(),
                    messageId: 42,
                    content: content2,
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("can not update message that doesn't exist", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await expect(
                updateMessageContent(context.request(session2), {
                    roomKey: room.key,
                    messageId: 42,
                    content: content2,
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("can not update message from different author", async () => {
            const room = await createRoom(context.request(session1), space.id);

            const message = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: null,
                content: content1,
                hasContentUpdated: false,
            });

            await expect(
                updateMessageContent(context.request(session2), {
                    roomKey: room.key,
                    messageId: message.id,
                    content: content2,
                }),
            ).rejects.toThrow(PermissionDeniedError);

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: null,
                content: content1,
                hasContentUpdated: false,
            });
        });

        test("can not update message from different space", async () => {
            const room = await createRoom(context.request(session1), space.id);

            const message = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: null,
                content: content1,
                hasContentUpdated: false,
            });

            await expect(
                updateMessageContent(context.request(otherSession), {
                    roomKey: room.key,
                    messageId: message.id,
                    content: content2,
                }),
            ).rejects.toThrow(new PermissionDeniedError("Account does not have access to space"));

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: null,
                content: content1,
                hasContentUpdated: false,
            });
        });

        test("can delete message", async () => {
            const room = await createRoom(context.request(session1), space.id);

            const message = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: null,
                content: content1,
                hasContentUpdated: false,
            });

            await deleteMessage(context.request(session1), {
                roomKey: room.key,
                messageId: message.id,
            });

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message.id,
                    }),
                ),
            ).toEqual(null);
        });

        test("can not delete message on room that doesn't exist", async () => {
            await expect(
                deleteMessage(context.request(session2), {
                    roomKey: getMissingRoomKey(),
                    messageId: 42,
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("can not delete message that doesn't exist", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await expect(
                deleteMessage(context.request(session2), {
                    roomKey: room.key,
                    messageId: 42,
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("can not delete message from different author", async () => {
            const room = await createRoom(context.request(session1), space.id);

            const message = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: null,
                content: content1,
                hasContentUpdated: false,
            });

            await expect(
                deleteMessage(context.request(session2), {
                    roomKey: room.key,
                    messageId: message.id,
                }),
            ).rejects.toThrow(PermissionDeniedError);

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: null,
                content: content1,
                hasContentUpdated: false,
            });
        });

        test("can not delete message from different space", async () => {
            const room = await createRoom(context.request(session1), space.id);

            const message = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: null,
                content: content1,
                hasContentUpdated: false,
            });

            await expect(
                deleteMessage(context.request(otherSession), {
                    roomKey: room.key,
                    messageId: message.id,
                }),
            ).rejects.toThrow(new PermissionDeniedError("Account does not have access to space"));

            expect(
                massageMessage(
                    await getMessage(context.request(session1), {
                        roomKey: room.key,
                        messageId: message.id,
                    }),
                ),
            ).toEqual({
                author: session1.account,
                parentMessageId: null,
                content: content1,
                hasContentUpdated: false,
            });
        });

        test("can get messages from start", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.request(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageId: null,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesAfter: false,
            });
        });

        test("can get empty messages", async () => {
            const room = await createRoom(context.request(session1), space.id);

            expect(
                massageMessages(
                    await getMessagesFromStart(context.request(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageId: null,
                    }),
                ),
            ).toEqual({
                messages: [],
                hasMoreMessagesAfter: false,
            });
        });

        test("can not get messages for room that doesn't exist", async () => {
            await expect(
                getMessagesFromStart(context.request(session1), {
                    roomKey: getMissingRoomKey(),
                    limit: 100,
                    afterMessageId: null,
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("can not get messages for in a different space", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await expect(
                getMessagesFromStart(context.request(otherSession), {
                    roomKey: room.key,
                    limit: 100,
                    afterMessageId: null,
                }),
            ).rejects.toThrow(new PermissionDeniedError("Account does not have access to space"));
        });

        test("can get messages from start with limit", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.request(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageId: null,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesAfter: true,
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.request(session1), {
                        roomKey: room.key,
                        limit: 5,
                        afterMessageId: null,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesAfter: true,
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.request(session1), {
                        roomKey: room.key,
                        limit: 7,
                        afterMessageId: null,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesAfter: true,
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.request(session1), {
                        roomKey: room.key,
                        limit: 8,
                        afterMessageId: null,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesAfter: false,
            });
        });

        test("can get messages from start with cursor", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            const message2 = await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            const message5 = await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            const message8 = await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.request(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageId: message2.id,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesAfter: false,
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.request(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageId: message5.id,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesAfter: false,
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.request(session1), {
                        roomKey: room.key,
                        limit: 100,
                        afterMessageId: message8.id,
                    }),
                ),
            ).toEqual({
                messages: [],
                hasMoreMessagesAfter: false,
            });
        });

        test("can get messages from start with limit and cursor", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            const message2 = await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            const message5 = await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            const message8 = await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.request(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageId: message2.id,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesAfter: true,
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.request(session1), {
                        roomKey: room.key,
                        limit: 2,
                        afterMessageId: message5.id,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesAfter: true,
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.request(session1), {
                        roomKey: room.key,
                        limit: 3,
                        afterMessageId: message5.id,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesAfter: false,
            });

            expect(
                massageMessages(
                    await getMessagesFromStart(context.request(session1), {
                        roomKey: room.key,
                        limit: 4,
                        afterMessageId: message8.id,
                    }),
                ),
            ).toEqual({
                messages: [],
                hasMoreMessagesAfter: false,
            });
        });

        test("can get messages from end", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.request(session1), {
                        roomKey: room.key,
                        limit: 100,
                        beforeMessageId: null,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesBefore: false,
            });
        });

        test("can get empty messages from end", async () => {
            const room = await createRoom(context.request(session1), space.id);

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.request(session1), {
                        roomKey: room.key,
                        limit: 100,
                        beforeMessageId: null,
                    }),
                ),
            ).toEqual({
                messages: [],
                hasMoreMessagesBefore: false,
            });
        });

        test("can not get messages from end for room that doesn't exist", async () => {
            await expect(
                getMessagesFromEnd(context.request(session1), {
                    roomKey: getMissingRoomKey(),
                    limit: 100,
                    beforeMessageId: null,
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("can not get messages from end for in a different space", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await expect(
                getMessagesFromEnd(context.request(otherSession), {
                    roomKey: room.key,
                    limit: 100,
                    beforeMessageId: null,
                }),
            ).rejects.toThrow(new PermissionDeniedError("Account does not have access to space"));
        });

        test("can get messages from end with limit", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.request(session1), {
                        roomKey: room.key,
                        limit: 3,
                        beforeMessageId: null,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesBefore: true,
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.request(session1), {
                        roomKey: room.key,
                        limit: 5,
                        beforeMessageId: null,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesBefore: true,
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.request(session1), {
                        roomKey: room.key,
                        limit: 7,
                        beforeMessageId: null,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesBefore: true,
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.request(session1), {
                        roomKey: room.key,
                        limit: 8,
                        beforeMessageId: null,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesBefore: false,
            });
        });

        test("can get messages from end with cursor", async () => {
            const room = await createRoom(context.request(session1), space.id);

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            const message2 = await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            const message5 = await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            const message8 = await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.request(session1), {
                        roomKey: room.key,
                        limit: 100,
                        beforeMessageId: message2.id,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesBefore: false,
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.request(session1), {
                        roomKey: room.key,
                        limit: 100,
                        beforeMessageId: message5.id,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesBefore: false,
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.request(session1), {
                        roomKey: room.key,
                        limit: 100,
                        beforeMessageId: message8.id,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content4,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesBefore: false,
            });
        });

        test("can get messages from before with limit and cursor", async () => {
            const room = await createRoom(context.request(session1), space.id);

            const message1 = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            const message4 = await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content3,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content1,
            });

            const message6 = await createMessage(context.request(session3), {
                roomKey: room.key,
                parentMessageId: null,
                content: content2,
            });

            await createMessage(context.request(session1), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            await createMessage(context.request(session2), {
                roomKey: room.key,
                parentMessageId: null,
                content: content4,
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.request(session1), {
                        roomKey: room.key,
                        limit: 3,
                        beforeMessageId: message6.id,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesBefore: true,
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.request(session1), {
                        roomKey: room.key,
                        limit: 2,
                        beforeMessageId: message4.id,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesBefore: true,
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.request(session1), {
                        roomKey: room.key,
                        limit: 3,
                        beforeMessageId: message4.id,
                    }),
                ),
            ).toEqual({
                messages: [
                    {
                        author: session1.account,
                        parentMessageId: null,
                        content: content1,
                        hasContentUpdated: false,
                    },
                    {
                        author: session2.account,
                        parentMessageId: null,
                        content: content2,
                        hasContentUpdated: false,
                    },
                    {
                        author: session3.account,
                        parentMessageId: null,
                        content: content3,
                        hasContentUpdated: false,
                    },
                ],
                hasMoreMessagesBefore: false,
            });

            expect(
                massageMessages(
                    await getMessagesFromEnd(context.request(session1), {
                        roomKey: room.key,
                        limit: 4,
                        beforeMessageId: message1.id,
                    }),
                ),
            ).toEqual({
                messages: [],
                hasMoreMessagesBefore: false,
            });
        });
    });
}
