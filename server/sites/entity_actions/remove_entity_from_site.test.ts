// TODO(#sites): Create testing framework for adding/removing from sites similar to
// the way we have "messaging" tests

import {getChatDefinition} from "~/server/chat/data/get_chat_definition.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {SearchInjection} from "~/server/context/injection_context_module.js";
import {getDocumentContent} from "~/server/documents/data/documents_actions.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {handleUpdateContentWithoutOptimisticBroadcastForTest} from "~/server/documents/test_helpers/handle_update_content_without_optimistic_broadcast_for_test.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getChannelPreview} from "~/server/forum/data/get_channel_preview.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {getSite} from "~/server/sites/data/get_site.js";
import {getSitePreview} from "~/server/sites/data/get_site_preview.js";
import {sitesInjection} from "~/server/sites/data/sites_injection.js";
import {updateSiteAccessPolicy} from "~/server/sites/data/update_site_access_policy.js";
import {addEntityToSite} from "~/server/sites/entity_actions/add_entity_to_site.js";
import {removeEntityFromSite} from "~/server/sites/entity_actions/remove_entity_from_site.js";
import {buildTestSiteEntityData} from "~/server/sites/test_helpers/build_test_site_entity_data.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {AccessPolicyModel} from "~/shared/access/model/access_policy_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {
    SiteItemSearchEntityId,
    SiteItemSearchEntityIdObject,
    isSiteItemSearchEntityId,
} from "~/shared/search/site_item_search_entity_id.js";
import {SiteEntityModel} from "~/shared/sites/site_model.js";

const searchInjection: Partial<SearchInjection> = {
    getSearchMentionEntityIfPossible: async (_context, _spaceId, entityId) => {
        assert(isSiteItemSearchEntityId(entityId));
        return {
            isPrivate: false as const,
            entity: new SearchEntityModel(buildTestSiteEntityData(entityId)),
        };
    },
};

const context = createTestContext({
    sitesInjection,
    searchInjection,
    documentsInjection,
    // Documents are removed from a site by sending an access-policy update to the
    // document's collaboration durable object, which doesn't run in the in-process
    // test context. Reimplement that one route directly against the test database.
    sendRequestToDurableObject: handleUpdateContentWithoutOptimisticBroadcastForTest,
});

