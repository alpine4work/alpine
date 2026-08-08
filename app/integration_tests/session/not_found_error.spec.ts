import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateId} from "~/shared/id/id.js";
import {AppSpaceRouteId} from "~/shared/remix/app_space_route_id.js";

const {context, services} = createTestServices();

type RemoveSpaceFromAppSpaceRouteId<T> = T extends `routes/_space.${infer U}` ? U : never;

// Extract all routes that have at least one non-`$spaceId` segment.
type ExtractDynamicRouteId<T> = T extends `${string}$spaceId${string}`
    ? T & `${string}$${string}$${string}`
    : T & `${string}$${string}`;

type AppSpaceDynamicRouteId = ExtractDynamicRouteId<
    RemoveSpaceFromAppSpaceRouteId<AppSpaceRouteId>
>;

// We use TypeScript to make sure every dynamic route has an integration test here.
// If you add a new route then the TypeScript type will update and you'll get a
// TypeScript error. When this happens please add a test here.
const testCases: Record<AppSpaceDynamicRouteId, () => void> = {
    "channel.$channelId._index": () => {
        test("not found error for route `channel.$channelId._index`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/channel/${generateId()}`);

            await expect(page.getByText("This channel doesn\u2019t exist")).toBeVisible();
        });
    },
    "channel.$channelId.files": () => {
        test("not found error for route `channel.$channelId.files`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/channel/${generateId()}/files`);

            await expect(page.getByText("This channel doesn\u2019t exist")).toBeVisible();
        });
    },
    "chat.$chatId._index": () => {
        test("not found error for route `chat.$chatId`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/chat/${generateId()}`);

            await expect(page.getByText("This chat doesn\u2019t exist")).toBeVisible();
        });
    },
    "chat.$chatId.message.$index.reactions": () => {
        test("not found error for route `chat.$chatId.message.$index.reactions`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/chat/${generateId()}/message/42/reactions`);

            await expect(page.getByText("This chat doesn\u2019t exist")).toBeVisible();
        });
    },
    "chat.with.$accountId.$spaceId": () => {
        test("not found error for route `chat.with.$accountId.$spaceId`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/chat/with/${generateId()}/${space.id}`);

            await expect(page.getByText("This person doesn\u2019t exist")).toBeVisible();
        });
    },
    "databases.$spaceId.$tableOrViewId": () => {
        test("not found error for route `databases.$spaceId.$tableOrViewId`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/database/${generateId()}`);

            await expect(page.getByText("Database not found")).toBeVisible();
        });
    },
    "doc.$documentId._index": () => {
        test("not found error for route `doc.$documentId._index`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/doc/${generateId()}`);

            await expect(page.getByText("This document doesn\u2019t exist")).toBeVisible();
        });
    },
    "doc.$documentId.thread.$commentThreadId._index": () => {
        test("not found error for route `doc.$documentId.thread.$commentThreadId`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const document = await TestDocument.create(session);

            await services.signIn(browserContext, session);
            await page.goto(`/doc/${document.id}/thread/${generateId()}`);

            await expect(page.getByText("This comment thread doesn\u2019t exist")).toBeVisible();
        });
    },
    "doc.$documentId.thread.$commentThreadId.comment.$index.reactions": () => {
        test("not found error for route `doc.$documentId.thread.$commentThreadId.comment.$index.reactions`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const document = await TestDocument.create(session);

            await services.signIn(browserContext, session);
            await page.goto(`/doc/${document.id}/thread/${generateId()}/comment/42/reactions`);

            await expect(page.getByText("This comment thread doesn\u2019t exist")).toBeVisible();
        });
    },
    "doc.$documentId.duplicate": () => {
        // Doesn't actually load document data so won't throw a not found error on load.
    },
    "notifications.channel-posts.$channelIdAndBucketGeneration": () => {
        // Users generally won't navigate to this route on their own. Don't bother testing
        // the 404 not found page.
    },
    "notifications.document-threads.$documentIdAndBucketGeneration": () => {
        // Users generally won't navigate to this route on their own. Don't bother testing
        // the 404 not found page.
    },
    "post.$postId._index": () => {
        test("not found error for route `post.$postId._index`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/post/${generateId()}`);

            await expect(page.getByText("This post doesn\u2019t exist")).toBeVisible();
        });
    },
    "post.$postId.reactions": () => {
        test("not found error for route `post.$postId.reactions`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/post/${generateId()}/reactions`);

            await expect(page.getByText("This post doesn\u2019t exist")).toBeVisible();
        });
    },
    "post.$postId.comment.$index.reactions": () => {
        test("not found error for route `post.$postId.comment.$index.reactions`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/post/${generateId()}/comment/42/reactions`);

            await expect(page.getByText("This post doesn\u2019t exist")).toBeVisible();
        });
    },
    "post.new.$draftId.$spaceId": () => {
        // This route accepts any chronological ID the user passes in. It'll error on
        // random IDs but this is a legitimate error.
    },
    "settings.$spaceId.bots.$botId": () => {
        test("not found error for route `settings.$spaceId.bots.$botId`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/settings/${space.id}/bots/${generateId()}`);

            await expect(page.getByText("This bot doesn\u2019t exist")).toBeVisible();
        });
    },
    "site.$siteId._index": () => {
        test("not found error for route `site.$siteId._index`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/site/${generateId()}`);

            await expect(page.getByText("This site doesn\u2019t exist")).toBeVisible();
        });
    },
    "site.$siteId.navigate": () => {
        test("not found error for route `site.$siteId.navigate`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/site/${generateId()}/navigate`);

            await expect(page.getByText("This site doesn\u2019t exist")).toBeVisible();
        });
    },
    "task.$taskId._index": () => {
        test("not found error for route `task.$taskId._index`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/task/${generateId()}`);

            await expect(page.getByText("This task doesn\u2019t exist")).toBeVisible();
        });
    },
    "task.$taskId.comment.$index.reactions": () => {
        test("not found error for route `task.$taskId.comment.$index.reactions`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/task/${generateId()}/comment/42/reactions`);

            await expect(page.getByText("This task doesn\u2019t exist")).toBeVisible();
        });
    },
    "task.$taskId.duplicate": () => {
        // Doesn't actually load task data so won't throw a not found error on load.
    },
    "task-collection.$collectionId": () => {
        test("not found error for route `task-collection.$collectionId`", async ({
            page,
            context: browserContext,
        }) => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/task-collection/${generateId()}`);

            await expect(page.getByText("This task collection doesn\u2019t exist")).toBeVisible();
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
    await page.goto(`/home/${generateId()}`);

    await expect(page.getByText("You don\u2019t have access to this space")).toBeVisible();
});
