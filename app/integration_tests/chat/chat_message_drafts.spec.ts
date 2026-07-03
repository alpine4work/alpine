import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {
    getMessageDraftBehaviorTests,
    getMessageDraftInput,
    seedMessageDraftWithParent,
    waitForDraftMessagesRangeParent,
    waitForDraftToBeEmpty,
    waitForDraftToContainText,
    waitForPageReady,
} from "~/app/integration_tests/helpers/get_message_draft_behavior_tests.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestMessagingRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ChatRealtimeProtocol} from "~/shared/chat/chat_realtime_protocol.js";
import {
    WebSocketMessageFromServer,
    createWebSocketMessageFromClientSchema,
    createWebSocketMessageFromServerSchema,
} from "~/shared/web_socket/web_socket_schema.js";

const {context, services} = createTestServices();
const supportsFileDrop = true;

// Serialize and deserialize chat realtime WebSocket messages with the same schemas
// the production client uses, so simulated failures match the real wire format and
// break at compile time if the protocol changes.
const chatMessageFromClientSchema = createWebSocketMessageFromClientSchema(ChatRealtimeProtocol);
const chatMessageFromServerSchema = createWebSocketMessageFromServerSchema(ChatRealtimeProtocol);

async function failChatCreateMessageProcedure(
    page: Page,
    shouldFail: (attemptCount: number) => boolean,
) {
    let createMessageAttemptCount = 0;

    await page.routeWebSocket("**/api/durable-objects/chat/**", route => {
        const server = route.connectToServer();

        route.onMessage(message => {
            if (typeof message !== "string") {
                server.send(message);
                return;
            }

            const request = chatMessageFromClientSchema.deserialize(JSON.parse(message));
            if (request.type === "ProcedureRequest" && request.input.type === "createMessage") {
                createMessageAttemptCount += 1;

                if (shouldFail(createMessageAttemptCount)) {
                    const response: WebSocketMessageFromServer<typeof ChatRealtimeProtocol> = {
                        type: "ProcedureResponse",
                        requestId: request.requestId,
                        result: {
                            ok: false,
                            outputType: "createMessage",
                            error: {message: "Test create message failure"},
                        },
                    };
                    route.send(JSON.stringify(chatMessageFromServerSchema.serialize(response)));
                    return;
                }
            }

            server.send(message);
        });

        server.onMessage(message => {
            route.send(message);
        });
    });

    return () => createMessageAttemptCount;
}

const prepares = {
    prepare: async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice"});
        const otherSession = await space.createSession({name: "Bob"});
        const chat = await TestChat.get(session, otherSession);

        return {
            session,
            surface: {type: "Chat" as const, chatId: chat.id},
            path: `/chat/${chat.id}`,
            messageNoun: "message" as const,
            draftLabel: "chat draft",
        };
    },
    prepareWithMention: async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice"});
        const mentionSession = await space.createSession({name: "Bob"});
        const chat = await TestChat.get(session, mentionSession);

        return {
            session,
            surface: {type: "Chat" as const, chatId: chat.id},
            path: `/chat/${chat.id}`,
            messageNoun: "message" as const,
            draftLabel: "chat mention draft",
            mentionAccountName: mentionSession.account.initialName,
            mentionAccountId: mentionSession.account.id,
        };
    },
    prepareWithReplyParent: async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice"});
        const otherSession = await space.createSession({name: "Bob"});
        const chat = await TestChat.get(session, otherSession);

        await TestMessagingRoomBase.createMessage(chat, session, "abcdefghi");
        await TestMessagingRoomBase.createMessage(chat, session, "jklmnopqr");

        return {
            session,
            surface: {type: "Chat" as const, chatId: chat.id},
            path: `/chat/${chat.id}`,
            messageNoun: "message" as const,
            draftLabel: "chat parent draft",
            replyMessageText: "jklmnopqr",
            replyParentStartIndex: 1,
            replyParentEndIndex: 1,
        };
    },
};

