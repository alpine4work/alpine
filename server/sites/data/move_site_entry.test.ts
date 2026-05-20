import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {moveSiteEntry} from "~/server/sites/data/move_site_entry.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {OrderKey, assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId, SiteId, SiteSideBarSectionId} from "~/shared/id/types/id_types.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {SiteContainerId, printSiteContainerId} from "~/shared/sites/site_entry_id.js";

const context = createTestContext();

function makeEntityId(): SiteItemSearchEntityId {
    return `Channel:${generateId<ChannelId>()}`;
}

/**
 * Direct DB write of an `EntityRef`. Used because most tests in this file only
 * care about the site tree structure and never create a real backing entity, so
 * the real `addEntityToSite` action (which updates the entity's own access policy)
 * would fail. `TestSite.addEntity` is the right call when there's a real entity
 * behind the id.
 */
async function createEntityItem(
    space: Awaited<ReturnType<typeof TestSpace.create>>,
    siteId: SiteId,
    {
        entityId,
        parentId,
        orderKey,
    }: {
        entityId: SiteItemSearchEntityId;
        parentId: SiteContainerId;
        orderKey: OrderKey;
    },
): Promise<void> {
    await SitesTable.createItem(space.systemAction(), {
        partitionType: "Site",
        sortRangeType: "Entity",
        siteId,
        id: entityId,
        type: "Entity",
        orderKey,
        parentId,
        spaceId: space.id,
    });
}

