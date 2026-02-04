import {TestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {printApiContentToMarkdown} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {TestBot, TestBotAccount} from "~/server/bots/test_helpers/test_bot.js";
import {SearchInjection} from "~/server/context/injection_context_module.js";
import {messageStreamTimeoutMs} from "~/server/messaging/helpers/message_stream_timeout_ms.js";
import {TestMessagingRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {ApiMessageRoomPath} from "~/shared/api/parse_api_path.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {deserializeDateString, serializeDateString} from "~/shared/helpers/date/date_string.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";

const knownTaskId = generateId<TaskId>();
const privateTaskId = generateId<TaskId>();
const deletedTaskId = generateId<TaskId>();

export const testMessagingApiImplementationSearchInjection: Partial<SearchInjection> = {
    getSearchMentionEntityIfPossible: async (context, spaceId, entityId) => {
        if (entityId === `Task:${knownTaskId}`) {
            return {
                isPrivate: false,
                entity: new SearchEntityModel({
                    id: entityId,
                    title: "Some bug",
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            };
        }

        if (entityId === `Task:${privateTaskId}`) {
            return {
                isPrivate: true,
            };
        }

        if (entityId === `Task:${deletedTaskId}`) {
            return {
                isPrivate: false,
                entity: new SearchEntityModel({
                    id: entityId,
                    title: null,
                    titleVersion: {type: "Integer", version: 0},
                    media: null,
                }),
            };
        }

        return null;
    },
};

export function testMessagingApiImplementation(
    context: TestContext,
    server: TestApiServer,
    {
        generateMissingRoomPath,
        createPrivateRoom,
    }: {
        generateMissingRoomPath: () => ApiMessageRoomPath;
        createPrivateRoom: (
            session: TestSpaceSession,
            botAccount: TestBotAccount,
        ) => Promise<{
            roomPath: ApiMessageRoomPath;
            room: TestMessagingRoomBase;
            initialMessageCount: number;
        }>;
    },
) {
    describe("Messaging implementation", () => {
        test("can read message", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({name: "John Smith", role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session,
                "Hello, world!",
            );

            const response = await server.GET(`${roomPath}/messages/${message.index}`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        author: expect.objectContaining({
                            id: session.account.id,
                            name: "John Smith",
                        }),
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });

        test("can\u2019t read message in room bot doesn\u2019t have access to", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession({role: "Admin"});
            const session2 = await space.createSession();

            const botAccount = await TestBot.createAndInstantiate(session1);
            const apiKey = await botAccount.createApiKey(session1);

            const {roomPath, room} = await createPrivateRoom(session2, botAccount);

            const message = await TestMessagingRoomBase.createMessage(room, session2);

            expect(
                await server.GET(`${roomPath}/messages/${message.index}`, {
                    headers: {authorization: `bearer ${apiKey}`},
                }),
            ).toEqual({
                status: 403,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: {
                    error: expect.objectContaining({
                        message: expect.stringMatching(
                            /(don\u2019t have access|You aren\u2019t allowed)/,
                        ),
                    }),
                },
            });
        });

        test("can\u2019t read message from room that doesn\u2019t exist", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            expect(
                await server.GET(`${generateMissingRoomPath()}/messages/0`, {
                    headers: {authorization: `bearer ${apiKey}`},
                }),
            ).toEqual({
                status: 404,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: {
                    error: expect.objectContaining({
                        message: expect.stringContaining("doesn\u2019t exist"),
                    }),
                },
            });
        });

        test("can\u2019t read message that doesn\u2019t exist in room", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const message = await TestMessagingRoomBase.createMessage(room, session);

            expect(
                await server.GET(`${roomPath}/messages/${message.index + 1}`, {
                    headers: {authorization: `bearer ${apiKey}`},
                }),
            ).toEqual({
                status: 404,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: {
                    error: expect.objectContaining({
                        message: expect.stringContaining("doesn\u2019t exist"),
                    }),
                },
            });
        });

        test("can read message with room\u2019s scope", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const apiKey = await botAccount.createApiKey(room.getBotScope());

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session,
                "Hello, world!",
            );

            const response = await server.GET(`${roomPath}/messages/${message.index}`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });

        test("can read message with account mention", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession({role: "Admin"});
            const session2 = await space.createSession({name: "Caleb Meredith"});

            const botAccount = await TestBot.createAndInstantiate(session1);
            const apiKey = await botAccount.createApiKey(session1);

            const {roomPath, room} = await createPrivateRoom(session1, botAccount);

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session1,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session2.account.id,
                                    isShort: false,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            const response = await server.GET(`${roomPath}/messages/${message.index}`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual(
                `Hello [Caleb Meredith](https://alpine.inc/s/${space.id}/accounts/${session2.account.id}?mention)\n`,
            );
        });

        test("can read message with short account mention", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession({role: "Admin"});
            const session2 = await space.createSession({name: "Caleb Meredith"});

            const botAccount = await TestBot.createAndInstantiate(session1);
            const apiKey = await botAccount.createApiKey(session1);

            const {roomPath, room} = await createPrivateRoom(session1, botAccount);

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session1,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session2.account.id,
                                    isShort: true,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            const response = await server.GET(`${roomPath}/messages/${message.index}`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual(
                `Hello [Caleb](https://alpine.inc/s/${space.id}/accounts/${session2.account.id}?mention=short)\n`,
            );
        });

        test("can read message with unknown entity mention", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const unknownTaskId = generateId<TaskId>();

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("We need to fix "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "SearchEntity",
                                    entityId: `Task:${unknownTaskId}`,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            const response = await server.GET(`${roomPath}/messages/${message.index}`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual(
                `We need to fix [Unknown task](https://alpine.inc/s/${space.id}/tasks/${unknownTaskId}?mention)\n`,
            );
        });

        test("can read message with known entity mention", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("We need to fix "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "SearchEntity",
                                    entityId: `Task:${knownTaskId}`,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            const response = await server.GET(`${roomPath}/messages/${message.index}`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual(
                `We need to fix [Some bug](https://alpine.inc/s/${space.id}/tasks/${knownTaskId}?mention)\n`,
            );
        });

        test("can read message with private entity mention", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("We need to fix "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "SearchEntity",
                                    entityId: `Task:${privateTaskId}`,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            const response = await server.GET(`${roomPath}/messages/${message.index}`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual(
                `We need to fix [Private task](https://alpine.inc/s/${space.id}/tasks/${privateTaskId}?mention)\n`,
            );
        });

        test("can read message with deleted entity mention", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("We need to fix "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "SearchEntity",
                                    entityId: `Task:${deletedTaskId}`,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            const response = await server.GET(`${roomPath}/messages/${message.index}`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual(
                `We need to fix [Deleted task](https://alpine.inc/s/${space.id}/tasks/${deletedTaskId}?mention)\n`,
            );
        });

        test("can create message", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session, {
                name: "Rosey the Robot",
            });
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const message = await TestMessagingRoomBase.createMessage(room, session);

            const response = await server.POST(`${roomPath}/messages`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Hello, world!"}],
                            },
                        ],
                    },
                },
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index + 1,
                        author: expect.objectContaining({
                            id: botAccount.id,
                            name: "Rosey the Robot",
                            botId: botAccount.bot.id,
                        }),
                        payload: expect.objectContaining({
                            type: "Content",
                        }),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });

        test("can\u2019t send message to room that doesn\u2019t exist", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            expect(
                await server.POST(`${generateMissingRoomPath()}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Hello, world!"}],
                                },
                            ],
                        },
                    },
                }),
            ).toEqual({
                status: 404,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: {
                    error: expect.objectContaining({
                        message: expect.stringContaining("doesn\u2019t exist"),
                    }),
                },
            });
        });

        test("can\u2019t send message to room bot doesn\u2019t have access to", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession({role: "Admin"});
            const session2 = await space.createSession();

            const botAccount = await TestBot.createAndInstantiate(session1);
            const apiKey = await botAccount.createApiKey(session1);

            const {roomPath} = await createPrivateRoom(session2, botAccount);

            expect(
                await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Hello, world!"}],
                                },
                            ],
                        },
                    },
                }),
            ).toEqual({
                status: 403,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: {
                    error: expect.objectContaining({
                        message: expect.stringMatching(
                            /(don\u2019t have access|You aren\u2019t allowed)/,
                        ),
                    }),
                },
            });
        });

        test("can create message with room\u2019s scope", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const apiKey = await botAccount.createApiKey(room.getBotScope());

            const message = await TestMessagingRoomBase.createMessage(room, session);

            const response = await server.POST(`${roomPath}/messages`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Hello, world!"}],
                            },
                        ],
                    },
                },
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index + 1,
                        payload: expect.objectContaining({
                            type: "Content",
                        }),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });

        test("can create message with parent", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session, {
                name: "Rosey the Robot",
            });
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            await TestMessagingRoomBase.createMessage(room, session);
            const message2 = await TestMessagingRoomBase.createMessage(room, session, "foobar");
            await TestMessagingRoomBase.createMessage(room, session);
            const message4 = await TestMessagingRoomBase.createMessage(room, session);

            const response = await server.POST(`${roomPath}/messages`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    parent: {type: "Message", index: message2.index},
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Hello, world!"}],
                            },
                        ],
                    },
                },
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: message4.index + 1,
                        author: expect.objectContaining({
                            id: botAccount.id,
                            name: "Rosey the Robot",
                            botId: botAccount.bot.id,
                        }),
                        payload: expect.objectContaining({
                            type: "Content",
                            parent: expect.objectContaining({
                                type: "Message",
                                index: message2.index,
                                author: expect.objectContaining({id: session.account.id}),
                                contentSnippet: {
                                    isTruncated: false,
                                    elements: [{type: "Text", text: "foobar"}],
                                },
                            }),
                        }),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });

        test("can create message with parent then read it back", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session, {
                name: "Rosey the Robot",
            });
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            await TestMessagingRoomBase.createMessage(room, session);
            const message2 = await TestMessagingRoomBase.createMessage(room, session, "foobar");
            await TestMessagingRoomBase.createMessage(room, session);
            const message4 = await TestMessagingRoomBase.createMessage(room, session);

            await server.POST(`${roomPath}/messages`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    parent: {type: "Message", index: message2.index},
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Hello, world!"}],
                            },
                        ],
                    },
                },
            });

            const response = await server.GET(`${roomPath}/messages/${message4.index + 1}`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: message4.index + 1,
                        author: expect.objectContaining({
                            id: botAccount.id,
                            name: "Rosey the Robot",
                            botId: botAccount.bot.id,
                        }),
                        payload: expect.objectContaining({
                            type: "Content",
                            parent: expect.objectContaining({
                                type: "Message",
                                index: message2.index,
                                author: expect.objectContaining({id: session.account.id}),
                                contentSnippet: {
                                    isTruncated: false,
                                    elements: [{type: "Text", text: "foobar"}],
                                },
                            }),
                        }),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });

        test("can read messages", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({name: "Sarah Smith", role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session,
                "Hello, world!",
            );

            const response = await server.GET(
                `${roomPath}/messages?limit=1&cursor=${message.index - 1}`,
                {headers: {authorization: `bearer ${apiKey}`}},
            );

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            author: expect.objectContaining({
                                id: session.account.id,
                                name: "Sarah Smith",
                            }),
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.messages[0].payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });

        test("can\u2019t read messages in room bot doesn\u2019t have access to", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession({role: "Admin"});
            const session2 = await space.createSession();

            const botAccount = await TestBot.createAndInstantiate(session1);
            const apiKey = await botAccount.createApiKey(session1);

            const {roomPath, room} = await createPrivateRoom(session2, botAccount);

            const message = await TestMessagingRoomBase.createMessage(room, session2);

            expect(
                await server.GET(`${roomPath}/messages?limit=1&cursor=${message.index - 1}`, {
                    headers: {authorization: `bearer ${apiKey}`},
                }),
            ).toEqual({
                status: 403,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: {
                    error: expect.objectContaining({
                        message: expect.stringMatching(
                            /(don\u2019t have access|You aren\u2019t allowed)/,
                        ),
                    }),
                },
            });
        });

        test("can\u2019t read messages from room that doesn\u2019t exist", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            expect(
                await server.GET(`${generateMissingRoomPath()}/messages?limit=1`, {
                    headers: {authorization: `bearer ${apiKey}`},
                }),
            ).toEqual({
                status: 404,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: {
                    error: expect.objectContaining({
                        message: expect.stringContaining("doesn\u2019t exist"),
                    }),
                },
            });
        });

        test("can read messages with room\u2019s scope", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const apiKey = await botAccount.createApiKey(room.getBotScope());

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session,
                "Hello, world!",
            );

            const response = await server.GET(
                `${roomPath}/messages?limit=1&cursor=${message.index - 1}`,
                {headers: {authorization: `bearer ${apiKey}`}},
            );

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.messages[0].payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });

        test("can read messages with account mention", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession({role: "Admin"});
            const session2 = await space.createSession({name: "Caleb Meredith"});

            const botAccount = await TestBot.createAndInstantiate(session1);
            const apiKey = await botAccount.createApiKey(session1);

            const {roomPath, room} = await createPrivateRoom(session1, botAccount);

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session1,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session2.account.id,
                                    isShort: false,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            const response = await server.GET(
                `${roomPath}/messages?limit=1&cursor=${message.index - 1}`,
                {headers: {authorization: `bearer ${apiKey}`}},
            );

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.messages[0].payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual(
                `Hello [Caleb Meredith](https://alpine.inc/s/${space.id}/accounts/${session2.account.id}?mention)\n`,
            );
        });

        test("can read messages with short account mention", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession({role: "Admin"});
            const session2 = await space.createSession({name: "Caleb Meredith"});

            const botAccount = await TestBot.createAndInstantiate(session1);
            const apiKey = await botAccount.createApiKey(session1);

            const {roomPath, room} = await createPrivateRoom(session1, botAccount);

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session1,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session2.account.id,
                                    isShort: true,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            const response = await server.GET(
                `${roomPath}/messages?limit=1&cursor=${message.index - 1}`,
                {headers: {authorization: `bearer ${apiKey}`}},
            );

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.messages[0].payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual(
                `Hello [Caleb](https://alpine.inc/s/${space.id}/accounts/${session2.account.id}?mention=short)\n`,
            );
        });

        test("can read messages with unknown entity mention", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const unknownTaskId = generateId<TaskId>();

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("We need to fix "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "SearchEntity",
                                    entityId: `Task:${unknownTaskId}`,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            const response = await server.GET(
                `${roomPath}/messages?limit=1&cursor=${message.index - 1}`,
                {headers: {authorization: `bearer ${apiKey}`}},
            );

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.messages[0].payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual(
                `We need to fix [Unknown task](https://alpine.inc/s/${space.id}/tasks/${unknownTaskId}?mention)\n`,
            );
        });

        test("can read messages with known entity mention", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("We need to fix "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "SearchEntity",
                                    entityId: `Task:${knownTaskId}`,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            const response = await server.GET(
                `${roomPath}/messages?limit=1&cursor=${message.index - 1}`,
                {headers: {authorization: `bearer ${apiKey}`}},
            );

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.messages[0].payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual(
                `We need to fix [Some bug](https://alpine.inc/s/${space.id}/tasks/${knownTaskId}?mention)\n`,
            );
        });

        test("can read messages with private entity mention", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("We need to fix "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "SearchEntity",
                                    entityId: `Task:${privateTaskId}`,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            const response = await server.GET(
                `${roomPath}/messages?limit=1&cursor=${message.index - 1}`,
                {headers: {authorization: `bearer ${apiKey}`}},
            );

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.messages[0].payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual(
                `We need to fix [Private task](https://alpine.inc/s/${space.id}/tasks/${privateTaskId}?mention)\n`,
            );
        });

        test("can read messages with deleted entity mention", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("We need to fix "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "SearchEntity",
                                    entityId: `Task:${deletedTaskId}`,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            const response = await server.GET(
                `${roomPath}/messages?limit=1&cursor=${message.index - 1}`,
                {headers: {authorization: `bearer ${apiKey}`}},
            );

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.messages[0].payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual(
                `We need to fix [Deleted task](https://alpine.inc/s/${space.id}/tasks/${deletedTaskId}?mention)\n`,
            );
        });

        test("get messages endpoint respects limit parameter", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {
                roomPath,
                room,
                initialMessageCount: count,
            } = await createPrivateRoom(session, botAccount);

            // Create 15 messages
            const messages = [];
            for (let i = 0; i < 15; i++) {
                const message = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    `Message ${i}`,
                );
                messages.push(message);
            }

            // Test with limit=5
            const response = await server.GET(`${roomPath}/messages?limit=5`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response.status).toEqual(200);
            expect(response.headers["content-type"]).toEqual("application/json");

            expect(response.body.messages).toHaveLength(5);
            expect(response.body.totalMessageCount).toBe(count + 15);
            expect(response.body.nextCursor).toBe(4);
        });

        test("get messages endpoint defaults limit to 10", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {
                roomPath,
                room,
                initialMessageCount: count,
            } = await createPrivateRoom(session, botAccount);

            // Create 15 messages
            for (let i = 0; i < 15; i++) {
                await TestMessagingRoomBase.createMessage(room, session, `Message ${i}`);
            }

            // Test without limit parameter - should default to 10
            const response = await server.GET(`${roomPath}/messages`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response.status).toEqual(200);
            expect(response.headers["content-type"]).toEqual("application/json");

            expect(response.body.messages).toHaveLength(10);
            expect(response.body.totalMessageCount).toBe(count + 15);
            expect(response.body.nextCursor).toBe(9);
        });

        test("get messages endpoint supports cursor-based pagination", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            // Create 10 messages
            const messages = [];
            for (let i = 0; i < 10; i++) {
                const message = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    `Message ${i}`,
                );
                messages.push(message);
            }

            // First page: get first 3 messages
            const response1 = await server.GET(`${roomPath}/messages?limit=3`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response1.status).toEqual(200);
            expect(response1.headers["content-type"]).toEqual("application/json");

            expect(response1.body.messages).toHaveLength(3);
            expect(response1.body.messages[0].index).toBe(0);
            expect(response1.body.messages[1].index).toBe(1);
            expect(response1.body.messages[2].index).toBe(2);
            expect(response1.body.nextCursor).toBe(2);

            // Second page: get next 3 messages using cursor
            const response2 = await server.GET(
                `${roomPath}/messages?limit=3&cursor=${response1.body.nextCursor}`,
                {headers: {authorization: `bearer ${apiKey}`}},
            );

            expect(response2.status).toEqual(200);
            expect(response2.headers["content-type"]).toEqual("application/json");

            expect(response2.body.messages).toHaveLength(3);
            expect(response2.body.messages[0].index).toBe(3);
            expect(response2.body.messages[1].index).toBe(4);
            expect(response2.body.messages[2].index).toBe(5);
            expect(response2.body.nextCursor).toBe(5);
        });

        test("get messages endpoint returns null `nextCursor` when at end", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {
                roomPath,
                room,
                initialMessageCount: count,
            } = await createPrivateRoom(session, botAccount);

            // Create 5 messages
            for (let i = 0; i < 5; i++) {
                await TestMessagingRoomBase.createMessage(room, session, `Message ${i}`);
            }

            // Get all messages with limit=10 - should return all 5 with null nextCursor
            const response = await server.GET(`${roomPath}/messages?limit=10`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response.status).toEqual(200);
            expect(response.headers["content-type"]).toEqual("application/json");

            expect(response.body.messages).toHaveLength(count + 5);
            expect(response.body.nextCursor).toBeNull();
        });

        test("get messages endpoint returns null `nextCursor` when exactly at the end", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {
                roomPath,
                room,
                initialMessageCount: count,
            } = await createPrivateRoom(session, botAccount);

            // Create 5 messages
            for (let i = 0; i < 5; i++) {
                await TestMessagingRoomBase.createMessage(room, session, `Message ${i}`);
            }

            // Get all messages with limit=10 - should return all 5 with null nextCursor
            const response = await server.GET(`${roomPath}/messages?limit=${count + 5}`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response.status).toEqual(200);
            expect(response.headers["content-type"]).toEqual("application/json");

            expect(response.body.messages).toHaveLength(count + 5);
            expect(response.body.nextCursor).toBeNull();
        });

        test("get messages endpoint supports `from=end` parameter", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {
                roomPath,
                room,
                initialMessageCount: count,
            } = await createPrivateRoom(session, botAccount);

            // Create 10 messages
            for (let i = 0; i < 10; i++) {
                await TestMessagingRoomBase.createMessage(room, session, `Message ${i}`);
            }

            // Get messages from end (newest first)
            const response = await server.GET(`${roomPath}/messages?limit=3&from=end`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response.status).toEqual(200);
            expect(response.headers["content-type"]).toEqual("application/json");

            expect(response.body.messages).toHaveLength(3);
            expect(response.body.messages[0].index).toBe(count + 7);
            expect(response.body.messages[1].index).toBe(count + 8);
            expect(response.body.messages[2].index).toBe(count + 9);
            expect(response.body.nextCursor).toBe(count + 7);
        });

        test("get messages endpoint supports cursor pagination with `from=end`", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {
                roomPath,
                room,
                initialMessageCount: count,
            } = await createPrivateRoom(session, botAccount);

            // Create 10 messages
            for (let i = 0; i < 10; i++) {
                await TestMessagingRoomBase.createMessage(room, session, `Message ${i}`);
            }

            // First page from end
            const response1 = await server.GET(`${roomPath}/messages?limit=3&from=end`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response1.status).toEqual(200);
            expect(response1.headers["content-type"]).toEqual("application/json");

            expect(response1.body.messages).toHaveLength(3);
            expect(response1.body.messages[0].index).toBe(count + 7);
            expect(response1.body.nextCursor).toBe(count + 7);

            // Second page from end using cursor
            const response2 = await server.GET(
                `${roomPath}/messages?limit=3&from=end&cursor=${response1.body.nextCursor}`,
                {headers: {authorization: `bearer ${apiKey}`}},
            );

            expect(response2.status).toEqual(200);
            expect(response2.headers["content-type"]).toEqual("application/json");

            expect(response2.body.messages).toHaveLength(3);
            expect(response2.body.messages[0].index).toBe(count + 4);
            expect(response2.body.messages[1].index).toBe(count + 5);
            expect(response2.body.messages[2].index).toBe(count + 6);
            expect(response2.body.nextCursor).toBe(count + 4);
        });

        test("get messages endpoint returns null `nextCursor` when reaching beginning with `from=end`", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {
                roomPath,
                room,
                initialMessageCount: count,
            } = await createPrivateRoom(session, botAccount);

            // Create 3 messages
            for (let i = 0; i < 3; i++) {
                await TestMessagingRoomBase.createMessage(room, session, `Message ${i}`);
            }

            // Get all messages from end - should return all 3 with null nextCursor
            const response = await server.GET(`${roomPath}/messages?limit=10&from=end`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response.status).toEqual(200);
            expect(response.headers["content-type"]).toEqual("application/json");

            expect(response.body.messages).toHaveLength(count + 3);
            expect(response.body.messages[count + 0].index).toBe(count + 0);
            expect(response.body.messages[count + 1].index).toBe(count + 1);
            expect(response.body.messages[count + 2].index).toBe(count + 2);
            expect(response.body.nextCursor).toBeNull();
        });

        test("get messages endpoint returns null `nextCursor` when exactly reaching the beginning with `from=end`", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {
                roomPath,
                room,
                initialMessageCount: count,
            } = await createPrivateRoom(session, botAccount);

            // Create 3 messages
            for (let i = 0; i < 3; i++) {
                await TestMessagingRoomBase.createMessage(room, session, `Message ${i}`);
            }

            // Get all messages from end - should return all 3 with null nextCursor
            const response = await server.GET(`${roomPath}/messages?limit=${count + 3}&from=end`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response.status).toEqual(200);
            expect(response.headers["content-type"]).toEqual("application/json");

            expect(response.body.messages).toHaveLength(count + 3);
            expect(response.body.messages[count + 0].index).toBe(count + 0);
            expect(response.body.messages[count + 1].index).toBe(count + 1);
            expect(response.body.messages[count + 2].index).toBe(count + 2);
            expect(response.body.nextCursor).toBeNull();
        });

        test("get messages endpoint handles empty room", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, initialMessageCount: count} = await createPrivateRoom(
                session,
                botAccount,
            );

            // Get messages from empty room
            const response = await server.GET(`${roomPath}/messages`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response.status).toEqual(200);
            expect(response.headers["content-type"]).toEqual("application/json");

            expect(response.body.messages).toHaveLength(count);
            expect(response.body.totalMessageCount).toBe(count);
            expect(response.body.nextCursor).toBeNull();
        });

        test("get messages endpoint handles single message", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {
                roomPath,
                room,
                initialMessageCount: count,
            } = await createPrivateRoom(session, botAccount);

            // Create 1 message
            const message = await TestMessagingRoomBase.createMessage(
                room,
                session,
                "Only message",
            );

            // Get messages from start
            const response1 = await server.GET(`${roomPath}/messages`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response1.status).toEqual(200);
            expect(response1.headers["content-type"]).toEqual("application/json");

            expect(response1.body.messages).toHaveLength(count + 1);
            expect(response1.body.messages[count].index).toBe(message.index);
            expect(response1.body.nextCursor).toBeNull();

            // Get messages from end
            const response2 = await server.GET(`${roomPath}/messages?from=end`, {
                headers: {authorization: `bearer ${apiKey}`},
            });

            expect(response2.status).toEqual(200);
            expect(response2.headers["content-type"]).toEqual("application/json");

            expect(response2.body.messages).toHaveLength(count + 1);
            expect(response2.body.messages[count].index).toBe(message.index);
            expect(response2.body.nextCursor).toBeNull();
        });

        test("can create message with headings", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, initialMessageCount} = await createPrivateRoom(session, botAccount);

            const response = await server.POST(`${roomPath}/messages`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 1,
                                elements: [{type: "Text", text: "Hello, world!"}],
                            },
                            {
                                type: "Heading",
                                level: 2,
                                elements: [{type: "Text", text: "Level 2"}],
                            },
                            {
                                type: "Heading",
                                level: 3,
                                elements: [{type: "Text", text: "Level 3"}],
                            },
                        ],
                    },
                },
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: initialMessageCount,
                        payload: expect.objectContaining({
                            type: "Content",
                        }),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual(`\
# Hello, world!

## Level 2

### Level 3
`);
        });

        test("can create message with divider", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, initialMessageCount} = await createPrivateRoom(session, botAccount);

            const response = await server.POST(`${roomPath}/messages`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    content: {
                        elements: [{type: "Divider"}],
                    },
                },
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: initialMessageCount,
                        payload: expect.objectContaining({
                            type: "Content",
                        }),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("<hr/>\n");
        });

        test("can create message with italic mark", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, initialMessageCount} = await createPrivateRoom(session, botAccount);

            const response = await server.POST(`${roomPath}/messages`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Hello, "},
                                    {
                                        type: "Text",
                                        text: "world",
                                        marks: [{type: "Italic"}],
                                    },
                                    {type: "Text", text: "!"},
                                ],
                            },
                        ],
                    },
                },
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: initialMessageCount,
                        payload: expect.objectContaining({
                            type: "Content",
                        }),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, *world*!\n");
        });

        test("can create message with highlight mark that\u2019s dropped", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, initialMessageCount} = await createPrivateRoom(session, botAccount);

            const response = await server.POST(`${roomPath}/messages`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Hello, "},
                                    {
                                        type: "Text",
                                        text: "world",
                                        marks: [{type: "Highlight", color: "Blue"}],
                                    },
                                    {type: "Text", text: "!"},
                                ],
                            },
                        ],
                    },
                },
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: initialMessageCount,
                        payload: expect.objectContaining({
                            type: "Content",
                        }),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });

        test("can create message with comment mark that\u2019s dropped", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, initialMessageCount} = await createPrivateRoom(session, botAccount);

            const response = await server.POST(`${roomPath}/messages`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Hello, "},
                                    {
                                        type: "Text",
                                        text: "world",
                                        marks: [{type: "Comment", threadId: generateId()}],
                                    },
                                    {type: "Text", text: "!"},
                                ],
                            },
                        ],
                    },
                },
            });

            expect(response).toEqual({
                status: 200,
                headers: expect.objectContaining({"content-type": "application/json"}),
                body: expect.objectContaining({
                    message: expect.objectContaining({
                        index: initialMessageCount,
                        payload: expect.objectContaining({
                            type: "Content",
                        }),
                    }),
                }),
            });

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });

        describe("message streams", () => {
            test("can create stream message as a bot actor", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {
                        isStream: true,
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Hello, world!"}],
                                },
                            ],
                        },
                    },
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${apiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Hello, world!"}],
                                        },
                                    ],
                                },
                            }),
                        }),
                    }),
                });
            });

            test("can create stream message with empty content", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${apiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {elements: [{type: "Paragraph", elements: []}]},
                            }),
                        }),
                    }),
                });
            });

            test("can put stream message part", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${apiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 1"}],
                                        },
                                    ],
                                },
                            }),
                        }),
                    }),
                });
            });

            test("can post stream message part", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.POST(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${apiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 1"}],
                                        },
                                    ],
                                },
                            }),
                        }),
                    }),
                });
            });

            test("can post multiple stream message parts", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.POST(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.POST(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 2"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.POST(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 3"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${apiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 1"}],
                                        },
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 2"}],
                                        },
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 3"}],
                                        },
                                    ],
                                },
                            }),
                        }),
                    }),
                });
            });

            test("can\u2019t put stream message part if message isn\u2019t a stream", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual({
                    status: 400,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: {
                        error: expect.objectContaining({message: "Message isn\u2019t a stream."}),
                    },
                });
            });

            test("can\u2019t put stream message part if bot is removed from the space", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                await space.removeAccount(botAccount);

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual({
                    status: 403,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: {
                        error: expect.objectContaining({
                            message: "Bot account was removed from space.",
                        }),
                    },
                });
            });

            test("can\u2019t put stream stream message part as a bot actor with the wrong scope", async () => {
                const space = await TestSpace.create(context);
                const session1 = await space.createSession({role: "Admin"});
                const session2 = await space.createSession();

                const botAccount = await TestBot.createAndInstantiate(session1);

                const {roomPath: room1Path, room: room1} = await createPrivateRoom(
                    session1,
                    botAccount,
                );

                const {room: room2} = await createPrivateRoom(session2, botAccount);

                const room1ApiKey = await botAccount.createApiKey(room1.getBotScope());
                const room2ApiKey = await botAccount.createApiKey(room2.getBotScope());

                const messageResponse = await server.POST(`${room1Path}/messages`, {
                    headers: {authorization: `bearer ${room1ApiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${room1Path}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${room2ApiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual({
                    status: 403,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: {
                        error: expect.objectContaining({
                            message: expect.stringMatching(
                                /^You don\u2019t have access|^You aren\u2019t allowed/,
                            ),
                        }),
                    },
                });

                expect(
                    await server.GET(
                        `${room1Path}/messages/${messageResponse.body.message.index}`,
                        {
                            headers: {authorization: `bearer ${room1ApiKey}`},
                        },
                    ),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {elements: [{type: "Paragraph", elements: []}]},
                            }),
                        }),
                    }),
                });
            });

            test("can\u2019t put stream message part as the wrong bot", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const bot1Account = await TestBot.createAndInstantiate(session);
                const bot2Account = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, bot1Account);

                const bot1ApiKey = await bot1Account.createApiKey(room.getBotScope());
                const bot2ApiKey = await bot2Account.createApiKey(session);

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${bot1ApiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${bot2ApiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual({
                    status: 403,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: {
                        error: expect.objectContaining({
                            message: "Only the bot who created the stream can update it.",
                        }),
                    },
                });

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${bot1ApiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {elements: [{type: "Paragraph", elements: []}]},
                            }),
                        }),
                    }),
                });
            });

            test("can put multiple stream message parts", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/1`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 2"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/2`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 3"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${apiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 1"}],
                                        },
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 2"}],
                                        },
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 3"}],
                                        },
                                    ],
                                },
                            }),
                        }),
                    }),
                });
            });

            test("can put the same stream message part multiple times", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 2"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 3"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${apiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 3"}],
                                        },
                                    ],
                                },
                            }),
                        }),
                    }),
                });
            });

            test("can put the same stream message part after adding other parts multiple times", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/1`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 2"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/2`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 3"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/2`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 4"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/2`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 5"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${apiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 1"}],
                                        },
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 2"}],
                                        },
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 5"}],
                                        },
                                    ],
                                },
                            }),
                        }),
                    }),
                });
            });

            test("can\u2019t put a same stream message part that\u2019s not the last part", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/1`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 2"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 3"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual({
                    status: 400,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: {
                        error: expect.objectContaining({
                            message:
                                "Only the last part of the stream (index 1) or the next part (index 2) can be updated.",
                        }),
                    },
                });

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${apiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 1"}],
                                        },
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 2"}],
                                        },
                                    ],
                                },
                            }),
                        }),
                    }),
                });
            });

            test("can complete stream message", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/completion`,
                        {headers: {authorization: `bearer ${apiKey}`}},
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${apiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 1"}],
                                        },
                                    ],
                                },
                            }),
                        }),
                    }),
                });
            });

            test("can complete stream message with multiple parts", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/1`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 2"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/2`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 3"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/completion`,
                        {headers: {authorization: `bearer ${apiKey}`}},
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${apiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 1"}],
                                        },
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 2"}],
                                        },
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 3"}],
                                        },
                                    ],
                                },
                            }),
                        }),
                    }),
                });
            });

            test("can\u2019t add more parts after completing stream message", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/completion`,
                        {headers: {authorization: `bearer ${apiKey}`}},
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/1`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 2"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual({
                    status: 400,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: {
                        error: expect.objectContaining({
                            message: "The stream has already been completed.",
                        }),
                    },
                });

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${apiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 1"}],
                                        },
                                    ],
                                },
                            }),
                        }),
                    }),
                });
            });

            test("can\u2019t update part after completing stream message", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/completion`,
                        {headers: {authorization: `bearer ${apiKey}`}},
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 2"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual({
                    status: 400,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: {
                        error: expect.objectContaining({
                            message: "The stream has already been completed.",
                        }),
                    },
                });

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${apiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 1"}],
                                        },
                                    ],
                                },
                            }),
                        }),
                    }),
                });
            });

            test("completing stream message is idempotent", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                const completionResponse1 = await server.PUT(
                    `${roomPath}/messages/${messageResponse.body.message.index}/stream/completion`,
                    {headers: {authorization: `bearer ${apiKey}`}},
                );

                const completionResponse2 = await server.PUT(
                    `${roomPath}/messages/${messageResponse.body.message.index}/stream/completion`,
                    {headers: {authorization: `bearer ${apiKey}`}},
                );

                const completionResponse3 = await server.PUT(
                    `${roomPath}/messages/${messageResponse.body.message.index}/stream/completion`,
                    {headers: {authorization: `bearer ${apiKey}`}},
                );

                expect(completionResponse1.status).toEqual(200);
                expect(completionResponse2.status).toEqual(200);
                expect(completionResponse3.status).toEqual(200);
                expect(completionResponse1.body.completion.completedTime).toEqual(
                    completionResponse2.body.completion.completedTime,
                );
                expect(completionResponse1.body.completion.completedTime).toEqual(
                    completionResponse3.body.completion.completedTime,
                );

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${apiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 1"}],
                                        },
                                    ],
                                },
                            }),
                        }),
                    }),
                });
            });

            test("can\u2019t complete stream message part if message isn\u2019t a stream", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/completion`,
                        {headers: {authorization: `bearer ${apiKey}`}},
                    ),
                ).toEqual({
                    status: 400,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: {
                        error: expect.objectContaining({message: "Message isn\u2019t a stream."}),
                    },
                });
            });

            test("can\u2019t complete stream message part if bot is removed from the space", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const botAccount = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, botAccount);

                const apiKey = await botAccount.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                await space.removeAccount(botAccount);

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/completion`,
                        {headers: {authorization: `bearer ${apiKey}`}},
                    ),
                ).toEqual({
                    status: 403,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: {
                        error: expect.objectContaining({
                            message: "Bot account was removed from space.",
                        }),
                    },
                });
            });

            test("can\u2019t complete stream stream message part as a bot actor with the wrong scope", async () => {
                const space = await TestSpace.create(context);
                const session1 = await space.createSession({role: "Admin"});
                const session2 = await space.createSession();

                const botAccount = await TestBot.createAndInstantiate(session1);

                const {roomPath: room1Path, room: room1} = await createPrivateRoom(
                    session1,
                    botAccount,
                );

                const {room: room2} = await createPrivateRoom(session2, botAccount);

                const room1ApiKey = await botAccount.createApiKey(room1.getBotScope());
                const room2ApiKey = await botAccount.createApiKey(room2.getBotScope());

                const messageResponse = await server.POST(`${room1Path}/messages`, {
                    headers: {authorization: `bearer ${room1ApiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${room1Path}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${room1ApiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${room1Path}/messages/${messageResponse.body.message.index}/stream/completion`,
                        {headers: {authorization: `bearer ${room2ApiKey}`}},
                    ),
                ).toEqual({
                    status: 403,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: {
                        error: expect.objectContaining({
                            message: expect.stringMatching(
                                /^You don\u2019t have access|^You aren\u2019t allowed/,
                            ),
                        }),
                    },
                });

                expect(
                    await server.GET(
                        `${room1Path}/messages/${messageResponse.body.message.index}`,
                        {
                            headers: {authorization: `bearer ${room1ApiKey}`},
                        },
                    ),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 1"}],
                                        },
                                    ],
                                },
                            }),
                        }),
                    }),
                });
            });

            test("can\u2019t complete stream message as the wrong bot", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const bot1Account = await TestBot.createAndInstantiate(session);
                const bot2Account = await TestBot.createAndInstantiate(session);

                const {roomPath, room} = await createPrivateRoom(session, bot1Account);

                const bot1ApiKey = await bot1Account.createApiKey(room.getBotScope());
                const bot2ApiKey = await bot2Account.createApiKey(session);

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${bot1ApiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${bot1ApiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ),
                ).toEqual(expect.objectContaining({status: 200}));

                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/completion`,
                        {headers: {authorization: `bearer ${bot2ApiKey}`}},
                    ),
                ).toEqual({
                    status: 403,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: {
                        error: expect.objectContaining({
                            message: "Only the bot who created the stream can update it.",
                        }),
                    },
                });

                expect(
                    await server.GET(`${roomPath}/messages/${messageResponse.body.message.index}`, {
                        headers: {authorization: `bearer ${bot1ApiKey}`},
                    }),
                ).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Test part 1"}],
                                        },
                                    ],
                                },
                            }),
                        }),
                    }),
                });
            });

            test("can\u2019t ping stream message without access", async () => {
                const space = await TestSpace.create(context);
                const session1 = await space.createSession({role: "Admin"});
                const session2 = await space.createSession({role: "Admin"});

                const bot1 = await TestBot.createAndInstantiate(session1);
                const apiKey = await bot1.createApiKey(session1);

                const {roomPath} = await createPrivateRoom(session1, bot1);

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                // Create a stream message using a bot that has access
                const bot2 = await TestBot.createAndInstantiate(session2);
                const bot2ApiKey = await bot2.createApiKey(session2);
                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/ping`,
                        {
                            headers: {authorization: `bearer ${bot2ApiKey}`},
                            body: {isStream: true, content: {elements: []}},
                        },
                    ),
                ).toEqual({
                    status: 403,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: {
                        error: expect.objectContaining({
                            stack: expect.stringContaining("PermissionDeniedError"),
                        }),
                    },
                });
            });

            test("can\u2019t ping stream that is already completed", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({name: "Alice Smith", role: "Admin"});

                const bot = await TestBot.createAndInstantiate(session);
                const apiKey = await bot.createApiKey(session);

                const {roomPath} = await createPrivateRoom(session, bot);

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                const completionResponse = await server.PUT(
                    `${roomPath}/messages/${messageResponse.body.message.index}/stream/completion`,
                    {headers: {authorization: `bearer ${apiKey}`}},
                );

                expect(completionResponse).toEqual(expect.objectContaining({status: 200}));

                const pingResponse = await server.PUT(
                    `${roomPath}/messages/${messageResponse.body.message.index}/stream/ping`,
                    {headers: {authorization: `bearer ${apiKey}`}},
                );

                expect(pingResponse).toEqual({
                    status: 400,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        error: expect.objectContaining({
                            message: "Can\u2019t ping a message stream that has been completed.",
                            stack: expect.stringContaining(
                                "FailedPreconditionError: The stream has been completed",
                            ),
                        }),
                    }),
                });
            });

            test("can\u2019t ping stale stream", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({name: "Alice Smith", role: "Admin"});

                const bot = await TestBot.createAndInstantiate(session);
                const apiKey = await bot.createApiKey(session);

                const {roomPath} = await createPrivateRoom(session, bot);

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                const originalTime = Date.now();
                const originalDateNow = Date.now;

                Date.now = () => originalTime + messageStreamTimeoutMs + 3000;

                try {
                    const pingResponse = await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/ping`,
                        {headers: {authorization: `bearer ${apiKey}`}},
                    );

                    expect(pingResponse).toEqual({
                        status: 400,
                        headers: expect.objectContaining({"content-type": "application/json"}),
                        body: expect.objectContaining({
                            error: expect.objectContaining({
                                message: expect.stringMatching(
                                    "Can\u2019t ping a message stream that has timed out",
                                ),
                                stack: expect.stringContaining(
                                    "FailedPreconditionError: The stream has timed out",
                                ),
                            }),
                        }),
                    });
                } finally {
                    Date.now = originalDateNow;
                }
            });

            test("can\u2019t complete stale stream", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({name: "Alice Smith", role: "Admin"});

                const bot = await TestBot.createAndInstantiate(session);
                const apiKey = await bot.createApiKey(session);

                const {roomPath} = await createPrivateRoom(session, bot);

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                const originalTime = Date.now();
                const originalDateNow = Date.now;

                Date.now = () => originalTime + messageStreamTimeoutMs + 3000;

                try {
                    const completionResponse = await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/completion`,
                        {headers: {authorization: `bearer ${apiKey}`}},
                    );

                    expect(completionResponse).toEqual({
                        status: 400,
                        headers: expect.objectContaining({"content-type": "application/json"}),
                        body: expect.objectContaining({
                            error: expect.objectContaining({
                                message: expect.stringMatching(
                                    "Can\u2019t complete a message stream that has timed out",
                                ),
                                stack: expect.stringContaining(
                                    "FailedPreconditionError: The stream has timed out",
                                ),
                            }),
                        }),
                    });
                } finally {
                    Date.now = originalDateNow;
                }
            });

            test("can\u2019t put stream part into stale stream", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({name: "Alice Smith", role: "Admin"});

                const bot = await TestBot.createAndInstantiate(session);
                const apiKey = await bot.createApiKey(session);

                const {roomPath} = await createPrivateRoom(session, bot);

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                const originalTime = Date.now();
                const originalDateNow = Date.now;

                Date.now = () => originalTime + messageStreamTimeoutMs + 3000;

                try {
                    const putPartResponse = await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/parts/0`,
                        {
                            headers: {authorization: `bearer ${apiKey}`},
                            body: {
                                payload: {
                                    type: "Content",
                                    content: {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Test part 1"}],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    );

                    expect(putPartResponse).toEqual({
                        status: 400,
                        headers: expect.objectContaining({"content-type": "application/json"}),
                        body: expect.objectContaining({
                            error: expect.objectContaining({
                                message: expect.stringMatching(
                                    "Can\u2019t put message part for a message stream that has timed out",
                                ),
                                stack: expect.stringContaining(
                                    "FailedPreconditionError: The stream has timed out",
                                ),
                            }),
                        }),
                    });
                } finally {
                    Date.now = originalDateNow;
                }
            });

            test("can ping active stream", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({name: "Alice Smith", role: "Admin"});

                const bot = await TestBot.createAndInstantiate(session);
                const apiKey = await bot.createApiKey(session);

                const {roomPath} = await createPrivateRoom(session, bot);

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                const pingResponse = await server.PUT(
                    `${roomPath}/messages/${messageResponse.body.message.index}/stream/ping`,
                    {headers: {authorization: `bearer ${apiKey}`}},
                );

                expect(pingResponse).toEqual(expect.objectContaining({status: 200}));
            });

            test("can\u2019t ping message that is not a stream", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({name: "Alice Smith", role: "Admin"});

                const bot = await TestBot.createAndInstantiate(session);
                const apiKey = await bot.createApiKey(session);

                const {roomPath} = await createPrivateRoom(session, bot);

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                const pingResponse = await server.PUT(
                    `${roomPath}/messages/${messageResponse.body.message.index}/stream/ping`,
                    {headers: {authorization: `bearer ${apiKey}`}},
                );

                expect(pingResponse).toEqual({
                    status: 400,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        error: expect.objectContaining({
                            message: "Message isn\u2019t a stream.",
                            stack: expect.stringContaining(
                                "FailedPreconditionError: Message isn\u2019t a stream",
                            ),
                        }),
                    }),
                });
            });

            test("can\u2019t ping message stream created by another bot", async () => {
                const space = await TestSpace.create(context);
                const session1 = await space.createSession({role: "Admin"});

                const bot1 = await TestBot.createAndInstantiate(session1);
                const apiKey = await bot1.createApiKey(session1);

                const {roomPath, room} = await createPrivateRoom(session1, bot1);

                // Create a stream message using a bot that has access
                const bot2 = await TestBot.createAndInstantiate(session1);
                const bot2ApiKey = await bot2.createApiKey(room.getBotScope());

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });
                expect(
                    await server.PUT(
                        `${roomPath}/messages/${messageResponse.body.message.index}/stream/ping`,
                        {
                            headers: {authorization: `bearer ${bot2ApiKey}`},
                            body: {isStream: true, content: {elements: []}},
                        },
                    ),
                ).toEqual({
                    status: 403,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: {
                        error: expect.objectContaining({
                            message: "Only the bot who created the stream can update it.",
                            stack: expect.stringContaining("PermissionDeniedError"),
                        }),
                    },
                });
            });

            test("increases previous ping time by 1 ms if current time is less than `lastPingTime`", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({name: "Alice Smith", role: "Admin"});

                const bot = await TestBot.createAndInstantiate(session);
                const apiKey = await bot.createApiKey(session);

                const {roomPath} = await createPrivateRoom(session, bot);

                const messageResponse = await server.POST(`${roomPath}/messages`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {isStream: true, content: {elements: []}},
                });

                expect(messageResponse).toEqual(expect.objectContaining({status: 200}));

                const pingResponse = await server.PUT(
                    `${roomPath}/messages/${messageResponse.body.message.index}/stream/ping`,
                    {headers: {authorization: `bearer ${apiKey}`}},
                );

                expect(pingResponse).toEqual(expect.objectContaining({status: 200}));
                const lastUpdatedTime = deserializeDateString(
                    pingResponse.body.ping.lastUpdatedTime,
                );

                const originalTime = Date.now();
                const originalDateNow = Date.now;

                Date.now = () => originalTime - 2000;

                try {
                    expect(
                        await server.PUT(
                            `${roomPath}/messages/${messageResponse.body.message.index}/stream/ping`,
                            {headers: {authorization: `bearer ${apiKey}`}},
                        ),
                    ).toEqual({
                        status: 200,
                        headers: expect.objectContaining({"content-type": "application/json"}),
                        body: expect.objectContaining({
                            ping: {
                                lastUpdatedTime: serializeDateString(
                                    new Date(lastUpdatedTime.getTime() + 1),
                                ),
                            },
                        }),
                    });
                } finally {
                    Date.now = originalDateNow;
                }
            });
        });

        describe("message parents", () => {
            test("includes parent with short content snippet (not truncated)", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({name: "Alice Smith", role: "Admin"});

                const bot = await TestBot.createAndInstantiate(session);
                const apiKey = await bot.createApiKey(session);

                const {roomPath, room} = await createPrivateRoom(session, bot);

                const parentMessage = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    "Short parent",
                );

                const replyMessage = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    "This is a reply",
                    {parent: parentMessage},
                );

                const response = await server.GET(`${roomPath}/messages/${replyMessage.index}`, {
                    headers: {authorization: `bearer ${apiKey}`},
                });

                expect(response.status).toEqual(200);
                expect(response.body.message.payload.type).toEqual("Content");
                expect(response.body.message.payload.parent).toEqual({
                    type: "Message",
                    index: parentMessage.index,
                    contentSnippet: {
                        elements: [
                            {
                                type: "Text",
                                text: "Short parent",
                            },
                        ],
                        isTruncated: false,
                    },
                    author: expect.objectContaining({
                        id: session.account.id,
                        name: "Alice Smith",
                    }),
                });
            });

            test("includes parent with long content snippet (truncated)", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({name: "Bob Jones", role: "Admin"});

                const bot = await TestBot.createAndInstantiate(session);
                const apiKey = await bot.createApiKey(session);

                const {roomPath, room} = await createPrivateRoom(session, bot);

                // Create a long parent message that should be truncated
                const longText =
                    "This is a very long parent message that should be truncated. ".repeat(10);
                const parentMessage = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    longText,
                );

                const replyMessage = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    "Reply to long message",
                    {parent: parentMessage},
                );

                const response = await server.GET(`${roomPath}/messages/${replyMessage.index}`, {
                    headers: {authorization: `bearer ${apiKey}`},
                });

                expect(response.status).toEqual(200);
                expect(response.body.message.payload.parent).toEqual({
                    type: "Message",
                    index: parentMessage.index,
                    contentSnippet: {
                        elements: [
                            {
                                type: "Text",
                                text:
                                    "This is a very long parent message that should be truncated. ".repeat(
                                        6,
                                    ) + "This is a very long parent",
                            },
                        ],
                        isTruncated: true,
                    },
                    author: expect.objectContaining({
                        id: session.account.id,
                        name: "Bob Jones",
                    }),
                });
            });

            test("includes parent with marks in content snippet", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({name: "Charlie Brown", role: "Admin"});

                const bot = await TestBot.createAndInstantiate(session);
                const apiKey = await bot.createApiKey(session);

                const {roomPath, room} = await createPrivateRoom(session, bot);

                // Create parent message with code and strike text
                const parentContent = MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("This is "),
                        MessageContentProsemirrorSchema.text("code", [
                            MessageContentProsemirrorSchema.mark("code"),
                        ]),
                        MessageContentProsemirrorSchema.text(" and "),
                        MessageContentProsemirrorSchema.text("strike", [
                            MessageContentProsemirrorSchema.mark("strike"),
                        ]),
                        MessageContentProsemirrorSchema.text(" text"),
                    ]),
                ]);

                const parentMessage = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    assertMessageContent(parentContent),
                );

                const replyMessage = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    "Reply with marks",
                    {parent: parentMessage},
                );

                const response = await server.GET(`${roomPath}/messages/${replyMessage.index}`, {
                    headers: {authorization: `bearer ${apiKey}`},
                });

                expect(response.status).toEqual(200);
                expect(response.body.message.payload.type).toEqual("Content");
                expect(response.body.message.payload.parent).toEqual({
                    type: "Message",
                    index: parentMessage.index,
                    contentSnippet: {
                        elements: [
                            {
                                type: "Text",
                                text: "This is ",
                            },
                            {
                                type: "Text",
                                text: "code",
                                marks: [{type: "Code"}],
                            },
                            {
                                type: "Text",
                                text: " and ",
                            },
                            {
                                type: "Text",
                                text: "strike",
                                marks: [{type: "Strike"}],
                            },
                            {
                                type: "Text",
                                text: " text",
                            },
                        ],
                        isTruncated: false,
                    },
                    author: expect.objectContaining({
                        id: session.account.id,
                        name: "Charlie Brown",
                    }),
                });
            });

            test("includes parent with multiple marks on same text", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({name: "Dana White", role: "Admin"});

                const bot = await TestBot.createAndInstantiate(session);
                const apiKey = await bot.createApiKey(session);

                const {roomPath, room} = await createPrivateRoom(session, bot);

                // Create parent message with multiple marks on same text
                const parentContent = MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Normal text and "),
                        MessageContentProsemirrorSchema.text("code strike", [
                            MessageContentProsemirrorSchema.mark("code"),
                            MessageContentProsemirrorSchema.mark("strike"),
                        ]),
                    ]),
                ]);

                const parentMessage = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    assertMessageContent(parentContent),
                );

                const replyMessage = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    "Reply",
                    {parent: parentMessage},
                );

                const response = await server.GET(`${roomPath}/messages/${replyMessage.index}`, {
                    headers: {authorization: `bearer ${apiKey}`},
                });

                expect(response).toEqual({
                    status: 200,
                    headers: expect.objectContaining({"content-type": "application/json"}),
                    body: expect.objectContaining({
                        message: expect.objectContaining({
                            payload: expect.objectContaining({
                                type: "Content",
                                parent: {
                                    type: "Message",
                                    index: parentMessage.index,
                                    contentSnippet: {
                                        elements: [
                                            {
                                                type: "Text",
                                                text: "Normal text and ",
                                            },
                                            {
                                                type: "Text",
                                                text: "code strike",
                                                marks: [{type: "Code"}, {type: "Strike"}],
                                            },
                                        ],
                                        isTruncated: false,
                                    },
                                    author: expect.objectContaining({id: session.account.id}),
                                },
                            }),
                        }),
                    }),
                });
            });

            test("includes MessagesRange parent with short content snippet (not truncated)", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({name: "Eve Adams", role: "Admin"});

                const bot = await TestBot.createAndInstantiate(session);
                const apiKey = await bot.createApiKey(session);

                const {roomPath, room} = await createPrivateRoom(session, bot);

                const message1 = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    "First message",
                );
                await TestMessagingRoomBase.createMessage(room, session, "Second message");
                const message3 = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    "Third message",
                );

                const replyMessage = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    "Reply to range",
                    {
                        parent: {
                            type: "MessagesRange",
                            startIndex: message1.index,
                            endIndex: message3.index,
                            startContentVersion: 0,
                            endContentVersion: 0,
                            startPos: 5,
                            endPos: 4,
                        },
                    },
                );

                const response = await server.GET(`${roomPath}/messages/${replyMessage.index}`, {
                    headers: {authorization: `bearer ${apiKey}`},
                });

                expect(response.status).toEqual(200);
                expect(response.body.message.payload.type).toEqual("Content");
                expect(response.body.message.payload.parent).toEqual({
                    type: "Message",
                    index: message1.index,
                    endIndex: message3.index,
                    contentSnippet: {
                        elements: [
                            {
                                type: "Text",
                                text: "t message. Second message. Thi",
                            },
                        ],
                        isTruncated: false,
                    },
                    author: expect.objectContaining({
                        id: session.account.id,
                        name: "Eve Adams",
                    }),
                });
            });

            test("includes MessagesRange parent with long content snippet (truncated)", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({name: "Frank Miller", role: "Admin"});

                const bot = await TestBot.createAndInstantiate(session);
                const apiKey = await bot.createApiKey(session);

                const {roomPath, room} = await createPrivateRoom(session, bot);

                // Create a long first message that should be truncated
                const longText = "This is a very long message that should be truncated. ".repeat(
                    10,
                );
                const message1 = await TestMessagingRoomBase.createMessage(room, session, longText);
                const message2 = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    "Second message",
                );

                const replyMessage = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    "Reply to range",
                    {
                        parent: {
                            type: "MessagesRange",
                            startIndex: message1.index,
                            endIndex: message2.index,
                            startContentVersion: 0,
                            endContentVersion: 0,
                            startPos: 5,
                            endPos: 100,
                        },
                    },
                );

                const response = await server.GET(`${roomPath}/messages/${replyMessage.index}`, {
                    headers: {authorization: `bearer ${apiKey}`},
                });

                expect(response.status).toEqual(200);
                expect(response.body.message.payload.parent).toEqual(
                    expect.objectContaining({
                        type: "Message",
                        index: message1.index,
                        endIndex: message2.index,
                        contentSnippet: {
                            elements: [
                                {
                                    type: "Text",
                                    text: " is a very long message that should be truncated. This is a very long message that should be truncated. This is a very long message that should be truncated. This is a very long message that should be truncated. This is a very long message that should be truncated. This is a very long message that should be truncated. This is a very long message that should be truncated. This is a very long",
                                },
                            ],
                            isTruncated: true,
                        },
                        author: expect.objectContaining({
                            id: session.account.id,
                            name: "Frank Miller",
                        }),
                    }),
                );

                // Verify that contentSnippet exists but is truncated
                expect(response.body.message.payload.parent.contentSnippet).toBeDefined();
                const snippetText =
                    response.body.message.payload.parent.contentSnippet.elements[0].text;
                expect(snippetText.length).toBeLessThan(longText.length);
            });

            test("includes MessagesRange parent with marks in content snippet", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({name: "Grace Kelly", role: "Admin"});

                const bot = await TestBot.createAndInstantiate(session);
                const apiKey = await bot.createApiKey(session);

                const {roomPath, room} = await createPrivateRoom(session, bot);

                // Create first message with code and strike text
                const message1Content = MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("This is "),
                        MessageContentProsemirrorSchema.text("code", [
                            MessageContentProsemirrorSchema.mark("code"),
                        ]),
                        MessageContentProsemirrorSchema.text(" and "),
                        MessageContentProsemirrorSchema.text("strike", [
                            MessageContentProsemirrorSchema.mark("strike"),
                        ]),
                        MessageContentProsemirrorSchema.text(" text"),
                    ]),
                ]);

                const message1 = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    assertMessageContent(message1Content),
                );
                const message2 = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    "Second message",
                );

                const replyMessage = await TestMessagingRoomBase.createMessage(
                    room,
                    session,
                    "Reply with marks",
                    {
                        parent: {
                            type: "MessagesRange",
                            startIndex: message1.index,
                            endIndex: message2.index,
                            startContentVersion: 0,
                            endContentVersion: 0,
                            startPos: 5,
                            endPos: 10,
                        },
                    },
                );

                const response = await server.GET(`${roomPath}/messages/${replyMessage.index}`, {
                    headers: {authorization: `bearer ${apiKey}`},
                });

                expect(response.status).toEqual(200);
                expect(response.body.message.payload.type).toEqual("Content");
                expect(response.body.message.payload.parent).toEqual({
                    type: "Message",
                    index: message1.index,
                    endIndex: message2.index,
                    contentSnippet: {
                        elements: [
                            {
                                type: "Text",
                                text: " is ",
                            },
                            {
                                type: "Text",
                                text: "code",
                                marks: [{type: "Code"}],
                            },
                            {
                                type: "Text",
                                text: " and ",
                            },
                            {
                                type: "Text",
                                text: "strike",
                                marks: [{type: "Strike"}],
                            },
                            {
                                type: "Text",
                                text: " text. Second me",
                            },
                        ],
                        isTruncated: false,
                    },
                    author: expect.objectContaining({
                        id: session.account.id,
                        name: "Grace Kelly",
                    }),
                });
            });
        });
    });
}
