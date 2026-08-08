import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {deleteSiteContainer} from "~/server/sites/data/delete_site_container.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {SiteSideBarSectionId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext();

describe("deleteSiteContainer", () => {
    test("deletes an empty SideBarSection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const sectionId = await site.addSection(session, {
            label: "Doomed Section",
            orderKey: assertOrderKey("a0"),
            parent: site.initialSideBarRoot,
        });

        await deleteSiteContainer(session.action(), {
            siteId: site.id,
            container: {type: "SideBarSection", id: sectionId},
        });

        const item = await SitesTable.getItemIfExists(session.action(), {
            partitionType: "Site",
            sortRangeType: "SideBarSection",
            siteId: site.id,
            id: sectionId,
        });

        expect(item).toBeNull();
    });

    test("throws when container has children", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const parentSectionId = await site.addSection(session, {
            label: "Parent",
            orderKey: assertOrderKey("a0"),
            parent: site.initialSideBarRoot,
        });

        await site.addSection(session, {
            label: "Child",
            orderKey: assertOrderKey("a0"),
            parent: {type: "SideBarSection", id: parentSectionId},
        });

        await expect(
            deleteSiteContainer(session.action(), {
                siteId: site.id,
                container: {type: "SideBarSection", id: parentSectionId},
            }),
        ).rejects.toThrow("Can\u2019t delete a container that has children");
    });

    test("throws when trying to delete the root container", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        await expect(
            deleteSiteContainer(session.action(), {
                siteId: site.id,
                container: site.initialSideBarRoot,
            }),
        ).rejects.toThrow("Can\u2019t delete the Site\u2019s root element");
    });

    test("throws PermissionDeniedError when actor lacks Manage access", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);
        const site = await TestSite.create(session1);

        const sectionId = await site.addSection(session1, {
            label: "Section",
            orderKey: assertOrderKey("a0"),
            parent: site.initialSideBarRoot,
        });

        await expect(
            deleteSiteContainer(session2.action(), {
                siteId: site.id,
                container: {type: "SideBarSection", id: sectionId},
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("throws NotFoundError when container doesn\u2019t exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        await expect(
            deleteSiteContainer(session.action(), {
                siteId: site.id,
                container: {
                    type: "SideBarSection",
                    id: generateId<SiteSideBarSectionId>(),
                },
            }),
        ).rejects.toThrow("Site item not found");
    });
});
