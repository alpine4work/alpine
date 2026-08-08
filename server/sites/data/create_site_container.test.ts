import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createSiteContainer} from "~/server/sites/data/create_site_container.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {SiteSideBarId, SiteSideBarSectionId} from "~/shared/id/types/id_types.open_source.js";
import {printSiteContainerId} from "~/shared/sites/site_entry_id.js";

const context = createTestContext();

describe("createSiteContainer", () => {
    test("creates a SideBarSection under a SideBar", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const sectionId = generateId<SiteSideBarSectionId>();
        await createSiteContainer(session.action(), site.id, {
            orderKey: assertOrderKey("a0"),
            label: "My Section",
            container: {
                type: "SideBarSection",
                id: sectionId,
                parent: site.initialSideBarRoot,
            },
        });

        const item = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "SideBarSection",
            siteId: site.id,
            id: sectionId,
        });

        expect(item).toMatchObject({
            label: "My Section",
            parentId: site.initialRootContainerId,
        });
    });

    test("creates a SideBarSection under another SideBarSection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const parentSectionId = await site.addSection(session, {
            label: "Parent Section",
            orderKey: assertOrderKey("a0"),
            parent: site.initialSideBarRoot,
        });

        const childSectionId = generateId<SiteSideBarSectionId>();
        await createSiteContainer(session.action(), site.id, {
            orderKey: assertOrderKey("a0"),
            label: "Child Section",
            container: {
                type: "SideBarSection",
                id: childSectionId,
                parent: {type: "SideBarSection", id: parentSectionId},
            },
        });

        const item = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "SideBarSection",
            siteId: site.id,
            id: childSectionId,
        });

        expect(item.parentId).toBe(
            printSiteContainerId({type: "SideBarSection", id: parentSectionId}),
        );
    });

    test("throws when parent doesn\u2019t exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        await expect(
            createSiteContainer(session.action(), site.id, {
                orderKey: assertOrderKey("a0"),
                label: "Orphan Section",
                container: {
                    type: "SideBarSection",
                    parent: {type: "SideBar", id: generateId<SiteSideBarId>()},
                },
            }),
        ).rejects.toThrow("Parent item not found");
    });

    test("throws PermissionDeniedError when actor lacks Manage access", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);
        const site = await TestSite.create(session1);

        await expect(
            createSiteContainer(session2.action(), site.id, {
                orderKey: assertOrderKey("a0"),
                label: "Unauthorized Section",
                container: {
                    type: "SideBarSection",
                    parent: site.initialSideBarRoot,
                },
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("returns events for site attributes update and new container", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session, {root: {type: "TopBar"}});

        const result = await createSiteContainer(session.action(), site.id, {
            orderKey: assertOrderKey("a0"),
            label: "New SideBar",
            container: {
                type: "SideBar",
                parent: site.initialTopBarRoot,
            },
        });

        const events = await result.getRynamoEvents(session.action());

        expect(events).toHaveLength(2);
    });

    test("custom id is respected when provided via container.id", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const customId = generateId<SiteSideBarSectionId>();
        await createSiteContainer(session.action(), site.id, {
            orderKey: assertOrderKey("a0"),
            label: "Custom ID Section",
            container: {
                type: "SideBarSection",
                id: customId,
                parent: site.initialSideBarRoot,
            },
        });

        const item = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "SideBarSection",
            siteId: site.id,
            id: customId,
        });

        expect(item.id).toBe(customId);
    });

    test("rejects recreating a previously deleted SideBarSection with the same id", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const sectionId = generateId<SiteSideBarSectionId>();
        await createSiteContainer(session.action(), site.id, {
            orderKey: assertOrderKey("a0"),
            label: "Original Label",
            container: {
                type: "SideBarSection",
                id: sectionId,
                parent: site.initialSideBarRoot,
            },
        });

        const createdItem = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "SideBarSection",
            siteId: site.id,
            id: sectionId,
        });
        await SitesTable.deleteItem(session.action(), createdItem);

        // `createSiteContainer` always creates a fresh container — it doesn't undelete an
        // existing soft-deleted one. The transaction's gravestone-exclusion check fails
        // when an id collides with a previously deleted container, surfacing as a
        // condition-check error instead of silently reviving stale properties.
        await expect(
            createSiteContainer(session.action(), site.id, {
                orderKey: assertOrderKey("a1"),
                label: "Revived Label",
                container: {
                    type: "SideBarSection",
                    id: sectionId,
                    parent: site.initialSideBarRoot,
                },
            }),
        ).rejects.toThrow();
    });
});
