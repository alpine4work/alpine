import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createSite} from "~/server/sites/data/create_site.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {SiteId, SiteSideBarId, SiteTopBarId} from "~/shared/id/types/id_types.js";
import {SitePreviewModel, SiteSideBarModel} from "~/shared/sites/site_model.js";

const context = createTestContext();

describe("createSite", () => {
    test("creates a site with a SideBar root", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        await createSite(session.action(), {
            spaceId: space.id,
            siteId,
            name: "SideBar Site",
            root: {type: "SideBar"},
        });

        const attrs = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "Attributes",
            siteId,
        });

        expect(attrs).toMatchObject({
            siteId,
            spaceId: space.id,
            name: "SideBar Site",
        });
        expect(attrs.rootContainerId).toMatch(/^SideBar:/);
    });

    test("creates a site with a TopBar root", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        await createSite(session.action(), {
            spaceId: space.id,
            siteId,
            name: "TopBar Site",
            root: {type: "TopBar"},
        });

        const attrs = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "Attributes",
            siteId,
        });

        expect(attrs).toMatchObject({
            siteId,
            spaceId: space.id,
            name: "TopBar Site",
        });
        expect(attrs.rootContainerId).toMatch(/^TopBar:/);
    });

    test("root container label equals the site name", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        const sideBarId = generateId<SiteSideBarId>();
        await createSite(session.action(), {
            spaceId: space.id,
            siteId,
            name: "My Cool Site",
            root: {type: "SideBar", id: sideBarId},
        });

        const root = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "SideBar",
            siteId,
            id: sideBarId,
        });

        expect(root.label).toBe("My Cool Site");
    });

    test("newly created sites are private to the creator by default", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        await createSite(session.action(), {
            spaceId: space.id,
            siteId,
            name: "Default Policy Site",
            root: {type: "SideBar"},
        });

        const attrs = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "Attributes",
            siteId,
        });

        expect(attrs.accessPolicy).toEqual({
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("custom access policy is persisted", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const customPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Edit"},
            urlGrant: {level: "View"},
        };

        const siteId = generateId<SiteId>();
        await createSite(session.action(), {
            spaceId: space.id,
            siteId,
            name: "Custom Policy Site",
            accessPolicy: customPolicy,
            root: {type: "SideBar"},
        });

        const attrs = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "Attributes",
            siteId,
        });

        expect(attrs.accessPolicy).toEqual(customPolicy);
    });

    test("returned events include SitePreviewModel and SiteSideBarModel events", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        const result = await createSite(session.action(), {
            spaceId: space.id,
            siteId,
            name: "Events Site",
            root: {type: "SideBar"},
        });

        const [sitePreviewEvent, siteEntryEvent] = await result.getRynamoEvents(session.action());

        expect(sitePreviewEvent.type).toBe("PutItem");
        if (sitePreviewEvent.type === "PutItem") {
            expect(sitePreviewEvent.item.model).toBeInstanceOf(SitePreviewModel);
        }

        expect(siteEntryEvent.type).toBe("PutItem");
        if (siteEntryEvent.type === "PutItem") {
            expect(siteEntryEvent.item.model).toBeInstanceOf(SiteSideBarModel);
        }
    });

    test("optional siteId is respected when provided", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const customSiteId = generateId<SiteId>();
        await createSite(session.action(), {
            spaceId: space.id,
            siteId: customSiteId,
            name: "Custom ID Site",
            root: {type: "SideBar"},
        });

        const attrs = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "Attributes",
            siteId: customSiteId,
        });

        expect(attrs.siteId).toBe(customSiteId);
    });

    test("optional root id is respected when provided", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        const topBarId = generateId<SiteTopBarId>();
        await createSite(session.action(), {
            spaceId: space.id,
            siteId,
            name: "Custom Root ID Site",
            root: {type: "TopBar", id: topBarId},
        });

        const root = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "TopBar",
            siteId,
            id: topBarId,
        });

        expect(root).toMatchObject({
            id: topBarId,
            type: "TopBar",
            label: "Custom Root ID Site",
            orderKey: initialOrderKey,
            parentId: null,
        });
    });
});
