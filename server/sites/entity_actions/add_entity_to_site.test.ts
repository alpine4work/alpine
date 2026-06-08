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
import {addEntityToSite} from "~/server/sites/entity_actions/add_entity_to_site.js";
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
import {generateId} from "~/shared/id/id.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {
    SiteItemSearchEntityId,
    SiteItemSearchEntityIdObject,
    isSiteItemSearchEntityId,
} from "~/shared/search/site_item_search_entity_id.js";
import {SiteEntrySearchEntityModel} from "~/shared/sites/site_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

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
    // Documents are added to a site by sending an access-policy update to the
    // document's collaboration durable object, which doesn't run in the in-process
    // test context. Reimplement that one route directly against the test database.
    sendRequestToDurableObject: handleUpdateContentWithoutOptimisticBroadcastForTest,
});

describe("addEntityToSite", () => {
    // The `Record<SiteItemSearchEntityIdObject["type"], …>` makes TypeScript fail if a
    // new entity type is added to `SiteItemSearchEntityIdObject` without a
    // corresponding test setup here. Each setup is invoked below.
    const entityTypeTests: Record<SiteItemSearchEntityIdObject["type"], () => void> = {
        Channel: () => {
            test("adds a Channel to a site", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();
                const site = await TestSite.create(session, {name: "Test Site"});
                const siteId = site.id;
                const channel = await TestChannel.create(session);
                const entityId: SiteItemSearchEntityId = `Channel:${channel.id}`;

                await addEntityToSite(session.action(), {
                    siteId,
                    spaceId: space.id,
                    entityId,
                    parentId: site.initialRootContainerId,
                    orderKey: assertOrderKey("a0"),
                });

                const [siteItems, channelPreview, sitePreview] = await runAllPromises([
                    getSite(session.action(), {siteId}),
                    getChannelPreview(session.action(), channel.id),
                    getSitePreview(session.action(), siteId),
                ]);

                expect(sitePreview.initialData).toEqual(
                    expect.objectContaining({
                        id: siteId,
                        version: 1,
                        firstEntityId: entityId,
                        rootContainerId: site.initialRootContainerId,
                    }),
                );
                expect(siteItems.items.map(item => item.model)).toEqual([
                    sitePreview,
                    expect.objectContaining({
                        id: site.initialRootContainerId,
                        parentId: null,
                        type: "SideBar",
                        label: "Test Site",
                        version: 1,
                    }),
                    expect.objectContaining({
                        id: entityId,
                        parentId: site.initialRootContainerId,
                        entity: expect.objectContaining(
                            SiteEntrySearchEntityModel.new({
                                type: "Channel",
                                title: "Test Entity",
                                channel: {
                                    id: channel.id,
                                    version: 0,
                                },
                            }),
                        ),
                        version: 1,
                    }),
                ]);
                expect(channelPreview.accessPolicy).toEqual(
                    new AccessPolicyModel({
                        type: "Site",
                        site: sitePreview,
                    }),
                );
            });
        },
        Chat: () => {
            test("adds a Chat room to a site", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();
                const site = await TestSite.create(session, {name: "Test Site"});
                const siteId = site.id;
                const chat = await TestChat.createRoom(session);
                const entityId: SiteItemSearchEntityId = `Chat:${chat.id}`;

                await addEntityToSite(session.action(), {
                    siteId,
                    spaceId: space.id,
                    entityId,
                    parentId: site.initialRootContainerId,
                    orderKey: assertOrderKey("a0"),
                });

                const [siteItems, sitePreview, chatDefinition] = await runAllPromises([
                    getSite(session.action(), {siteId}),
                    getSitePreview(session.action(), siteId),
                    getChatDefinition(session.action(), chat.id),
                ]);

                expect(sitePreview.initialData).toEqual(
                    expect.objectContaining({
                        id: siteId,
                        version: 1,
                        firstEntityId: entityId,
                        rootContainerId: site.initialRootContainerId,
                    }),
                );
                expect(chatDefinition.definition).toEqual(
                    expect.objectContaining({
                        type: "Room",
                        accessPolicy: {type: "Site", siteId},
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
                    expect.objectContaining({
                        id: entityId,
                        parentId: site.initialRootContainerId,
                        entity: expect.objectContaining(
                            SiteEntrySearchEntityModel.new({
                                type: "Chat",
                                title: "Test Entity",
                                chat: {
                                    id: chat.id,
                                    version: 0,
                                    media: {
                                        type: "AccountPile",
                                        previewAccounts: expect.any(Array<AccountModel>),
                                        accountCount: null,
                                    },
                                },
                            }),
                        ),
                        type: "Entity",
                        version: 1,
                    }),
                ]);
            });
        },
        Task: () => {
            test("adds a Task to a site", async () => {
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

                const [siteItems, sitePreview, taskAccessPolicy] = await runAllPromises([
                    getSite(session.action(), {siteId}),
                    getSitePreview(session.action(), siteId),
                    task.access.get(),
                ]);

                expect(sitePreview.initialData).toEqual(
                    expect.objectContaining({
                        id: siteId,
                        version: 1,
                        firstEntityId: entityId,
                        rootContainerId: site.initialRootContainerId,
                    }),
                );
                expect(taskAccessPolicy).toEqual({type: "Site", siteId});
                expect(siteItems.items.map(item => item.model)).toEqual([
                    sitePreview,
                    expect.objectContaining({
                        id: site.initialRootContainerId,
                        label: "Test Site",
                        type: "SideBar",
                        parentId: null,
                        version: 1,
                    }),
                    expect.objectContaining({
                        id: entityId,
                        parentId: site.initialRootContainerId,
                        entity: expect.objectContaining(
                            SiteEntrySearchEntityModel.new({
                                type: "Task",
                                title: "Test Entity",
                                task: {
                                    id: task.id,
                                    titleSnapshot: expect.any(Uint8Array),
                                    displayStatus: {
                                        value: "OpenActive",
                                        version: expect.any(Array),
                                    },
                                },
                            }),
                        ),
                        type: "Entity",
                        version: 1,
                    }),
                ]);
            });
        },
        TaskCollection: () => {
            test("adds a TaskCollection to a site", async () => {
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

                const [siteItems, sitePreview, collectionAccessPolicy] = await runAllPromises([
                    getSite(session.action(), {siteId}),
                    getSitePreview(session.action(), siteId),
                    collection.access.get(),
                ]);

                expect(sitePreview.initialData).toEqual(
                    expect.objectContaining({
                        id: siteId,
                        version: 1,
                        firstEntityId: entityId,
                        rootContainerId: site.initialRootContainerId,
                    }),
                );
                expect(collectionAccessPolicy).toEqual({type: "Site", siteId});
                expect(siteItems.items.map(item => item.model)).toEqual([
                    sitePreview,
                    expect.objectContaining({
                        id: site.initialRootContainerId,
                        label: "Test Site",
                        type: "SideBar",
                        parentId: null,
                        version: 1,
                    }),
                    expect.objectContaining({
                        id: entityId,
                        parentId: site.initialRootContainerId,
                        entity: expect.objectContaining(
                            SiteEntrySearchEntityModel.new({
                                type: "TaskCollection",
                                title: "Test Entity",
                                collection: {
                                    id: collection.id,
                                    titleVersion: expect.any(Array),
                                    color: {
                                        value: null,
                                        version: expect.any(Array),
                                    },
                                },
                            }),
                        ),
                        type: "Entity",
                        version: 1,
                    }),
                ]);
            });
        },
        Document: () => {
            test("adds a Document to a site", async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();
                const site = await TestSite.create(session, {name: "Test Site"});
                const siteId = site.id;
                const document = await TestDocument.create(session, {title: "Test Document"});
                const entityId: SiteItemSearchEntityId = `Document:${document.id}`;

                await addEntityToSite(session.action(), {
                    siteId,
                    spaceId: space.id,
                    entityId,
                    parentId: site.initialRootContainerId,
                    orderKey: assertOrderKey("a0"),
                });

                const [siteItems, sitePreview, documentContent] = await runAllPromises([
                    getSite(session.action(), {siteId}),
                    getSitePreview(session.action(), siteId),
                    getDocumentContent(session.action(), document.id),
                ]);

                expect(sitePreview.initialData).toEqual(
                    expect.objectContaining({
                        id: siteId,
                        version: 1,
                        firstEntityId: entityId,
                        rootContainerId: site.initialRootContainerId,
                    }),
                );
                expect(documentContent.content.attrs.accessPolicy).toEqual({
                    type: "Site",
                    siteId,
                });
                expect(siteItems.items.map(item => item.model)).toEqual([
                    sitePreview,
                    expect.objectContaining({
                        id: site.initialRootContainerId,
                        parentId: null,
                        type: "SideBar",
                        label: "Test Site",
                        version: 1,
                    }),
                    expect.objectContaining({
                        id: entityId,
                        parentId: site.initialRootContainerId,
                        entity: SiteEntrySearchEntityModel.new(
                            expect.objectContaining({type: "Document"}),
                        ),
                        version: 1,
                    }),
                ]);
            });
        },
    };
    for (const setup of Object.values(entityTypeTests)) setup();

    test("adds two entities at different positions", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session, {name: "Test Site"});
        const siteId = site.id;
        const channel1 = await TestChannel.create(session, {name: "Channel 1"});
        const channel2 = await TestChannel.create(session, {name: "Channel 2"});
        const entityId1: SiteItemSearchEntityId = `Channel:${channel1.id}`;
        const entityId2: SiteItemSearchEntityId = `Channel:${channel2.id}`;

        await addEntityToSite(session.action(), {
            siteId,
            spaceId: space.id,
            entityId: entityId1,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a1"),
        });

        const sitePreviewAfterFirstEntity = await getSitePreview(session.action(), siteId);
        expect(sitePreviewAfterFirstEntity.initialData).toEqual(
            expect.objectContaining({
                id: siteId,
                version: 1,
                firstEntityId: entityId1,
                rootContainerId: site.initialRootContainerId,
            }),
        );

        await addEntityToSite(session.action(), {
            siteId,
            spaceId: space.id,
            entityId: entityId2,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a0"),
        });

        const [siteItems, sitePreview, channelPreview1, channelPreview2] = await runAllPromises([
            getSite(session.action(), {siteId}),
            getSitePreview(session.action(), siteId),
            getChannelPreview(session.action(), channel1.id),
            getChannelPreview(session.action(), channel2.id),
        ]);

        expect(sitePreview.initialData).toEqual(
            expect.objectContaining({
                id: siteId,
                version: 2,
                firstEntityId: entityId2,
                rootContainerId: site.initialRootContainerId,
            }),
        );
        expect(siteItems.items.map(item => item.model)).toEqual([
            sitePreview,
            expect.objectContaining({
                id: site.initialRootContainerId,
                parentId: null,
                label: "Test Site",
                type: "SideBar",
                version: 1,
            }),
            expect.objectContaining({
                parentId: site.initialRootContainerId,
                version: 1,
            }),
            expect.objectContaining({
                parentId: site.initialRootContainerId,
                version: 1,
            }),
        ]);
        expect(channelPreview1.accessPolicy).toEqual(
            new AccessPolicyModel({
                type: "Site",
                site: sitePreview,
            }),
        );
        expect(channelPreview2.accessPolicy).toEqual(
            new AccessPolicyModel({
                type: "Site",
                site: sitePreview,
            }),
        );
    });

    test("updates site\u2019s firstEntityId when adding the first entity", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session, {name: "Test Site"});
        const siteId = site.id;

        const previewBefore = await getSitePreview(session.action(), siteId);
        expect(previewBefore.initialData.firstEntityId).toBeNull();

        const channel = await TestChannel.create(session);
        const entityId: SiteItemSearchEntityId = `Channel:${channel.id}`;

        await addEntityToSite(session.action(), {
            siteId,
            spaceId: space.id,
            entityId,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a0"),
        });

        const previewAfter = await getSitePreview(session.action(), siteId);
        expect(previewAfter.initialData.firstEntityId).toBe(entityId);
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

        const channel = await TestChannel.create(session2);
        const entityId: SiteItemSearchEntityId = `Channel:${channel.id}`;

        await expect(
            addEntityToSite(session2.action(), {
                siteId: site.id,
                spaceId: space.id,
                entityId,
                parentId: site.initialRootContainerId,
                orderKey: assertOrderKey("a0"),
            }),
        ).rejects.toThrow("Actor doesn\u2019t have `Manage` access level");
    });

    test("throws when site doesn\u2019t exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const channel = await TestChannel.create(session);
        const entityId: SiteItemSearchEntityId = `Channel:${channel.id}`;

        await expect(
            addEntityToSite(session.action(), {
                siteId: generateId<SiteId>(),
                spaceId: space.id,
                entityId,
                parentId: "SideBar:fake" as any,
                orderKey: assertOrderKey("a0"),
            }),
        ).rejects.toThrow("Site not found");
    });
});