for (const behaviorTest of getMessageDraftBehaviorTests()) {
    test(behaviorTest.title, async ({page, context: browserContext, isMobile}) => {
        if (behaviorTest.skipOnMobile && isMobile) return;
        if (behaviorTest.requiresFileDrop && !supportsFileDrop) return;

        await behaviorTest.run({page, context: browserContext, isMobile}, prepares, services);
    });
}

// TODO(rmtobin, 06/02/26): These are only in the chat draft tests because the
// other surfaces don't have a good mechanism in tests for causing a message send
// failure. Ideally this would be included in `getMessageDraftBehaviorTests`, but
// we'd need to be able to cause a message send failure for other surfaces.
test("keeps a draft with a reply parent when sending fails", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    if (isMobile) return;

    const scenario = await prepares.prepareWithReplyParent();
    const draftText = `${scenario.draftLabel} with parent send failure`;

    await seedMessageDraftWithParent(scenario.session, scenario.surface, draftText, {
        type: "MessagesRange",
        startIndex: scenario.replyParentStartIndex,
        endIndex: scenario.replyParentEndIndex,
        startContentVersion: 0,
        endContentVersion: 0,
        startPos: 3,
        endPos: 9,
    });

    const getCreateMessageAttemptCount = await failChatCreateMessageProcedure(page, () => true);

    await services.signIn(browserContext, scenario.session);
    await page.goto(scenario.path);
    await waitForPageReady(page);

    await expect(page.getByTestId("MessageInputParent")).toBeVisible();
    await waitForDraftMessagesRangeParent(scenario.session, scenario.surface, {
        startIndex: scenario.replyParentStartIndex,
        endIndex: scenario.replyParentEndIndex,
    });
    await expect(getMessageDraftInput(page, scenario.messageNoun)).toHaveText(draftText, {
        timeout: 10_000,
    });

    await page.getByRole("button", {name: "Send message"}).click();
    await expect(getMessageDraftInput(page, scenario.messageNoun)).toHaveText("");
    expect(getCreateMessageAttemptCount()).toBe(1);

    await waitForDraftMessagesRangeParent(scenario.session, scenario.surface, {
        startIndex: scenario.replyParentStartIndex,
        endIndex: scenario.replyParentEndIndex,
    });
    await waitForDraftToContainText(scenario.session, scenario.surface, draftText);
});

test("clears a draft with a reply parent after a failed send is retried", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    if (isMobile) return;

    const scenario = await prepares.prepareWithReplyParent();
    const draftText = `${scenario.draftLabel} with parent send retry`;

    await seedMessageDraftWithParent(scenario.session, scenario.surface, draftText, {
        type: "MessagesRange",
        startIndex: scenario.replyParentStartIndex,
        endIndex: scenario.replyParentEndIndex,
        startContentVersion: 0,
        endContentVersion: 0,
        startPos: 3,
        endPos: 9,
    });

    const getCreateMessageAttemptCount = await failChatCreateMessageProcedure(
        page,
        attemptCount => attemptCount === 1,
    );

    await services.signIn(browserContext, scenario.session);
    await page.goto(scenario.path);
    await waitForPageReady(page);

    await expect(page.getByTestId("MessageInputParent")).toBeVisible();
    await expect(getMessageDraftInput(page, scenario.messageNoun)).toHaveText(draftText, {
        timeout: 10_000,
    });

    await page.getByRole("button", {name: "Send message"}).click();
    const retryButton = page.getByRole("button", {
        name: /Couldn.t send message\. Click to try again\./,
    });
    await expect(retryButton).toBeVisible();

    await retryButton.click();

    await expect(page.getByTestId("MessageInputParent")).toBeHidden();
    await waitForDraftToBeEmpty(scenario.session, scenario.surface);
    expect(getCreateMessageAttemptCount()).toBe(2);
});
