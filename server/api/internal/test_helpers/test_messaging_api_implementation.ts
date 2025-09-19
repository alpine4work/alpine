import {IncomingMessage, ServerResponse} from "http";
import request from "supertest";
import {printApiContentToMarkdown} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {ApiMessageRoomPath} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {TestBot, TestBotAccount} from "~/server/bots/test_helpers/test_bot.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestMessagingRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";

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
                    roomPath,
                    index: message.index,
                    payload: expect.objectContaining({type: "Content"}),
                }),
            );

            expect(
                printApiContentToMarkdown(response.body.payload.content, {spaceId: space.id}),
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
                    roomPath,
                    index: message.index,
                    payload: expect.objectContaining({type: "Content"}),
                }),
            );

            expect(
                printApiContentToMarkdown(response.body.payload.content, {spaceId: space.id}),
            ).toEqual("Hello, world!\n");
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
                    roomPath,
                    index: message.index + 1,
                    payload: expect.objectContaining({
                        type: "Content",
                    }),
                }),
            );

            expect(
                printApiContentToMarkdown(response.body.payload.content, {spaceId: space.id}),
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
                    roomPath,
                    index: message.index + 1,
                    payload: expect.objectContaining({
                        type: "Content",
                    }),
                }),
            );

            expect(
                printApiContentToMarkdown(response.body.payload.content, {spaceId: space.id}),
            ).toEqual("Hello, world!\n");
        });
    });
}
