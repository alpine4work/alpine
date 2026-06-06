import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {pageKeyboardShortcut} from "~/app/integration_tests/helpers/page_keyboard_shortcut.js";
import {getSearchDynamicEntityPathFromEntityIdObject} from "~/client/web/search/core/get_search_entity_path.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {getSearchEntityIndexesForTest} from "~/server/search/data/index/search_entity_index.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {PostContentProsemirrorSchema} from "~/shared/forum/post_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {
    SearchDynamicEntityIdObject,
    SearchMentionEntityType,
    printSearchMentionEntityId,
} from "~/shared/search/search_entity_id.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";

const {context, services} = createTestServices();

const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

const testCaseByEntityType: Record<
    SearchMentionEntityType,
    {
        create: (options: {
            session: TestSpaceSession;
            title: string;
            access: "Public" | "Private" | CreateOrUpdateAccessPolicy;
        }) => Promise<{
            entityId:
                | Exclude<
                      SearchDynamicEntityIdObject & {readonly type: SearchMentionEntityType},
                      {type: "Site"}
                  >
                | {
                      type: "Site";
                      siteId: SiteId;
                      firstEntityId: SiteItemSearchEntityId | null;
                  };
            updateTitle: (
                page: Page,
                options: {oldTitle: string; newTitle: string},
            ) => Promise<void>;
        }>;
    }
> = {
    Document: {
        create: async ({session, title, access}) => {
            const document = await TestDocument.create(session, {title, access});

            return {
                entityId: {type: "Document", documentId: document.id},
                updateTitle: async (page, {oldTitle, newTitle}) => {
                    await page.getByRole("textbox", {name: "Document"}).focus();

                    await page.getByRole("heading", {name: oldTitle}).evaluate(element => {
                        const selection = globalThis.window.getSelection()!;
                        const range = globalThis.document.createRange();

                        // Select all content within the heading element
                        range.selectNodeContents(element);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    });

                    await page.keyboard.press("Backspace");
                    await page.keyboard.type(newTitle);
                },
            };
        },
    },
    Channel: {
        create: async ({session, title, access}) => {
            const channel = await TestChannel.create(session, {name: title, access});

            return {
                entityId: {type: "Channel", channelId: channel.id},
                updateTitle: async (page, {oldTitle, newTitle}) => {
                    await page.getByTestId("PeekStackOverlay").getByText(oldTitle).dblclick();
                    await page.getByPlaceholder(oldTitle).fill(newTitle);
                    await page.getByPlaceholder(oldTitle).press("Enter");
                },
            };
        },
    },
    Chat: {
        create: async ({session, title, access}) => {
            const chat = await TestChat.createRoom(session, {name: title, access});

            return {
                entityId: {type: "Chat", chatId: chat.id},
                updateTitle: async (page, {oldTitle, newTitle}) => {
                    await page.getByTestId("ChatViewTopBar").getByLabel("More").click();
                    await page.getByRole("menuitem", {name: "Edit name"}).click();

                    const roomNameInput = page
                        .getByTestId("ChatViewTopBar")
                        .getByPlaceholder(oldTitle);

                    await roomNameInput.fill(newTitle);
                    await roomNameInput.press("Enter");
                },
            };
        },
    },
    TaskCollection: {
        create: async ({session, title, access}) => {
            const collection = await TestTaskCollection.create(session, {name: title, access});

            return {
                entityId: {type: "TaskCollection", collectionId: collection.id},
                updateTitle: async (page, {oldTitle, newTitle}) => {
                    await page.getByRole("heading", {name: oldTitle}).dblclick();
                    await page.getByPlaceholder(oldTitle).fill(newTitle);
                    await page.getByPlaceholder(oldTitle).press("Enter");
                },
            };
        },
    },
    Task: {
        create: async ({session, title, access}) => {
            const task = await TestTask.create(session, {title});

            const collection = await TestTaskCollection.create(session, {access});
            await task.addCollection(session, collection);

            return {
                entityId: {type: "Task", taskId: task.id},
                updateTitle: async (page, {newTitle}) => {
                    await page.getByTestId("TaskDetailViewMain").getByLabel("Title").click();
                    await page
                        .getByTestId("TaskDetailViewMain")
                        .getByLabel("Title")
                        .press(await pageKeyboardShortcut(page, "mod", "a"));
                    await page.getByTestId("TaskDetailViewMain").getByLabel("Title").fill(newTitle);
                },
            };
        },
    },
    Post: {
        create: async ({session, title, access}) => {
            const channel = await TestChannel.create(session, {access});

            const post = await channel.createPost(session, title);

            return {
                entityId: {type: "Post", postId: post.id},
                updateTitle: async (page, {newTitle}) => {
                    await page.getByTestId("PeekStackOverlay").getByLabel("More").click();
                    await page.getByRole("menuitem", {name: "Edit"}).click();
                    await page
                        .getByLabel("Post")
                        .press(await pageKeyboardShortcut(page, "mod", "a"));
                    await page.getByLabel("Post").fill(newTitle);
                    await page
                        .getByLabel("Post")
                        .press(await pageKeyboardShortcut(page, "mod", "enter"));
                },
            };
        },
    },
    Site: {
        create: async ({session, title, access}) => {
            let accessPolicy: "Public" | "Private" | LocalAccessPolicy;
            if (access === "Private" || access === "Public") {
                accessPolicy = access;
            } else {
                assert(access.type === "Local");
                accessPolicy = access;
            }

            const channel = await TestChannel.create(session, {access: accessPolicy});
            const site = await TestSite.create(session, {name: title, access: accessPolicy});

            const firstEntityId = `Channel:${channel.id}` as const;
            await site.addEntity(session, {
                entityId: firstEntityId,
                parentId: site.initialRootContainerId,
                orderKey: initialOrderKey,
            });

            return {
                entityId: {type: "Site", siteId: site.id, firstEntityId},
                updateTitle: async (page, {newTitle}) => {
                    await page.getByTestId("PeekStackOverlay").getByLabel("More").click();
                    await page.getByRole("menuitem", {name: "Edit"}).click();
                    await page
                        .getByLabel("Post")
                        .press(await pageKeyboardShortcut(page, "mod", "a"));
                    await page.getByLabel("Post").fill(newTitle);
                    await page
                        .getByLabel("Post")
                        .press(await pageKeyboardShortcut(page, "mod", "enter"));
                },
            };
        },
    },
};

