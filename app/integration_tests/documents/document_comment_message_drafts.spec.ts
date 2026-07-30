import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {
    getMessageDraftBehaviorTests,
    getMessageDraftInput,
} from "~/app/integration_tests/helpers/get_message_draft_behavior_tests.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestMessagingRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const {context, services} = createTestServices();
const supportsFileDrop = false;

async function openDocumentCommentThread(page: Page, isMobile: boolean) {
    const input = getMessageDraftInput(page, "comment");
    await expect(input).toBeVisible({timeout: 10_000});
    if (isMobile) {
        const addPlaceholder = page.getByText("Add a comment", {exact: true});
        if (await addPlaceholder.isVisible()) {
            await addPlaceholder.tap();
            const elementHandle = await input.elementHandle();
            if (elementHandle) {
                await elementHandle.waitForElementState("stable");
            }
        }
    }
}

const prepares = {
    prepare: async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice"});
        const document = await TestDocument.create(session, {body: "Hello, world!"});
        const commentThread = await document.createCommentThread(session, {from: 0, to: 5});

        return {
            session,
            surface: {
                type: "DocumentCommentThread" as const,
                documentId: document.id,
                commentThreadId: commentThread.id,
            },
            path: `/doc/${document.id}?thread=${commentThread.id}`,
            messageNoun: "comment" as const,
            draftLabel: "document comment draft",
            prepareInput: openDocumentCommentThread,
        };
    },
    prepareWithMention: async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice"});
        const mentionSession = await space.createSession({name: "Bob"});
        const document = await TestDocument.create(session, {body: "Hello, world!"});
        const commentThread = await document.createCommentThread(session, {from: 0, to: 5});

        return {
            session,
            surface: {
                type: "DocumentCommentThread" as const,
                documentId: document.id,
                commentThreadId: commentThread.id,
            },
            path: `/doc/${document.id}?thread=${commentThread.id}`,
            messageNoun: "comment" as const,
            draftLabel: "document comment mention draft",
            mentionAccountName: mentionSession.account.initialName,
            mentionAccountId: mentionSession.account.id,
            prepareInput: openDocumentCommentThread,
        };
    },
    prepareWithReplyParent: async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice"});
        const document = await TestDocument.create(session, {body: "Hello, world!"});
        const commentThread = await document.createCommentThread(session, {from: 0, to: 5});

        await TestMessagingRoomBase.createMessage(commentThread, session, "jklmnopqr");

        return {
            session,
            surface: {
                type: "DocumentCommentThread" as const,
                documentId: document.id,
                commentThreadId: commentThread.id,
            },
            path: `/doc/${document.id}?thread=${commentThread.id}`,
            messageNoun: "comment" as const,
            draftLabel: "document comment parent draft",
            replyMessageText: "jklmnopqr",
            replyParentStartIndex: 1,
            replyParentEndIndex: 1,
            prepareInput: openDocumentCommentThread,
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
