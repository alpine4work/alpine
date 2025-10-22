import {expect, test as playwrightTest} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestMessagingRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {ApiMessageRoomPath} from "~/shared/api/types/api_specification_convenience_types.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {MessageContentProsemirrorSchema as schema} from "~/shared/messaging/message_content_schema.js";

const {context, services} = createTestServices();

// NOTE(calebmer): `ApiMessageRoomPath` is the only path I can think of, at the
// moment, which has a union of all messaging room types in the product. Using
// it to make sure we exhaustively test all messaging room types in this file.
type MessagingRoomType = ApiMessageRoomPath extends `/${infer Type}/${string}` ? Type : never;

const testCases: Record<
    MessagingRoomType,
    {
        only?: CommitBlocker;
        setup: (scenario: {
            session1: TestSpaceSession;
            account2: TestAccount;
            account3: TestAccount;
        }) => Promise<{
            room: TestMessagingRoomBase;
            roomPath: string;
        }>;
    }
> = {
    chats: {
        setup: async ({session1, account2, account3}) => {
            const chat = await TestChat.get(session1, account2, account3);

            return {
                room: chat,
                roomPath: `/s/${chat.space.id}/chat/${chat.id}`,
            };
        },
    },
    documents: {
        setup: async ({session1}) => {
            const document = await TestDocument.create(session1, {access: "Public"});
            await document.type(session1, "Hello, ");
            const {range} = await document.type(session1, "world");
            await document.type(session1, "!");

            const commentThread = await document.createCommentThread(
                session1,
                range,
                "Initial comment",
            );

            return {
                room: commentThread,
                roomPath: `/s/${document.space.id}/documents/${document.id}?comments=${commentThread.id}`,
            };
        },
    },
    posts: {
        setup: async ({session1}) => {
            const channel = await TestChannel.create(session1, {access: "Public"});
            const post = await channel.createPost(session1, "Hello, world!");

            return {
                room: post,
                roomPath: `/s/${post.space.id}/posts/${post.id}`,
            };
        },
    },
    tasks: {
        setup: async ({session1}) => {
            const collection = await TestTaskCollection.create(session1, {access: "Public"});
            const task = await TestTask.create(session1);
            await task.addCollection(session1, collection);

            return {
                room: task,
                roomPath: `/s/${task.space.id}/tasks/${task.id}?comments=show`,
            };
        },
    },
};