describe("removeEntityFromSite", () => {
    // The `Record<SiteItemSearchEntityIdObject["type"], \u2026>` makes TypeScript fail
    // if a new entity type is added to `SiteItemSearchEntityIdObject` without a
    // corresponding test setup here. Each setup is invoked below.
    const entityTypeTests: Record<SiteItemSearchEntityIdObject["type"], () => void> = {
        Channel: () => {
            test("removes a Channel from a site and restores the site\u2019s Local access policy", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();
                const site = await TestSite.create(session, {name: "Test Site"});
                const siteId = site.id;
                const rootContainerId = site.initialRootContainerId;

                const channel = await TestChannel.create(session);
                const entityId: SiteItemSearchEntityId = `Channel:${channel.id}`;

                await updateSiteAccessPolicy(session.action(), {
                    siteId,
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "View"},
                        urlGrant: null,
                    },
                });
                await addEntityToSite(session.action(), {
                    siteId,
                    spaceId: space.id,
                    entityId,
                    parentId: rootContainerId,
                    orderKey: assertOrderKey("a0"),
                });

                // Verify the entity was added
                const previewAfterAdd = await getSitePreview(session.action(), siteId);
                expect(previewAfterAdd.initialData.firstEntityId).toBe(entityId);

                await removeEntityFromSite(session.action(), {siteId, spaceId: space.id, entityId});

                const [siteItems, sitePreview, channelPreview] = await runAllPromises([
                    getSite(session.action(), {siteId}),
                    getSitePreview(session.action(), siteId),
                    getChannelPreview(session.action(), channel.id),
                ]);

                // Site preview: version incremented, firstEntityId cleared
                expect(sitePreview.initialData).toEqual(
                    expect.objectContaining({
                        id: siteId,
                        version: 3,
                        firstEntityId: null,
                        rootContainerId: rootContainerId,
                    }),
                );

                // Site tree: only the SideBar remains, no entities
                expect(siteItems.items.map(item => item.model)).toEqual([
                    sitePreview,
                    expect.objectContaining({
                        id: site.initialRootContainerId,
                        parentId: null,
                        type: "SideBar",
                        label: "Test Site",
                        version: 1,
                    }),
                ]);

                // Channel's access policy should be the site's Local access policy
                expect(channelPreview.accessPolicy).toEqual(
                    new AccessPolicyModel(sitePreview.initialData.accessPolicy),
                );
            });
        },
        Chat: () => {
            test("removes a Chat room from a site and restores Local access policy", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();
                const site = await TestSite.create(session, {name: "Test Site"});

                const chat = await TestChat.createRoom(session);
                const entityId: SiteItemSearchEntityId = `Chat:${chat.id}`;

                await addEntityToSite(session.action(), {
                    siteId: site.id,
                    spaceId: space.id,
                    entityId,
                    parentId: site.initialRootContainerId,
                    orderKey: assertOrderKey("a0"),
                });

                await updateSiteAccessPolicy(session.action(), {
                    siteId: site.id,
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "View"},
                        urlGrant: null,
                    },
                });
                await removeEntityFromSite(session.action(), {
                    siteId: site.id,
                    spaceId: space.id,
                    entityId,
                });

                const [siteItems, sitePreview, chatDefinition] = await runAllPromises([
                    getSite(session.action(), {siteId: site.id}),
                    getSitePreview(session.action(), site.id),
                    getChatDefinition(session.action(), chat.id),
                ]);

                expect(sitePreview.initialData).toEqual(
                    expect.objectContaining({
                        id: site.id,
                        version: 3,
                        firstEntityId: null,
                        accessPolicy: expect.objectContaining({
                            type: "Local",
                            defaultGrant: {level: "View"},
                        }),
                    }),
                );

                // No entities in the site tree
                expect(siteItems.items.map(item => item.model)).toEqual([
                    sitePreview,
                    expect.objectContaining({
                        id: site.initialRootContainerId,
                        type: "SideBar",
                        parentId: null,
                        label: "Test Site",
                        version: 1,
                    }),
                ]);

                // Chat's access policy should be Local
                expect(chatDefinition.definition).toEqual(
                    expect.objectContaining({
                        type: "Room",
                        accessPolicy: sitePreview.initialData.accessPolicy,
                    }),
                );
            });
        },
        Task: () => {
            test("removes a Task from a site and restores Local access policy", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();
                const site = await TestSite.create(session, {name: "Test Site"});
                const siteId = site.id;

                const task = await TestTask.create(session, {title: "Test Task"});
                const entityId: SiteItemSearchEntityId = `Task:${task.id}`;

                await addEntityToSite(session.action(), {
                    siteId,
                    spaceId: space.id,
                    entityId,
                    parentId: site.initialRootContainerId,
                    orderKey: assertOrderKey("a0"),
                });

                await removeEntityFromSite(session.action(), {siteId, spaceId: space.id, entityId});

                const [siteItems, sitePreview, taskAccessPolicy] = await runAllPromises([
                    getSite(session.action(), {siteId}),
                    getSitePreview(session.action(), siteId),
                    task.access.get(),
                ]);

                expect(sitePreview.initialData).toEqual(
                    expect.objectContaining({
                        id: siteId,
                        version: 2,
                        firstEntityId: null,
                    }),
                );

                expect(siteItems.items.map(item => item.model)).toEqual([
                    sitePreview,
                    expect.objectContaining({
                        id: site.initialRootContainerId,
                        type: "SideBar",
                        parentId: null,
                        label: "Test Site",
                        version: 1,
                    }),
                ]);

                // Task's access policy should match the site's Local access policy
                expect(taskAccessPolicy).toEqual(sitePreview.initialData.accessPolicy);
            });
        },
        TaskCollection: () => {
            test("removes a TaskCollection from a site and restores Local access policy", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();
                const site = await TestSite.create(session, {name: "Test Site"});
                const siteId = site.id;

                const collection = await TestTaskCollection.create(session, {
                    name: "Test Collection",
                });
                const entityId: SiteItemSearchEntityId = `TaskCollection:${collection.id}`;

                await addEntityToSite(session.action(), {
                    siteId,
                    spaceId: space.id,
                    entityId,
                    parentId: site.initialRootContainerId,
                    orderKey: assertOrderKey("a0"),
                });

                await removeEntityFromSite(session.action(), {siteId, spaceId: space.id, entityId});

                const [siteItems, sitePreview, collectionAccessPolicy] = await runAllPromises([
                    getSite(session.action(), {siteId}),
                    getSitePreview(session.action(), siteId),
                    collection.access.get(),
                ]);

                expect(sitePreview.initialData).toEqual(
                    expect.objectContaining({
                        id: siteId,
                        version: 2,
                        firstEntityId: null,
                    }),
                );

                expect(siteItems.items.map(item => item.model)).toEqual([
                    sitePreview,
                    expect.objectContaining({
                        id: site.initialRootContainerId,
                        type: "SideBar",
                        parentId: null,
                        label: "Test Site",
                        version: 1,
                    }),
                ]);

                expect(collectionAccessPolicy).toEqual(sitePreview.initialData.accessPolicy);
            });
        },
        Document: () => {
            test("removes a Document from a site and restores Local access policy", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();
                const site = await TestSite.create(session, {name: "Test Site"});
                const siteId = site.id;
                const rootContainerId = site.initialRootContainerId;

                const document = await TestDocument.create(session, {title: "Test Document"});
                const entityId: SiteItemSearchEntityId = `Document:${document.id}`;

                await updateSiteAccessPolicy(session.action(), {
                    siteId,
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "View"},
                        urlGrant: null,
                    },
                });
                await addEntityToSite(session.action(), {
                    siteId,
                    spaceId: space.id,
                    entityId,
                    parentId: rootContainerId,
                    orderKey: assertOrderKey("a0"),
                });

                // Verify the entity was added.
                const previewAfterAdd = await getSitePreview(session.action(), siteId);
                expect(previewAfterAdd.initialData.firstEntityId).toBe(entityId);

                await removeEntityFromSite(session.action(), {siteId, spaceId: space.id, entityId});

                const [sitePreview, documentContent] = await runAllPromises([
                    getSitePreview(session.action(), siteId),
                    getDocumentContent(session.action(), document.id),
                ]);

                expect(sitePreview.initialData.firstEntityId).toBeNull();
                // `removeEntityFromSite` copies the site's Local access policy onto the document,
                // so it's no longer a `Site` policy.
                expect(documentContent.content.attrs.accessPolicy).toEqual(
                    expect.objectContaining({type: "Local"}),
                );
            });
        },
    };
    for (const setup of Object.values(entityTypeTests)) setup();

    test("removal updates firstEntityId to the next entity in DFS order", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session, {name: "Test Site"});
        const siteId = site.id;

        const channel1 = await TestChannel.create(session, {name: "Channel 1"});
        const channel2 = await TestChannel.create(session, {name: "Channel 2"});
        const entityId1: SiteItemSearchEntityId = `Channel:${channel1.id}`;
        const entityId2: SiteItemSearchEntityId = `Channel:${channel2.id}`;

        // Add two entities; channel1 at a0 (first in DFS), channel2 at a1
        await addEntityToSite(session.action(), {
            siteId,
            spaceId: space.id,
            entityId: entityId1,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a0"),
        });
        await addEntityToSite(session.action(), {
            siteId,
            spaceId: space.id,
            entityId: entityId2,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a1"),
        });

        const previewWith2 = await getSitePreview(session.action(), siteId);
        expect(previewWith2.initialData.firstEntityId).toBe(entityId1);

        // Remove the first entity; firstEntityId should shift to channel2
        await removeEntityFromSite(session.action(), {
            siteId,
            spaceId: space.id,
            entityId: entityId1,
        });

        const previewAfterRemoval = await getSitePreview(session.action(), siteId);
        expect(previewAfterRemoval.initialData.firstEntityId).toBe(entityId2);
    });

    test("throws when actor lacks Manage on the site", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const restrictedPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        };
        const site = await TestSite.create(session1, {access: restrictedPolicy});

        const channel = await TestChannel.create(session1);
        const entityId: SiteItemSearchEntityId = `Channel:${channel.id}`;

        await addEntityToSite(session1.action(), {
            siteId: site.id,
            spaceId: space.id,
            entityId,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a0"),
        });

        await expect(
            removeEntityFromSite(session2.action(), {
                siteId: site.id,
                spaceId: space.id,
                entityId,
            }),
        ).rejects.toThrow("Actor doesn\u2019t have `Manage` access level");
    });
});

