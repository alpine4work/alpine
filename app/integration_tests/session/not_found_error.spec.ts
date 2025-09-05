import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateId} from "~/shared/id/id.js";
import {AppSpaceRouteId} from "~/shared/remix/app_space_route_id.js";

const {context, services} = createTestServices();

type RemoveSpaceFromAppSpaceRouteId<T> = T extends `routes/s.$spaceId.${infer U}` ? U : never;

type AppSpaceDynamicRouteId = RemoveSpaceFromAppSpaceRouteId<AppSpaceRouteId> &
    `${string}$${string}`;

// We use TypeScript to make sure every dynamic route has an integration test
// here. If you add a new route then the TypeScript type will update and you'll
// get a TypeScript error. When this happens please add a test here.
const testCases: Record<AppSpaceDynamicRouteId, () => void> = {
    "accounts.$accountId": () => {
        // This route only redirects to `/chat/with/${accountId}` right now so it
        // doesn't have its own not found page.
    },
    "channels.$channelId._index": () => {
        test("not found error for route `channels.$channelId._index`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/s/${space.id}/channels/${generateId()}`);

            await expect(page.getByText("This channel doesn’t exist")).toBeVisible();
        });
    },
    "channels.$channelId.files": () => {
        test("not found error for route `channels.$channelId.files`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/s/${space.id}/channels/${generateId()}/files`);

            await expect(page.getByText("This channel doesn’t exist")).toBeVisible();
        });
    },
    "chat.$chatId": () => {
        test("not found error for route `chat.$chatId`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/s/${space.id}/chat/${generateId()}`);

            await expect(page.getByText("This chat doesn’t exist")).toBeVisible();
        });
    },
    "chat.with.$accountId": () => {
        test("not found error for route `chat.with.$accountId`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/s/${space.id}/chat/with/${generateId()}`);

            await expect(page.getByText("This person doesn’t exist")).toBeVisible();
        });
    },
    "documents.$documentId._index": () => {
        test("not found error for route `documents.$documentId._index`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/s/${space.id}/documents/${generateId()}`);

            await expect(page.getByText("This document doesn’t exist")).toBeVisible();
        });
    },
    "documents.$documentId.comments.$commentThreadId": () => {
        test("not found error for route `documents.$documentId.comments.$commentThreadId`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const document = await TestDocument.create(session);

            await services.signIn(browserContext, session);
            await page.goto(`/s/${space.id}/documents/${document.id}/comments/${generateId()}`);

            await expect(page.getByText("This comment thread doesn’t exist")).toBeVisible();
        });
    },
    "notifications.channel-posts.$channelIdAndBucketGeneration": () => {
        // Users generally won't navigate to this route on their own. Don't bother
        // testing the 404 not found page.
    },
    "notifications.document-comment-threads.$documentIdAndBucketGeneration": () => {
        // Users generally won't navigate to this route on their own. Don't bother
        // testing the 404 not found page.
    },
    "posts.$postId": () => {
        test("not found error for route `posts.$postId`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/s/${space.id}/posts/${generateId()}`);

            await expect(page.getByText("This post doesn’t exist")).toBeVisible();
        });
    },
    "posts.new.$draftId": () => {
        // This route accepts any chronological ID the user passes in. It'll error on
        // random IDs but this is a legitimate error.
    },
    "tasks.$taskId._index": () => {
        test("not found error for route `tasks.$taskId._index`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/s/${space.id}/tasks/${generateId()}`);

            await expect(page.getByText("This task doesn’t exist")).toBeVisible();
        });
    },
    "tasks.$taskId.comments": () => {
        test("not found error for route `tasks.$taskId.comments`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/s/${space.id}/tasks/${generateId()}/comments`);

            await expect(page.getByText("This task doesn’t exist")).toBeVisible();
        });
    },
    "tasks.collections.$collectionId": () => {
        test("not found error for route `tasks.collections.$collectionId`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/s/${space.id}/tasks/collections/${generateId()}`);

            await expect(page.getByText("This task collection doesn’t exist")).toBeVisible();
        });
    },
};

for (const testCase of Object.values(testCases)) {
    testCase();
}

test("not found error for root space route", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${generateId()}`);

    await expect(page.getByText("You don’t have access to this space")).toBeVisible();
});
