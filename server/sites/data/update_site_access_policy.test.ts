import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createSite} from "~/server/sites/data/create_site.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {updateSiteAccessPolicy} from "~/server/sites/data/update_site_access_policy.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

const context = createTestContext();

describe("updateSiteAccessPolicy", () => {
    test("updates access policy in the returned SitePreviewModel", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        await createSite(session.action(), {
            spaceId: space.id,
            siteId,
            name: "Policy Site",
            root: {type: "SideBar"},
        });

        const newPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Edit"},
            urlGrant: null,
        };

        const {site} = await updateSiteAccessPolicy(session.action(), {
            siteId,
            accessPolicy: newPolicy,
        });

        expect(site).toBeInstanceOf(SitePreviewModel);
        expect(site.initialData.accessPolicy).toEqual(newPolicy);
    });

    test("persists the policy change", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        await createSite(session.action(), {
            spaceId: space.id,
            siteId,
            name: "Persist Policy Site",
            root: {type: "SideBar"},
        });

        const newPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        };

        await updateSiteAccessPolicy(session.action(), {
            siteId,
            accessPolicy: newPolicy,
        });

        const attrs = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "Attributes",
            siteId,
        });

        expect(attrs.accessPolicy).toEqual(newPolicy);
    });

    test("throws PermissionDeniedError when actor lacks Manage access", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const originalPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        };

        const siteId = generateId<SiteId>();
        await createSite(session1.action(), {
            spaceId: space.id,
            siteId,
            name: "Restricted Policy Site",
            accessPolicy: originalPolicy,
            root: {type: "SideBar"},
        });

        const newPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session2.account.id, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        };

        await expect(
            updateSiteAccessPolicy(session2.action(), {
                siteId,
                accessPolicy: newPolicy,
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("actor who was manager under old policy but not new policy can still make the update", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const originalPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session2.account.id, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const siteId = generateId<SiteId>();
        await createSite(session1.action(), {
            spaceId: space.id,
            siteId,
            name: "Transfer Site",
            accessPolicy: originalPolicy,
            root: {type: "SideBar"},
        });

        // session2 removes itself from the new policy, transferring sole ownership to
        // session1. This should succeed because session2 had Manage on the old policy at
        // the time of the call.
        const newPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        const {site} = await updateSiteAccessPolicy(session2.action(), {
            siteId,
            accessPolicy: newPolicy,
        });

        expect(site.initialData.accessPolicy).toEqual(newPolicy);
    });

    test("adding a new account grant is reflected in the persisted policy", async () => {
        const space = await TestSpace.create(context);
        const [session, otherSession] = await space.createSessions(2);

        const siteId = generateId<SiteId>();
        await createSite(session.action(), {
            spaceId: space.id,
            siteId,
            name: "Grant Site",
            root: {type: "SideBar"},
        });

        const newAccountId = otherSession.account.id;
        const newPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [session.account.id, {level: "Manage", generation: 0}],
                [newAccountId, {level: "Edit"}],
            ]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        };

        await updateSiteAccessPolicy(session.action(), {
            siteId,
            accessPolicy: newPolicy,
        });

        const attrs = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "Attributes",
            siteId,
        });

        expect(attrs.accessPolicy.accountGrantById.get(newAccountId)).toEqual({
            level: "Edit",
        });
    });
});
