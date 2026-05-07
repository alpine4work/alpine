import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createSite} from "~/server/sites/data/create_site.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {updateSiteName} from "~/server/sites/data/update_site_name.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

const context = createTestContext();

describe("updateSiteName", () => {
    test("updates site name in the returned SitePreviewModel", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        await createSite(session.action(), {
            spaceId: space.id,
            siteId,
            name: "Original Name",
            root: {type: "SideBar"},
        });

        const {site} = await updateSiteName(session.action(), {
            siteId,
            name: "Updated Name",
        });

        expect(site).toBeInstanceOf(SitePreviewModel);
        expect(site.initialData.name).toBe("Updated Name");
    });

    test("persists the name change", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        await createSite(session.action(), {
            spaceId: space.id,
            siteId,
            name: "Before",
            root: {type: "SideBar"},
        });

        await updateSiteName(session.action(), {
            siteId,
            name: "After",
        });

        const attrs = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "Attributes",
            siteId,
        });

        expect(attrs.name).toBe("After");
    });

    test("throws PermissionDeniedError when actor lacks Manage access", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        };

        const siteId = generateId<SiteId>();
        await createSite(session1.action(), {
            spaceId: space.id,
            siteId,
            name: "Protected Site",
            accessPolicy,
            root: {type: "SideBar"},
        });

        await expect(
            updateSiteName(session2.action(), {
                siteId,
                name: "Unauthorized Update",
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });
});
