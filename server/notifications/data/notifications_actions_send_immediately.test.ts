import {jest} from "@jest/globals";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {subscribeToChannel} from "~/server/forum/data/subscribe_to_channel.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {createOrUpdateAccountWebPushSubscriptionWithoutAuthorization} from "~/server/notifications/data/internal/push/create_or_update_web_push_subscription_without_authorization.js";
import {notificationsInjection} from "~/server/notifications/data/notifications_injection.js";
import {createTestWebPushSubscription} from "~/server/notifications/data/push/test_helpers/create_test_web_push_subscription.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    PostContentProsemirrorSchema,
    assertPostContent,
} from "~/shared/forum/post_content_schema.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BrowserId} from "~/shared/id/types/id_types.js";

const queuePendingSubtleNotificationMock = jest.fn();
const sendWebPushNotificationMock = jest.fn();

jest.unstable_mockModule("./internal/push/queue_pending_subtle_notification.js", () => ({
    queuePendingSubtleNotification: queuePendingSubtleNotificationMock,
}));

// Must be dynamically imported after the mock is set up since it transitively
// imports queue_pending_subtle_notification.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _queueModule = await import("./internal/push/queue_pending_subtle_notification.js");
const {processNotificationEvent} =
    await import("~/server/notifications/data/process/process_notification_event.js");

const context = createTestContext({
    processJob: async (context, job, _jobStartTime, span) => {
        if (job.type === "NotificationEvent") {
            await processNotificationEvent(context, job.event, span);
        } else if (job.type === "SendWebPushNotification") {
            sendWebPushNotificationMock(job.notificationContent);
        }
    },
    notificationsInjection,
    chatInjection,
    documentsInjection,
    tasksInjection,
});

async function registerWebPushSubscription(session: TestSpaceSession): Promise<void> {
    await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
        accountId: session.account.id,
        browserId: generateId<BrowserId>(),
        subscription: createTestWebPushSubscription(
            `https://push.cyberworlds.dev/endpoint-${generateId<BrowserId>()}`,
        ),
    });
}

function createMentionPostContent(accountId: AccountId) {
    return assertPostContent(
        PostContentProsemirrorSchema.node("doc", {}, [
            PostContentProsemirrorSchema.node("paragraph", {}, [
                PostContentProsemirrorSchema.text("Hello "),
                PostContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId,
                        isShort: false,
                    }),
                }),
                PostContentProsemirrorSchema.text("!"),
            ]),
        ]),
    );
}

function createMentionMessageContent(accountId: AccountId) {
    return assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node("paragraph", {}, [
                MessageContentProsemirrorSchema.text("Hello "),
                MessageContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId,
                        isShort: false,
                    }),
                }),
                MessageContentProsemirrorSchema.text("!"),
            ]),
        ]),
    );
}

afterEach(() => {
    jest.clearAllMocks();
});

describe("chat message notification sendImmediately behavior", () => {
    test("a non-loud chat message is sent immediately instead of being queued", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        await registerWebPushSubscription(session1);
        const chat = await TestChat.get(session1, session2);

        // Send first message (loud) and clear the mocks.
        await chat.sendMessage(session2, "First message");
        await ProcessContextModule.waitForTestTasks();
        jest.clearAllMocks();

        // Send second message quickly (non-loud, within 60 minutes of first).
        await chat.sendMessage(session2, "Second message");
        await ProcessContextModule.waitForTestTasks();

        // The second message should be sent immediately even though it is non-loud,
        // because chat messages always use sendImmediately = true.
        expect(sendWebPushNotificationMock).toHaveBeenCalled();
        expect(queuePendingSubtleNotificationMock).not.toHaveBeenCalled();
    });

    test("a non-loud chat message is sent as a silent push notification", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        await registerWebPushSubscription(session1);
        const chat = await TestChat.get(session1, session2);

        // Send first message (loud) and clear the mocks.
        await chat.sendMessage(session2, "First message");
        await ProcessContextModule.waitForTestTasks();
        jest.clearAllMocks();

        // Send second message quickly (non-loud). It should be sent silently since isLoud
        // = false and silent = !isLoud.
        await chat.sendMessage(session2, "Second message");
        await ProcessContextModule.waitForTestTasks();

        expect(sendWebPushNotificationMock).toHaveBeenCalledTimes(1);
        expect(sendWebPushNotificationMock.mock.calls[0]![0]).toMatchObject({silent: true});
    });
});

describe("new post notification sendImmediately behavior", () => {
    test("a new post without a mention is queued as a subtle notification", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        await registerWebPushSubscription(session1);
        const channel = await TestChannel.create(session1);
        await subscribeToChannel(session1.action(), channel.id);
        await channel.access.grant(session1, session2, "Comment");
        await ProcessContextModule.waitForTestTasks();
        jest.clearAllMocks();

        // session2 creates a post in the channel without mentioning session1.
        await channel.createPost(session2, "A post without a mention");
        await ProcessContextModule.waitForTestTasks();

        // The notification should be queued (not sent immediately) since there is no
        // mention.
        expect(sendWebPushNotificationMock).not.toHaveBeenCalled();
        expect(queuePendingSubtleNotificationMock).toHaveBeenCalled();
    });

    test("a new post that mentions the recipient is sent immediately", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        await registerWebPushSubscription(session1);
        const channel = await TestChannel.create(session1);
        await subscribeToChannel(session1.action(), channel.id);
        await channel.access.grant(session1, session2, "Comment");
        await ProcessContextModule.waitForTestTasks();
        jest.clearAllMocks();

        // session2 creates a post in the channel that mentions session1.
        await channel.createPost(session2, createMentionPostContent(session1.account.id));
        await ProcessContextModule.waitForTestTasks();

        // The notification should be sent immediately since session1 was mentioned.
        expect(sendWebPushNotificationMock).toHaveBeenCalled();
        expect(queuePendingSubtleNotificationMock).not.toHaveBeenCalled();
    });
});