// =============================================================================
// Edge cases
// =============================================================================

describe("addEntityToSite and removeEntityFromSite edge cases", () => {
    // TODO(#sites): Re-add after removal fails with ConditionalCheckFailed because
    // `dangerouslyGetAddToSiteTransactionEntries` uses
    // `transactionCreateItemWithEvent` which expects the item doesn't exist. After
    // deletion, the realtime table still has a tombstone. Fix by using
    // `transactionCreateOrReplaceItemWithEvent` instead.
    test("add then remove then re-add increments the entity version", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session, {name: "Test Site"});
        const siteId = site.id;
        const rootContainerId = site.initialRootContainerId;

        const channel = await TestChannel.create(session);
        const entityId: SiteItemSearchEntityId = `Channel:${channel.id}`;

        // First add
        await addEntityToSite(session.action(), {
            siteId,
            spaceId: space.id,
            entityId,
            parentId: rootContainerId,
            orderKey: assertOrderKey("a0"),
        });

        const itemsAfterAdd = await getSite(session.action(), {siteId});
        const entityAfterAdd = itemsAfterAdd.items
            .map(item => item.model)
            .find(model => model instanceof SiteEntityModel) as SiteEntityModel;
        expect(entityAfterAdd.version).toBe(1);

        // Remove
        await removeEntityFromSite(session.action(), {siteId, spaceId: space.id, entityId});

        const itemsAfterRemove = await getSite(session.action(), {siteId});
        const entitiesAfterRemove = itemsAfterRemove.items
            .map(item => item.model)
            .filter(model => model instanceof SiteEntityModel);
        expect(entitiesAfterRemove).toHaveLength(0);

        // Re-add at a different position
        await addEntityToSite(session.action(), {
            siteId,
            spaceId: space.id,
            entityId,
            parentId: rootContainerId,
            orderKey: assertOrderKey("a1"),
        });

        const [itemsAfterReAdd, sitePreview] = await runAllPromises([
            getSite(session.action(), {siteId}),
            getSitePreview(session.action(), siteId),
        ]);

        // Entity should be back with an incremented version
        const entityAfterReAdd = itemsAfterReAdd.items
            .map(item => item.model)
            .find(model => model instanceof SiteEntityModel) as SiteEntityModel;
        expect(entityAfterReAdd).toEqual(
            expect.objectContaining({
                id: entityId,
                parentId: rootContainerId,
                version: expect.any(Number),
            }),
        );
        // Version should be higher than the first add
        expect(entityAfterReAdd.version).toBeGreaterThan(entityAfterAdd.version);

        // Site preview version should have been incremented across all 3 operations
        expect(sitePreview.initialData.version).toBeGreaterThanOrEqual(3);
        expect(sitePreview.initialData.firstEntityId).toBe(entityId);
    });
});
