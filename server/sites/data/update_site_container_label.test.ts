import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {updateSiteContainerLabel} from "~/server/sites/data/update_site_container_label.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {SiteSideBarSectionId} from "~/shared/id/types/id_types.js";
import {printSiteContainerId} from "~/shared/sites/site_entry_id.js";

const context = createTestContext();

describe("updateSiteContainerLabel", () => {
    test("updates label on a SideBarSection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const sectionId = await site.addSection(session, {
            label: "Original Label",
            orderKey: assertOrderKey("a0"),
            parent: site.initialSideBarRoot,
        });

        await updateSiteContainerLabel(session.action(), {
            siteId: site.id,
            id: printSiteContainerId({type: "SideBarSection", id: sectionId}),
            label: "Updated Label",
        });

        const item = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "SideBarSection",
            siteId: site.id,
            id: sectionId,
        });

        expect(item.label).toBe("Updated Label");
    });

    test("updates label on the root SideBar", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        await updateSiteContainerLabel(session.action(), {
            siteId: site.id,
            id: site.initialRootContainerId,
            label: "New Root Label",
        });

        const item = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "SideBar",
            siteId: site.id,
            id: site.initialSideBarRoot.id,
        });

        expect(item.label).toBe("New Root Label");
    });

    test("throws PermissionDeniedError when actor lacks Manage access", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);
        const site = await TestSite.create(session1);

        await expect(
            updateSiteContainerLabel(session2.action(), {
                siteId: site.id,
                id: site.initialRootContainerId,
                label: "Unauthorized Update",
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("throws NotFoundError when container doesn\u2019t exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        await expect(
            updateSiteContainerLabel(session.action(), {
                siteId: site.id,
                id: printSiteContainerId({
                    type: "SideBarSection",
                    id: generateId<SiteSideBarSectionId>(),
                }),
                label: "Ghost Label",
            }),
        ).rejects.toThrow("Site item not found");
    });
});