describe("post comment notification sendImmediately behavior", () => {
    test("a post comment without a mention is queued as a subtle notification", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        await registerWebPushSubscription(session1);
        const channel = await TestChannel.create(session1);
        const post = await channel.createPost(session1, "Post content");
        await ProcessContextModule.waitForTestTasks();
        jest.clearAllMocks();

        // session2 comments on session1's post without mentioning session1.
        await post.createComment(session2, "A comment without a mention");
        await ProcessContextModule.waitForTestTasks();

        // The notification should be queued (not sent immediately) since there is no
        // mention.
        expect(sendWebPushNotificationMock).not.toHaveBeenCalled();
        expect(queuePendingSubtleNotificationMock).toHaveBeenCalled();
    });

    test("a post comment that mentions the recipient is sent immediately", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        await registerWebPushSubscription(session1);
        const channel = await TestChannel.create(session1);
        const post = await channel.createPost(session1, "Post content");
        await ProcessContextModule.waitForTestTasks();
        jest.clearAllMocks();

        // session2 comments on session1's post, mentioning session1.
        await post.createComment(session2, createMentionMessageContent(session1.account.id));
        await ProcessContextModule.waitForTestTasks();

        // The notification should be sent immediately since session1 was mentioned.
        expect(sendWebPushNotificationMock).toHaveBeenCalled();
        expect(queuePendingSubtleNotificationMock).not.toHaveBeenCalled();
    });
});

describe("document comment notification sendImmediately behavior", () => {
    test("a document comment without a mention is queued as a subtle notification", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        await registerWebPushSubscription(session1);
        const document = await TestDocument.create(session1, {access: "Public"});
        await document.type(session1, "Hello, world!");
        await ProcessContextModule.waitForTestTasks();
        jest.clearAllMocks();

        // session2 creates a comment thread on session1's document without mentioning
        // session1.
        await document.createCommentThread(
            session2,
            {from: 10, to: 11},
            "A comment without a mention",
        );
        await ProcessContextModule.waitForTestTasks();

        // The notification should be queued (not sent immediately) since there is no
        // mention.
        expect(sendWebPushNotificationMock).not.toHaveBeenCalled();
        expect(queuePendingSubtleNotificationMock).toHaveBeenCalled();
    });

    test("a document comment that mentions the recipient is sent immediately", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        await registerWebPushSubscription(session1);
        const document = await TestDocument.create(session1, {access: "Public"});
        await document.type(session1, "Hello, world!");
        await ProcessContextModule.waitForTestTasks();
        jest.clearAllMocks();

        // session2 creates a comment thread on session1's document, mentioning session1.
        await document.createCommentThread(
            session2,
            {from: 10, to: 11},
            createMentionMessageContent(session1.account.id),
        );
        await ProcessContextModule.waitForTestTasks();

        // The notification should be sent immediately since session1 was mentioned.
        expect(sendWebPushNotificationMock).toHaveBeenCalled();
        expect(queuePendingSubtleNotificationMock).not.toHaveBeenCalled();
    });
});

describe("task comment notification sendImmediately behavior", () => {
    test("a task comment without a mention is queued as a subtle notification", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        await registerWebPushSubscription(session1);
        const task = await TestTask.create(session1);
        await task.access.grant(session1, session2, "Comment");
        await ProcessContextModule.waitForTestTasks();
        jest.clearAllMocks();

        // session2 comments on session1's task without mentioning session1.
        await task.createComment(session2, "A comment without a mention");
        await ProcessContextModule.waitForTestTasks();

        // The notification should be queued (not sent immediately) since there is no
        // mention.
        expect(sendWebPushNotificationMock).not.toHaveBeenCalled();
        expect(queuePendingSubtleNotificationMock).toHaveBeenCalled();
    });

    test("a task comment that mentions the recipient is sent immediately", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        await registerWebPushSubscription(session1);
        const task = await TestTask.create(session1);
        await task.access.grant(session1, session2, "Comment");
        await ProcessContextModule.waitForTestTasks();
        jest.clearAllMocks();

        // session2 comments on session1's task, mentioning session1.
        await task.createComment(session2, createMentionMessageContent(session1.account.id));
        await ProcessContextModule.waitForTestTasks();

        // The notification should be sent immediately since session1 was mentioned.
        expect(sendWebPushNotificationMock).toHaveBeenCalled();
        expect(queuePendingSubtleNotificationMock).not.toHaveBeenCalled();
    });
});