describe("moveSiteEntry", () => {
    test("reorders a SideBarSection within the same parent", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const sectionId = await site.addSection(session, {
            orderKey: assertOrderKey("a0"),
            parent: site.initialSideBarRoot,
        });

        const result = await moveSiteEntry(session.action(), {
            siteId: site.id,
            item: {
                type: "SideBarSection",
                id: sectionId,
                newPosition: {
                    parentId: printSiteContainerId(site.initialSideBarRoot),
                    orderKey: assertOrderKey("a1"),
                },
            },
        });

        expect(result.getRynamoEventTransaction).toBeDefined();
    });

    test("moves a SideBarSection to a different parent", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const parentSectionId = await site.addSection(session, {
            orderKey: assertOrderKey("a0"),
            parent: site.initialSideBarRoot,
        });

        const childSectionId = await site.addSection(session, {
            orderKey: assertOrderKey("a1"),
            parent: site.initialSideBarRoot,
        });

        const result = await moveSiteEntry(session.action(), {
            siteId: site.id,
            item: {
                type: "SideBarSection",
                id: childSectionId,
                newPosition: {
                    parentId: printSiteContainerId({type: "SideBarSection", id: parentSectionId}),
                    orderKey: assertOrderKey("a0"),
                },
            },
        });

        expect(result.getRynamoEventTransaction).toBeDefined();
    });

    test("moves an Entity to a different container", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const sectionId = await site.addSection(session, {
            orderKey: assertOrderKey("a0"),
            parent: site.initialSideBarRoot,
        });
        const sectionContainerId = printSiteContainerId({type: "SideBarSection", id: sectionId});

        const entityId = makeEntityId();
        await createEntityItem(space, site.id, {
            entityId,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a1"),
        });

        const result = await moveSiteEntry(session.action(), {
            siteId: site.id,
            item: {
                type: "Entity",
                id: entityId,
                newPosition: {
                    parentId: sectionContainerId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        });

        expect(result.getRynamoEventTransaction).toBeDefined();

        // Verify the entity was actually re-parented under the section.
        const movedItem = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "Entity",
            siteId: site.id,
            id: entityId,
        });
        expect(movedItem.parentId).toBe(sectionContainerId);
    });

    test("rejects move that would create a cycle", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        // Section A is a child of the SideBar; Section B is a child of A. Attempting to
        // move Section A under Section B should fail because B is currently a descendant
        // of A.
        const sectionAId = await site.addSection(session, {
            orderKey: assertOrderKey("a0"),
            parent: site.initialSideBarRoot,
        });

        const sectionBId = await site.addSection(session, {
            orderKey: assertOrderKey("a0"),
            parent: {type: "SideBarSection", id: sectionAId},
        });

        await expect(
            moveSiteEntry(session.action(), {
                siteId: site.id,
                item: {
                    type: "SideBarSection",
                    id: sectionAId,
                    newPosition: {
                        parentId: printSiteContainerId({type: "SideBarSection", id: sectionBId}),
                        orderKey: assertOrderKey("a0"),
                    },
                },
            }),
        ).rejects.toThrow("Moving this item would create a cycle in the tree.");
    });

    test("no-ops when item is already in the requested position", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const sectionId = await site.addSection(session, {
            orderKey: assertOrderKey("a0"),
            parent: site.initialSideBarRoot,
        });

        const result = await moveSiteEntry(session.action(), {
            siteId: site.id,
            item: {
                type: "SideBarSection",
                id: sectionId,
                newPosition: {
                    parentId: printSiteContainerId(site.initialSideBarRoot),
                    orderKey: assertOrderKey("a0"),
                },
            },
        });

        const events = await result.getRynamoEventTransaction(session.action());
        expect(events).toEqual([]);
    });

    test("throws NotFoundError when the item being moved does not exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        await expect(
            moveSiteEntry(session.action(), {
                siteId: site.id,
                item: {
                    type: "SideBarSection",
                    id: generateId<SiteSideBarSectionId>(),
                    newPosition: {
                        parentId: printSiteContainerId(site.initialSideBarRoot),
                        orderKey: assertOrderKey("a0"),
                    },
                },
            }),
        ).rejects.toThrow(NotFoundError);
    });

    test("throws NotFoundError when the new parent does not exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const sectionId = await site.addSection(session, {
            orderKey: assertOrderKey("a0"),
            parent: site.initialSideBarRoot,
        });

        await expect(
            moveSiteEntry(session.action(), {
                siteId: site.id,
                item: {
                    type: "SideBarSection",
                    id: sectionId,
                    newPosition: {
                        parentId: printSiteContainerId({
                            type: "SideBarSection",
                            id: generateId<SiteSideBarSectionId>(),
                        }),
                        orderKey: assertOrderKey("a0"),
                    },
                },
            }),
        ).rejects.toThrow(NotFoundError);
    });

    test("throws PermissionDeniedError when actor lacks Manage access", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);
        const site = await TestSite.create(session1);

        const sectionId = await site.addSection(session1, {
            orderKey: assertOrderKey("a0"),
            parent: site.initialSideBarRoot,
        });

        await expect(
            moveSiteEntry(session2.action(), {
                siteId: site.id,
                item: {
                    type: "SideBarSection",
                    id: sectionId,
                    newPosition: {
                        parentId: printSiteContainerId(site.initialSideBarRoot),
                        orderKey: assertOrderKey("a1"),
                    },
                },
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("updates firstEntityId when moving entity changes DFS order", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        // Two sections: A (orderKey a0) and B (orderKey a1)
        const sectionAId = await site.addSection(session, {
            orderKey: assertOrderKey("a0"),
            parent: site.initialSideBarRoot,
        });
        const sectionBId = await site.addSection(session, {
            orderKey: assertOrderKey("a1"),
            parent: site.initialSideBarRoot,
        });

        // Entity under section B
        const entityId = makeEntityId();
        await createEntityItem(space, site.id, {
            entityId,
            parentId: printSiteContainerId({type: "SideBarSection", id: sectionBId}),
            orderKey: assertOrderKey("a0"),
        });

        // Move entity to section A — it is now the first entity in DFS order
        await moveSiteEntry(session.action(), {
            siteId: site.id,
            item: {
                type: "Entity",
                id: entityId,
                newPosition: {
                    parentId: printSiteContainerId({type: "SideBarSection", id: sectionAId}),
                    orderKey: assertOrderKey("a0"),
                },
            },
        });

        const attrs = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "Attributes",
            siteId: site.id,
        });
        expect(attrs.firstEntityId).toBe(entityId);
    });

    test("deep cycle detection: A → B → C, moving A under C", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        // SideBar → A → B → C
        const sectionAId = await site.addSection(session, {
            orderKey: assertOrderKey("a0"),
            parent: site.initialSideBarRoot,
        });
        const sectionBId = await site.addSection(session, {
            orderKey: assertOrderKey("a0"),
            parent: {type: "SideBarSection", id: sectionAId},
        });
        const sectionCId = await site.addSection(session, {
            orderKey: assertOrderKey("a0"),
            parent: {type: "SideBarSection", id: sectionBId},
        });

        // Moving A under C should create a cycle: C → A → B → C
        await expect(
            moveSiteEntry(session.action(), {
                siteId: site.id,
                item: {
                    type: "SideBarSection",
                    id: sectionAId,
                    newPosition: {
                        parentId: printSiteContainerId({type: "SideBarSection", id: sectionCId}),
                        orderKey: assertOrderKey("a0"),
                    },
                },
            }),
        ).rejects.toThrow("Moving this item would create a cycle in the tree.");
    });

    test("moves entity within same parent to different orderKey", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const entityId = makeEntityId();
        await createEntityItem(space, site.id, {
            entityId,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a0"),
        });

        const result = await moveSiteEntry(session.action(), {
            siteId: site.id,
            item: {
                type: "Entity",
                id: entityId,
                newPosition: {
                    parentId: site.initialRootContainerId,
                    orderKey: assertOrderKey("a1"),
                },
            },
        });

        expect(result.getRynamoEventTransaction).toBeDefined();
    });

    test("moving entity to same parent but different orderKey succeeds", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const entityId = makeEntityId();
        await createEntityItem(space, site.id, {
            entityId,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a0"),
        });

        await moveSiteEntry(session.action(), {
            siteId: site.id,
            item: {
                type: "Entity",
                id: entityId,
                newPosition: {
                    parentId: site.initialRootContainerId,
                    orderKey: assertOrderKey("a1"),
                },
            },
        });

        const movedItem = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "Entity",
            siteId: site.id,
            id: entityId,
        });
        expect(movedItem.parentId).toBe(site.initialRootContainerId);
    });

    test("move entity to different parent with same orderKey succeeds", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const sectionId = await site.addSection(session, {
            orderKey: assertOrderKey("a0"),
            parent: site.initialSideBarRoot,
        });

        const entityId = makeEntityId();
        await createEntityItem(space, site.id, {
            entityId,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a0"),
        });

        // Move to section with same orderKey a0 — different parent, so not a no-op
        const result = await moveSiteEntry(session.action(), {
            siteId: site.id,
            item: {
                type: "Entity",
                id: entityId,
                newPosition: {
                    parentId: printSiteContainerId({type: "SideBarSection", id: sectionId}),
                    orderKey: assertOrderKey("a0"),
                },
            },
        });

        expect(result.getRynamoEventTransaction).toBeDefined();
    });
});