for (const [entityType, testCase] of getObjectEntriesWithKeyofType(testCaseByEntityType)) {
    // TODO(#sites): Implement tests for sites
    if (entityType === "Site") continue;

    test(quote`can render and update ${entityType}`, async ({context: browserContext, page}) => {
        const space = await TestSpace.create(context, {name: "Test Space"});
        const session = await space.createSession();

        const entity = await testCase.create({
            session,
            title: "Lorem Ipsum",
            access: "Public",
        });

        const channel = await TestChannel.create(session, {
            name: "Test Channel",
            access: "Public",
        });

        // Force the entity to be indexed immediately. Documents wait ~10 seconds after
        // they're created before they're indexed. We can't wait that long in a test.
        await context.jobs.sendAndWait({
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                ...entity.entityId,
                updatedTraits: {type: "None"},
            },
        });

        await expect(async () => {
            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    printSearchMentionEntityId(entity.entityId),
                ),
            ).not.toBeNull();
        }).toPass({timeout: 5000});

        const post = await channel.createPost(
            session,
            PostContentProsemirrorSchema.node("doc", {}, [
                PostContentProsemirrorSchema.node("paragraph", {}, [
                    PostContentProsemirrorSchema.text("Mention: "),
                    PostContentProsemirrorSchema.node("mention", {
                        mention: cast<ContentMention>({
                            type: "SearchEntity",
                            entityId: printSearchMentionEntityId(entity.entityId),
                        }),
                    }),
                    PostContentProsemirrorSchema.text("."),
                ]),
            ]),
        );

        await services.signIn(browserContext, session);
        await page.goto(`/post/${post.id}`);

        // Wait for React to mount
        await page.waitForFunction("dev.ready");

        await expect(page.getByRole("link", {name: "Lorem Ipsum"})).toBeVisible();
        await expect(page.getByRole("link", {name: "Dolor Sit Amet"})).toBeHidden();

        await page.getByRole("link", {name: "Lorem Ipsum"}).click();

        await expect(page.getByTestId("PeekStack")).toBeVisible();

        await entity.updateTitle(page, {oldTitle: "Lorem Ipsum", newTitle: "Dolor Sit Amet"});

        await expect(page.getByRole("link", {name: "Dolor Sit Amet"})).toBeVisible();
        await expect(page.getByRole("link", {name: "Lorem Ipsum"})).toBeHidden();

        await page.keyboard.press("Escape");

        await expect(page.getByTestId("PeekStack")).toBeHidden();

        await expect(page.getByRole("link", {name: "Dolor Sit Amet"})).toBeVisible();
        await expect(page.getByRole("link", {name: "Lorem Ipsum"})).toBeHidden();
    });

    test(
        quote`can render ${entityType} immediately after creation (possibly before it\u2019s indexed)`,
        async ({context: browserContext, page, viewport}) => {
            assert(viewport);

            const space = await TestSpace.create(context, {name: "Test Space"});
            const session = await space.createSession();

            await services.signIn(browserContext, session);
            await page.goto(`/doc/${generateId()}?create=${space.id}`);

            // Wait for React to mount
            await page.waitForFunction("dev.ready");

            await page.getByRole("textbox", {name: "Document"}).focus();

            await page
                .getByRole("textbox", {name: "Document"})
                .click({position: {x: viewport.width / 2, y: viewport.height - 100}});

            await page.getByRole("textbox", {name: "Document"}).pressSequentially("Mention: ");

            const entity = await testCase.create({
                session,
                title: "Lorem Ipsum",
                access: "Public",
            });

            await expect(page.getByRole("link", {name: "Lorem Ipsum"})).toBeHidden();

            await page.getByRole("textbox", {name: "Document"}).evaluate(
                (documentElement, url) => {
                    const pasteEvent = new Event("paste", {bubbles: true, cancelable: true});

                    Object.assign(pasteEvent, {
                        clipboardData: {
                            types: ["text/plain"],
                            getData: (type: string) => {
                                if (type !== "text/plain") return null;
                                return url;
                            },
                        },
                    });

                    documentElement.dispatchEvent(pasteEvent);
                },
                `${services.getBaseUrl()}${getSearchDynamicEntityPathFromEntityIdObject(space.id, entity.entityId, "wide")}`,
            );

            await expect(page.getByRole("link", {name: "Lorem Ipsum"})).toBeVisible();
            await expect(page.getByRole("link", {name: "Unknown"})).toBeHidden();
        },
    );
}
