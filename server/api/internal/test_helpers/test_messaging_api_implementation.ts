import {IncomingMessage, ServerResponse} from "http";
import request from "supertest";
import {printApiContentToMarkdown} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {ApiMessageRoomPath} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {TestBot, TestBotAccount} from "~/server/bots/test_helpers/test_bot.js";
import {SearchInjection} from "~/server/context/injection_context_module.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestMessagingRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
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
    server: (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => void,
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
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session,
                "Hello, world!",
            );

            const response = await request(server)
                .get(`${roomPath}/messages/${message.index}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            );

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });

        test("can’t read message in room bot doesn’t have access to", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession({role: "Admin"});
            const session2 = await space.createSession();

            const botAccount = await TestBot.createAndInstantiate(session1);
            const apiKey = await botAccount.createApiKey(session1);

            const {roomPath, room} = await createPrivateRoom(session2, botAccount);

            const message = await TestMessagingRoomBase.createMessage(room, session2);

            const response = await request(server)
                .get(`${roomPath}/messages/${message.index}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(403);

            expect(response.body).toEqual({
                error: expect.objectContaining({
                    message: expect.stringMatching(/(don’t have access|You aren’t allowed)/),
                }),
            });
        });

        test("can’t read message from room that doesn’t exist", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const response = await request(server)
                .get(`${generateMissingRoomPath()}/messages/0`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(404);

            expect(response.body).toEqual({
                error: expect.objectContaining({
                    message: expect.stringContaining("doesn’t exist"),
                }),
            });
        });

        test("can’t read message that doesn’t exist in room", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const message = await TestMessagingRoomBase.createMessage(room, session);

            const response = await request(server)
                .get(`${roomPath}/messages/${message.index + 1}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(404);

            expect(response.body).toEqual({
                error: expect.objectContaining({
                    message: expect.stringContaining("doesn’t exist"),
                }),
            });
        });

        test("can read message with room’s scope", async () => {
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

            const response = await request(server)
                .get(`${roomPath}/messages/${message.index}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            );

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

            const response = await request(server)
                .get(`${roomPath}/messages/${message.index}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            );

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

            const response = await request(server)
                .get(`${roomPath}/messages/${message.index}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            );

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

            const response = await request(server)
                .get(`${roomPath}/messages/${message.index}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            );

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

            const response = await request(server)
                .get(`${roomPath}/messages/${message.index}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            );

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

            const response = await request(server)
                .get(`${roomPath}/messages/${message.index}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            );

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

            const response = await request(server)
                .get(`${roomPath}/messages/${message.index}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index,
                        payload: expect.objectContaining({type: "Content"}),
                    }),
                }),
            );

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

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const message = await TestMessagingRoomBase.createMessage(room, session);

            const response = await request(server)
                .post(`${roomPath}/messages`)
                .set("authorization", `bearer ${apiKey}`)
                .send({
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Hello, world!"}],
                            },
                        ],
                    },
                })
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index + 1,
                        payload: expect.objectContaining({
                            type: "Content",
                        }),
                    }),
                }),
            );

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });

        test("can’t send message to room that doesn’t exist", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const response = await request(server)
                .post(`${generateMissingRoomPath()}/messages`)
                .set("authorization", `bearer ${apiKey}`)
                .send({
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Hello, world!"}],
                            },
                        ],
                    },
                })
                .expect("content-type", "application/json")
                .expect(404);

            expect(response.body).toEqual({
                error: expect.objectContaining({
                    message: expect.stringContaining("doesn’t exist"),
                }),
            });
        });

        test("can’t send message to room bot doesn’t have access to", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession({role: "Admin"});
            const session2 = await space.createSession();

            const botAccount = await TestBot.createAndInstantiate(session1);
            const apiKey = await botAccount.createApiKey(session1);

            const {roomPath} = await createPrivateRoom(session2, botAccount);

            const response = await request(server)
                .post(`${roomPath}/messages`)
                .set("authorization", `bearer ${apiKey}`)
                .send({
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Hello, world!"}],
                            },
                        ],
                    },
                })
                .expect("content-type", "application/json")
                .expect(403);

            expect(response.body).toEqual({
                error: expect.objectContaining({
                    message: expect.stringMatching(/(don’t have access|You aren’t allowed)/),
                }),
            });
        });

        test("can create message with room’s scope", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const apiKey = await botAccount.createApiKey(room.getBotScope());

            const message = await TestMessagingRoomBase.createMessage(room, session);

            const response = await request(server)
                .post(`${roomPath}/messages`)
                .set("authorization", `bearer ${apiKey}`)
                .send({
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Hello, world!"}],
                            },
                        ],
                    },
                })
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.objectContaining({
                        index: message.index + 1,
                        payload: expect.objectContaining({
                            type: "Content",
                        }),
                    }),
                }),
            );

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });

        test("can read messages", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, room} = await createPrivateRoom(session, botAccount);

            const message = await TestMessagingRoomBase.createMessage(
                room,
                session,
                "Hello, world!",
            );

            const response = await request(server)
                .get(`${roomPath}/messages?limit=1&cursor=${message.index - 1}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            );

            expect(
                printApiContentToMarkdown(response.body.messages[0].payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });

        test("can’t read messages in room bot doesn’t have access to", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession({role: "Admin"});
            const session2 = await space.createSession();

            const botAccount = await TestBot.createAndInstantiate(session1);
            const apiKey = await botAccount.createApiKey(session1);

            const {roomPath, room} = await createPrivateRoom(session2, botAccount);

            const message = await TestMessagingRoomBase.createMessage(room, session2);

            const response = await request(server)
                .get(`${roomPath}/messages?limit=1&cursor=${message.index - 1}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(403);

            expect(response.body).toEqual({
                error: expect.objectContaining({
                    message: expect.stringMatching(/(don’t have access|You aren’t allowed)/),
                }),
            });
        });

        test("can’t read messages from room that doesn’t exist", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const response = await request(server)
                .get(`${generateMissingRoomPath()}/messages?limit=1`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(404);

            expect(response.body).toEqual({
                error: expect.objectContaining({
                    message: expect.stringContaining("doesn’t exist"),
                }),
            });
        });

        test("can read messages with room’s scope", async () => {
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

            const response = await request(server)
                .get(`${roomPath}/messages?limit=1&cursor=${message.index - 1}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            );

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

            const response = await request(server)
                .get(`${roomPath}/messages?limit=1&cursor=${message.index - 1}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            );

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

            const response = await request(server)
                .get(`${roomPath}/messages?limit=1&cursor=${message.index - 1}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            );

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

            const response = await request(server)
                .get(`${roomPath}/messages?limit=1&cursor=${message.index - 1}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            );

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

            const response = await request(server)
                .get(`${roomPath}/messages?limit=1&cursor=${message.index - 1}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            );

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

            const response = await request(server)
                .get(`${roomPath}/messages?limit=1&cursor=${message.index - 1}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            );

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

            const response = await request(server)
                .get(`${roomPath}/messages?limit=1&cursor=${message.index - 1}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    messages: [
                        expect.objectContaining({
                            index: message.index,
                            payload: expect.objectContaining({type: "Content"}),
                        }),
                    ],
                }),
            );

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
            const response = await request(server)
                .get(`${roomPath}/messages?limit=5`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

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
            const response = await request(server)
                .get(`${roomPath}/messages`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

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
            const response1 = await request(server)
                .get(`${roomPath}/messages?limit=3`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response1.body.messages).toHaveLength(3);
            expect(response1.body.messages[0].index).toBe(0);
            expect(response1.body.messages[1].index).toBe(1);
            expect(response1.body.messages[2].index).toBe(2);
            expect(response1.body.nextCursor).toBe(2);

            // Second page: get next 3 messages using cursor
            const response2 = await request(server)
                .get(`${roomPath}/messages?limit=3&cursor=${response1.body.nextCursor}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

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
            const response = await request(server)
                .get(`${roomPath}/messages?limit=10`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

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
            const response = await request(server)
                .get(`${roomPath}/messages?limit=${count + 5}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

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
            const response = await request(server)
                .get(`${roomPath}/messages?limit=3&from=end`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

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
            const response1 = await request(server)
                .get(`${roomPath}/messages?limit=3&from=end`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response1.body.messages).toHaveLength(3);
            expect(response1.body.messages[0].index).toBe(count + 7);
            expect(response1.body.nextCursor).toBe(count + 7);

            // Second page from end using cursor
            const response2 = await request(server)
                .get(`${roomPath}/messages?limit=3&from=end&cursor=${response1.body.nextCursor}`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

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
            const response = await request(server)
                .get(`${roomPath}/messages?limit=10&from=end`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

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
            const response = await request(server)
                .get(`${roomPath}/messages?limit=${count + 3}&from=end`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

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
            const response = await request(server)
                .get(`${roomPath}/messages`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

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
            const response1 = await request(server)
                .get(`${roomPath}/messages`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response1.body.messages).toHaveLength(count + 1);
            expect(response1.body.messages[count].index).toBe(message.index);
            expect(response1.body.nextCursor).toBeNull();

            // Get messages from end
            const response2 = await request(server)
                .get(`${roomPath}/messages?from=end`)
                .set("authorization", `bearer ${apiKey}`)
                .expect("content-type", "application/json")
                .expect(200);

            expect(response2.body.messages).toHaveLength(count + 1);
            expect(response2.body.messages[count].index).toBe(message.index);
            expect(response2.body.nextCursor).toBeNull();
        });

        test("can create message with heading that’s converted to paragraph", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, initialMessageCount} = await createPrivateRoom(session, botAccount);

            const response = await request(server)
                .post(`${roomPath}/messages`)
                .set("authorization", `bearer ${apiKey}`)
                .send({
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 1,
                                elements: [{type: "Text", text: "Hello, world!"}],
                            },
                        ],
                    },
                })
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.objectContaining({
                        index: initialMessageCount,
                        payload: expect.objectContaining({
                            type: "Content",
                        }),
                    }),
                }),
            );

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("**Hello, world!**\n");
        });

        test("can create message with divider that’s converted to paragraph", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, initialMessageCount} = await createPrivateRoom(session, botAccount);

            const response = await request(server)
                .post(`${roomPath}/messages`)
                .set("authorization", `bearer ${apiKey}`)
                .send({
                    content: {
                        elements: [{type: "Divider"}],
                    },
                })
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.objectContaining({
                        index: initialMessageCount,
                        payload: expect.objectContaining({
                            type: "Content",
                        }),
                    }),
                }),
            );

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("\\---\n");
        });

        test("can create message with italic mark", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, initialMessageCount} = await createPrivateRoom(session, botAccount);

            const response = await request(server)
                .post(`${roomPath}/messages`)
                .set("authorization", `bearer ${apiKey}`)
                .send({
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
                })
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.objectContaining({
                        index: initialMessageCount,
                        payload: expect.objectContaining({
                            type: "Content",
                        }),
                    }),
                }),
            );

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, *world*!\n");
        });

        test("can create message with highlight mark that’s dropped", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, initialMessageCount} = await createPrivateRoom(session, botAccount);

            const response = await request(server)
                .post(`${roomPath}/messages`)
                .set("authorization", `bearer ${apiKey}`)
                .send({
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
                })
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.objectContaining({
                        index: initialMessageCount,
                        payload: expect.objectContaining({
                            type: "Content",
                        }),
                    }),
                }),
            );

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });

        test("can create message with comment mark that’s dropped", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const botAccount = await TestBot.createAndInstantiate(session);
            const apiKey = await botAccount.createApiKey(session);

            const {roomPath, initialMessageCount} = await createPrivateRoom(session, botAccount);

            const response = await request(server)
                .post(`${roomPath}/messages`)
                .set("authorization", `bearer ${apiKey}`)
                .send({
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
                })
                .expect("content-type", "application/json")
                .expect(200);

            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.objectContaining({
                        index: initialMessageCount,
                        payload: expect.objectContaining({
                            type: "Content",
                        }),
                    }),
                }),
            );

            expect(
                printApiContentToMarkdown(response.body.message.payload.content, {
                    spaceId: space.id,
                }),
            ).toEqual("Hello, world!\n");
        });
    });
}