for (const [roomType, testCase] of Object.entries(testCases)) {
    const test = testCase.only ? playwrightTest.only : playwrightTest;

    playwrightTest.describe(roomType, () => {
        test("can reply to range in single message", async ({page, context: browserContext}) => {
            const space = await TestSpace.create(context);

            const session1 = await space.createSession({name: "Alice"});
            const session2 = await space.createSession({name: "Bob"});
            const session3 = await space.createSession({name: "Carol"});

            const {room, roomPath} = await testCase.setup({
                session1,
                account2: session2.account,
                account3: session3.account,
            });

            await TestMessagingRoomBase.createMessage(room, session2, "abcdefghi");
            await TestMessagingRoomBase.createMessage(room, session3, "jklmnopqr");
            const lastMessage = await TestMessagingRoomBase.createMessage(
                room,
                session1,
                "stuvwxyz",
            );

            await services.signIn(browserContext, session1);
            await page.goto(roomPath);

            // Wait for React to mount
            await page.waitForFunction("dev.contentEditor");

            await expect(page.getByText("Reply")).toBeHidden();

            await page.getByText("jklmnopqr").evaluate(element => {
                const selection = globalThis.window.getSelection()!;

                const range = globalThis.document.createRange();
                range.setStart(element.firstChild!, 2);
                range.setEnd(element.firstChild!, 8);

                selection.removeAllRanges();
                selection.addRange(range);
            });

            const messageTestIdRegExp = new RegExp(`^MessageView:[^:]+:${lastMessage.index + 1}$`);

            await expect(page.getByText("Reply")).toBeVisible();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).not.toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            await page.getByText("Reply").click();

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeVisible();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            expect(await page.getByTestId("MessageInputParent").textContent()).toEqual(
                "Carol: lmnopq",
            );

            await page.getByLabel(/New (message|comment)/).fill("Works!");
            await page.getByLabel(/New (message|comment)/).press("Enter");

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeVisible();

            expect(
                await page
                    .getByTestId(messageTestIdRegExp)
                    .getByTestId("MessageViewParent")
                    .textContent(),
            ).toEqual("Carol: lmnopq");
        });

        test("can reply to range in single message when message has marks", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);

            const session1 = await space.createSession({name: "Alice"});
            const session2 = await space.createSession({name: "Bob"});
            const session3 = await space.createSession({name: "Carol"});

            const {room, roomPath} = await testCase.setup({
                session1,
                account2: session2.account,
                account3: session3.account,
            });

            await TestMessagingRoomBase.createMessage(room, session2, "abcdefghi");

            await TestMessagingRoomBase.createMessage(
                room,
                session3,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("jklm", [schema.mark("bold")]),
                        schema.text("n"),
                        schema.text("op", [schema.mark("strike")]),
                        schema.text("qr"),
                    ]),
                ]),
            );

            const lastMessage = await TestMessagingRoomBase.createMessage(
                room,
                session1,
                "stuvwxyz",
            );

            await services.signIn(browserContext, session1);
            await page.goto(roomPath);

            // Wait for React to mount
            await page.waitForFunction("dev.contentEditor");

            await expect(page.getByText("Reply")).toBeHidden();

            await page.getByText("jklmnopqr").evaluate(element => {
                const selection = globalThis.window.getSelection()!;

                const range = globalThis.document.createRange();
                range.setStart(element.firstChild!.firstChild!, 2);
                range.setEnd(element.childNodes[3]!, 1);

                selection.removeAllRanges();
                selection.addRange(range);
            });

            const messageTestIdRegExp = new RegExp(`^MessageView:[^:]+:${lastMessage.index + 1}$`);

            await expect(page.getByText("Reply")).toBeVisible();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).not.toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            await page.getByText("Reply").click();

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeVisible();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            expect(await page.getByTestId("MessageInputParent").textContent()).toEqual(
                "Carol: lmnopq",
            );

            await page.getByLabel(/New (message|comment)/).fill("Works!");
            await page.getByLabel(/New (message|comment)/).press("Enter");

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeVisible();

            expect(
                await page
                    .getByTestId(messageTestIdRegExp)
                    .getByTestId("MessageViewParent")
                    .textContent(),
            ).toEqual("Carol: lmnopq");
        });

        test("can reply to range in single message when message has multiple block nodes", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);

            const session1 = await space.createSession({name: "Alice"});
            const session2 = await space.createSession({name: "Bob"});
            const session3 = await space.createSession({name: "Carol"});

            const {room, roomPath} = await testCase.setup({
                session1,
                account2: session2.account,
                account3: session3.account,
            });

            await TestMessagingRoomBase.createMessage(room, session2, "abcdefghi");

            await TestMessagingRoomBase.createMessage(
                room,
                session3,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [schema.text("jklmno")]),
                    schema.node("unorderedListItem", {}, [
                        schema.node("paragraph", {}, [schema.text("pqr")]),
                    ]),
                ]),
            );

            const lastMessage = await TestMessagingRoomBase.createMessage(
                room,
                session1,
                "stuvwxyz",
            );

            await services.signIn(browserContext, session1);
            await page.goto(roomPath);

            // Wait for React to mount
            await page.waitForFunction("dev.contentEditor");

            await expect(page.getByText("Reply")).toBeHidden();

            await page.getByText("jklmno").evaluate(element => {
                const selection = globalThis.window.getSelection()!;

                const range = globalThis.document.createRange();
                range.setStart(element.firstChild!, 2);
                range.setEnd(element.nextSibling!.firstChild!.firstChild!, 2);

                selection.removeAllRanges();
                selection.addRange(range);
            });

            const messageTestIdRegExp = new RegExp(`^MessageView:[^:]+:${lastMessage.index + 1}$`);

            await expect(page.getByText("Reply")).toBeVisible();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).not.toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            await page.getByText("Reply").click();

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeVisible();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            expect(await page.getByTestId("MessageInputParent").textContent()).toEqual(
                "Carol: lmno. pq",
            );

            await page.getByLabel(/New (message|comment)/).fill("Works!");
            await page.getByLabel(/New (message|comment)/).press("Enter");

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeVisible();

            expect(
                await page
                    .getByTestId(messageTestIdRegExp)
                    .getByTestId("MessageViewParent")
                    .textContent(),
            ).toEqual("Carol: lmno. pq");
        });

        test("can reply to range across two messages", async ({page, context: browserContext}) => {
            const space = await TestSpace.create(context);

            const session1 = await space.createSession({name: "Alice"});
            const session2 = await space.createSession({name: "Bob"});
            const session3 = await space.createSession({name: "Carol"});

            const {room, roomPath} = await testCase.setup({
                session1,
                account2: session2.account,
                account3: session3.account,
            });

            await TestMessagingRoomBase.createMessage(room, session2, "abcdefghi");
            await TestMessagingRoomBase.createMessage(room, session3, "jklmn");
            await TestMessagingRoomBase.createMessage(room, session3, "opqr");
            const lastMessage = await TestMessagingRoomBase.createMessage(
                room,
                session1,
                "stuvwxyz",
            );

            await services.signIn(browserContext, session1);
            await page.goto(roomPath);

            // Wait for React to mount
            await page.waitForFunction("dev.contentEditor");

            await expect(page.getByText("Reply")).toBeHidden();

            await page.evaluate(
                ([element1, element2]) => {
                    const selection = globalThis.window.getSelection()!;

                    const range = globalThis.document.createRange();
                    range.setStart(element1!.firstChild!, 2);
                    range.setEnd(element2!.firstChild!, 3);

                    selection.removeAllRanges();
                    selection.addRange(range);
                },
                [
                    await page.getByText("jklmn").elementHandle(),
                    await page.getByText("opqr").elementHandle(),
                ],
            );

            const messageTestIdRegExp = new RegExp(`^MessageView:[^:]+:${lastMessage.index + 1}$`);

            await expect(page.getByText("Reply")).toBeVisible();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).not.toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            await page.getByText("Reply").click();

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeVisible();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            expect(await page.getByTestId("MessageInputParent").textContent()).toEqual(
                "Carol: lmn. opq",
            );

            await page.getByLabel(/New (message|comment)/).fill("Works!");
            await page.getByLabel(/New (message|comment)/).press("Enter");

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeVisible();

            expect(
                await page
                    .getByTestId(messageTestIdRegExp)
                    .getByTestId("MessageViewParent")
                    .textContent(),
            ).toEqual("Carol: lmn. opq");
        });

        test("can reply to range across five messages", async ({page, context: browserContext}) => {
            const space = await TestSpace.create(context);

            const session1 = await space.createSession({name: "Alice"});
            const session2 = await space.createSession({name: "Bob"});
            const session3 = await space.createSession({name: "Carol"});

            const {room, roomPath} = await testCase.setup({
                session1,
                account2: session2.account,
                account3: session3.account,
            });

            await TestMessagingRoomBase.createMessage(room, session3, "abc");
            await TestMessagingRoomBase.createMessage(room, session3, "defghi");
            await TestMessagingRoomBase.createMessage(room, session3, "jklmn");
            await TestMessagingRoomBase.createMessage(room, session3, "opqr");
            await TestMessagingRoomBase.createMessage(room, session3, "stuv");
            const lastMessage = await TestMessagingRoomBase.createMessage(room, session3, "wxyz");

            await services.signIn(browserContext, session1);
            await page.goto(roomPath);

            // Wait for React to mount
            await page.waitForFunction("dev.contentEditor");

            await expect(page.getByText("Reply")).toBeHidden();

            await page.evaluate(
                ([element1, element2]) => {
                    const selection = globalThis.window.getSelection()!;

                    const range = globalThis.document.createRange();
                    range.setStart(element1!.firstChild!, 2);
                    range.setEnd(element2!.firstChild!, 1);

                    selection.removeAllRanges();
                    selection.addRange(range);
                },
                [
                    await page.getByText("defghi").elementHandle(),
                    await page.getByText("wxyz").elementHandle(),
                ],
            );

            const messageTestIdRegExp = new RegExp(`^MessageView:[^:]+:${lastMessage.index + 1}$`);

            await expect(page.getByText("Reply")).toBeVisible();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).not.toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            await page.getByText("Reply").click();

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeVisible();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            expect(await page.getByTestId("MessageInputParent").textContent()).toEqual(
                "Carol: fghi. jklmn. opqr. stuv. w",
            );

            await page.getByLabel(/New (message|comment)/).fill("Works!");
            await page.getByLabel(/New (message|comment)/).press("Enter");

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeVisible();

            expect(
                await page
                    .getByTestId(messageTestIdRegExp)
                    .getByTestId("MessageViewParent")
                    .textContent(),
            ).toEqual("Carol: fghi. jklmn. opqr. stuv. w");
        });

        test("can’t reply to range across five messages if they’re not from the same author", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);

            const session1 = await space.createSession({name: "Alice"});
            const session2 = await space.createSession({name: "Bob"});
            const session3 = await space.createSession({name: "Carol"});

            const {room, roomPath} = await testCase.setup({
                session1,
                account2: session2.account,
                account3: session3.account,
            });

            await TestMessagingRoomBase.createMessage(room, session3, "abc");
            await TestMessagingRoomBase.createMessage(room, session3, "defghi");
            await TestMessagingRoomBase.createMessage(room, session3, "jklmn");
            await TestMessagingRoomBase.createMessage(room, session3, "opqr");
            await TestMessagingRoomBase.createMessage(room, session2, "stuv");
            await TestMessagingRoomBase.createMessage(room, session3, "wxyz");

            await services.signIn(browserContext, session1);
            await page.goto(roomPath);

            // Wait for React to mount
            await page.waitForFunction("dev.contentEditor");

            await expect(page.getByText("Reply")).toBeHidden();

            await page.evaluate(
                ([element1, element2]) => {
                    const selection = globalThis.window.getSelection()!;

                    const range = globalThis.document.createRange();
                    range.setStart(element1!.firstChild!, 2);
                    range.setEnd(element2!.firstChild!, 2);

                    selection.removeAllRanges();
                    selection.addRange(range);
                },
                [
                    await page.getByText("defghi").elementHandle(),
                    await page.getByText("jklmn").elementHandle(),
                ],
            );

            await expect(page.getByText("Reply")).toBeVisible();

            await page.evaluate(
                ([element1, element2]) => {
                    const selection = globalThis.window.getSelection()!;

                    const range = globalThis.document.createRange();
                    range.setStart(element1!.firstChild!, 2);
                    range.setEnd(element2!.firstChild!, 2);

                    selection.removeAllRanges();
                    selection.addRange(range);
                },
                [
                    await page.getByText("defghi").elementHandle(),
                    await page.getByText("opqr").elementHandle(),
                ],
            );

            await expect(page.getByText("Reply")).toBeVisible();

            await page.evaluate(
                ([element1, element2]) => {
                    const selection = globalThis.window.getSelection()!;

                    const range = globalThis.document.createRange();
                    range.setStart(element1!.firstChild!, 2);
                    range.setEnd(element2!.firstChild!, 1);

                    selection.removeAllRanges();
                    selection.addRange(range);
                },
                [
                    await page.getByText("defghi").elementHandle(),
                    await page.getByText("wxyz").elementHandle(),
                ],
            );

            await expect(page.getByText("Reply")).toBeHidden();
        });

        test("can reply to range in message stream in first part", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);

            const session1 = await space.createSession({name: "Alice", role: "Admin"});
            const botAccount = await TestBot.createAndInstantiate(session1, {name: "Bob"});
            const session3 = await space.createSession({name: "Carol"});

            const {room, roomPath} = await testCase.setup({
                session1,
                account2: botAccount,
                account3: session3.account,
            });

            await TestMessagingRoomBase.createMessage(room, session3, "01234");

            const streamMessage = await TestMessagingRoomBase.createMessage(
                room,
                botAccount.action(room.getBotScope()),
                {isStream: true},
            );

            await streamMessage.putStreamPart(
                botAccount.action(room.getBotScope()),
                0,
                "abcdefghi",
            );

            await streamMessage.putStreamPart(
                botAccount.action(room.getBotScope()),
                1,
                "jklmnopqr",
            );

            await streamMessage.putStreamPart(botAccount.action(room.getBotScope()), 2, "stuvwxyz");

            await streamMessage.completeStream(botAccount.action(room.getBotScope()));

            const lastMessage = await TestMessagingRoomBase.createMessage(room, session3, "56789");

            await services.signIn(browserContext, session1);
            await page.goto(roomPath);

            // Wait for React to mount
            await page.waitForFunction("dev.contentEditor");

            await expect(page.getByText("Reply")).toBeHidden();

            await page.getByText("abcdefghi").evaluate(element => {
                const selection = globalThis.window.getSelection()!;

                const range = globalThis.document.createRange();
                range.setStart(element.firstChild!, 2);
                range.setEnd(element.firstChild!, 8);

                selection.removeAllRanges();
                selection.addRange(range);
            });

            const messageTestIdRegExp = new RegExp(`^MessageView:[^:]+:${lastMessage.index + 1}$`);

            await expect(page.getByText("Reply")).toBeVisible();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).not.toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            await page.getByText("Reply").click();

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeVisible();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            expect(await page.getByTestId("MessageInputParent").textContent()).toEqual(
                "Bob: cdefgh",
            );

            await page.getByLabel(/New (message|comment)/).fill("Works!");
            await page.getByLabel(/New (message|comment)/).press("Enter");

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeVisible();

            expect(
                await page
                    .getByTestId(messageTestIdRegExp)
                    .getByTestId("MessageViewParent")
                    .textContent(),
            ).toEqual("Bob: cdefgh");
        });

        test("can reply to range in message stream in second part", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);

            const session1 = await space.createSession({name: "Alice", role: "Admin"});
            const botAccount = await TestBot.createAndInstantiate(session1, {name: "Bob"});
            const session3 = await space.createSession({name: "Carol"});

            const {room, roomPath} = await testCase.setup({
                session1,
                account2: botAccount,
                account3: session3.account,
            });

            await TestMessagingRoomBase.createMessage(room, session3, "01234");

            const streamMessage = await TestMessagingRoomBase.createMessage(
                room,
                botAccount.action(room.getBotScope()),
                {isStream: true},
            );

            await streamMessage.putStreamPart(
                botAccount.action(room.getBotScope()),
                0,
                "abcdefghi",
            );

            await streamMessage.putStreamPart(
                botAccount.action(room.getBotScope()),
                1,
                "jklmnopqr",
            );

            await streamMessage.putStreamPart(botAccount.action(room.getBotScope()), 2, "stuvwxyz");

            await streamMessage.completeStream(botAccount.action(room.getBotScope()));

            const lastMessage = await TestMessagingRoomBase.createMessage(room, session3, "56789");

            await services.signIn(browserContext, session1);
            await page.goto(roomPath);

            // Wait for React to mount
            await page.waitForFunction("dev.contentEditor");

            await expect(page.getByText("Reply")).toBeHidden();

            await page.getByText("jklmnopqr").evaluate(element => {
                const selection = globalThis.window.getSelection()!;

                const range = globalThis.document.createRange();
                range.setStart(element.firstChild!, 2);
                range.setEnd(element.firstChild!, 8);

                selection.removeAllRanges();
                selection.addRange(range);
            });

            const messageTestIdRegExp = new RegExp(`^MessageView:[^:]+:${lastMessage.index + 1}$`);

            await expect(page.getByText("Reply")).toBeVisible();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).not.toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            await page.getByText("Reply").click();

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeVisible();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            expect(await page.getByTestId("MessageInputParent").textContent()).toEqual(
                "Bob: lmnopq",
            );

            await page.getByLabel(/New (message|comment)/).fill("Works!");
            await page.getByLabel(/New (message|comment)/).press("Enter");

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeVisible();

            expect(
                await page
                    .getByTestId(messageTestIdRegExp)
                    .getByTestId("MessageViewParent")
                    .textContent(),
            ).toEqual("Bob: lmnopq");
        });

        test("can reply to range in message stream across multiple parts", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);

            const session1 = await space.createSession({name: "Alice", role: "Admin"});
            const botAccount = await TestBot.createAndInstantiate(session1, {name: "Bob"});
            const session3 = await space.createSession({name: "Carol"});

            const {room, roomPath} = await testCase.setup({
                session1,
                account2: botAccount,
                account3: session3.account,
            });

            await TestMessagingRoomBase.createMessage(room, session3, "01234");

            const streamMessage = await TestMessagingRoomBase.createMessage(
                room,
                botAccount.action(room.getBotScope()),
                {isStream: true},
            );

            await streamMessage.putStreamPart(
                botAccount.action(room.getBotScope()),
                0,
                "abcdefghi",
            );

            await streamMessage.putStreamPart(
                botAccount.action(room.getBotScope()),
                1,
                "jklmnopqr",
            );

            await streamMessage.putStreamPart(botAccount.action(room.getBotScope()), 2, "stuvwxyz");

            await streamMessage.completeStream(botAccount.action(room.getBotScope()));

            const lastMessage = await TestMessagingRoomBase.createMessage(room, session3, "56789");

            await services.signIn(browserContext, session1);
            await page.goto(roomPath);

            // Wait for React to mount
            await page.waitForFunction("dev.contentEditor");

            await expect(page.getByText("Reply")).toBeHidden();

            await page.evaluate(
                ([element1, element2]) => {
                    const selection = globalThis.window.getSelection()!;

                    const range = globalThis.document.createRange();
                    range.setStart(element1!.firstChild!, 3);
                    range.setEnd(element2!.firstChild!, 2);

                    selection.removeAllRanges();
                    selection.addRange(range);
                },
                [
                    await page.getByText("abcdefghi").elementHandle(),
                    await page.getByText("stuvwxyz").elementHandle(),
                ],
            );

            const messageTestIdRegExp = new RegExp(`^MessageView:[^:]+:${lastMessage.index + 1}$`);

            await expect(page.getByText("Reply")).toBeVisible();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).not.toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            await page.getByText("Reply").click();

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeVisible();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            expect(await page.getByTestId("MessageInputParent").textContent()).toEqual(
                "Bob: defghi. jklmnopqr. st",
            );

            await page.getByLabel(/New (message|comment)/).fill("Works!");
            await page.getByLabel(/New (message|comment)/).press("Enter");

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeVisible();

            expect(
                await page
                    .getByTestId(messageTestIdRegExp)
                    .getByTestId("MessageViewParent")
                    .textContent(),
            ).toEqual("Bob: defghi. jklmnopqr. st");
        });

        test("if content within replied message range changes then the reply is updated", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);

            const session1 = await space.createSession({name: "Alice"});
            const session2 = await space.createSession({name: "Bob"});
            const session3 = await space.createSession({name: "Carol"});

            const {room, roomPath} = await testCase.setup({
                session1,
                account2: session2.account,
                account3: session3.account,
            });

            await TestMessagingRoomBase.createMessage(room, session2, "abcdefghi");
            const editMessage = await TestMessagingRoomBase.createMessage(
                room,
                session1,
                "jklmnopqr",
            );
            const lastMessage = await TestMessagingRoomBase.createMessage(
                room,
                session3,
                "stuvwxyz",
            );

            await services.signIn(browserContext, session1);
            await page.goto(roomPath);

            // Wait for React to mount
            await page.waitForFunction("dev.contentEditor");

            await expect(page.getByText("Reply")).toBeHidden();

            await page.getByText("jklmnopqr").evaluate(element => {
                const selection = globalThis.window.getSelection()!;

                const range = globalThis.document.createRange();
                range.setStart(element.firstChild!, 2);
                range.setEnd(element.firstChild!, 8);

                selection.removeAllRanges();
                selection.addRange(range);
            });

            const messageTestIdRegExp = new RegExp(`^MessageView:[^:]+:${lastMessage.index + 1}$`);

            await expect(page.getByText("Reply")).toBeVisible();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).not.toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            await page.getByText("Reply").click();

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeVisible();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

            expect(await page.getByTestId("MessageInputParent").textContent()).toEqual(
                "Alice: lmnopq",
            );

            await page.getByLabel(/New (message|comment)/).fill("Works!");
            await page.getByLabel(/New (message|comment)/).press("Enter");

            await expect(page.getByText("Reply")).toBeHidden();
            await expect(page.getByTestId("MessageInputParent")).toBeHidden();
            await expect(page.getByLabel(/New (message|comment)/)).toBeFocused();
            await expect(page.getByTestId(messageTestIdRegExp)).toBeVisible();

            expect(
                await page
                    .getByTestId(messageTestIdRegExp)
                    .getByTestId("MessageViewParent")
                    .textContent(),
            ).toEqual("Alice: lmnopq");

            await expect(
                page
                    .getByTestId(messageTestIdRegExp)
                    .getByTestId("MessageViewParent")
                    .getByText("o"),
            ).toBeVisible();

            await page
                .getByTestId(new RegExp(`^MessageView:[^:]+:${editMessage.index}$`))
                .getByTestId("MessageViewContent")
                .dispatchEvent("contextmenu");
            await page.getByTestId("ContextMenu").getByText("Edit").click();
            await expect(page.getByTestId("ContextMenu").getByText("Edit")).toBeHidden();

            const editMessageInput = page
                .getByTestId(new RegExp(`^MessageView:[^:]+:${editMessage.index}$`))
                .getByRole("textbox");

            await expect(editMessageInput).toBeVisible();
            await expect(editMessageInput).toBeFocused();
            await editMessageInput.press("ArrowRight");
            await editMessageInput.press("ArrowLeft");
            await editMessageInput.press("ArrowLeft");
            await editMessageInput.press("ArrowLeft");
            await editMessageInput.press("Backspace");
            await editMessageInput.press("ArrowLeft");
            await editMessageInput.pressSequentially("123");
            await editMessageInput.press("Enter");

            await expect(
                page
                    .getByTestId(messageTestIdRegExp)
                    .getByTestId("MessageViewParent")
                    .getByText("o"),
            ).toBeHidden();

            expect(
                await page
                    .getByTestId(messageTestIdRegExp)
                    .getByTestId("MessageViewParent")
                    .textContent(),
            ).toEqual("Alice: lm123npq");
        });
    });
}
