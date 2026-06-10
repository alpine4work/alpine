import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    authorizeSiteAccessAndReturnItem,
    authorizeSiteAccessAndReturnItemIfPossible,
} from "~/server/sites/data/internal/authorize_site_access_and_return_item.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {SiteId} from "~/shared/id/types/id_types.js";

const context = createTestContext();

describe("authorizeSiteAccessAndReturnItem", () => {
    test("returns site item when actor has required access level", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };
        const site = await TestSite.create(session, {access: accessPolicy});

        const item = await authorizeSiteAccessAndReturnItem(session.action(), site.id, "Manage");

        expect(item.siteId).toBe(site.id);
        expect(item.accessPolicy).toEqual(accessPolicy);
    });

    test("returns site item when actor has higher access level than required", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const site = await TestSite.create(session, {access: "Private"});

        const item = await authorizeSiteAccessAndReturnItem(session.action(), site.id, "View");

        expect(item.siteId).toBe(site.id);
    });

    test("throws PermissionDeniedError when actor lacks required access level", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const site = await TestSite.create(session1, {access: "Private"});

        await expect(
            authorizeSiteAccessAndReturnItem(session2.action(), site.id, "View"),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("allows access via default grant", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        };
        const site = await TestSite.create(session1, {access: accessPolicy});

        const item = await authorizeSiteAccessAndReturnItem(session2.action(), site.id, "View");

        expect(item.siteId).toBe(site.id);
    });

    test("denies access when default grant is insufficient", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        };
        const site = await TestSite.create(session1, {access: accessPolicy});

        await expect(
            authorizeSiteAccessAndReturnItem(session2.action(), site.id, "Edit"),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("system actor has full access", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const site = await TestSite.create(session, {access: "Private"});

        const item = await authorizeSiteAccessAndReturnItem(
            space.systemAction(),
            site.id,
            "Manage",
        );

        expect(item.siteId).toBe(site.id);
    });
});

describe("authorizeSiteAccessAndReturnItemIfPossible", () => {
    test("returns ok result when access is authorized", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const site = await TestSite.create(session, {access: "Private"});

        const result = await authorizeSiteAccessAndReturnItemIfPossible(
            session.action(),
            site.id,
            "Manage",
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.siteId).toBe(site.id);
        }
    });

    test("returns error result when access is denied", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const site = await TestSite.create(session1, {access: "Private"});

        const result = await authorizeSiteAccessAndReturnItemIfPossible(
            session2.action(),
            site.id,
            "View",
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toBeInstanceOf(PermissionDeniedError);
        }
    });

    test("returns ok for anonymous user with url grant", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        };
        const site = await TestSite.create(session, {access: accessPolicy});

        const result = await authorizeSiteAccessAndReturnItemIfPossible(
            context.anonymousAction(),
            site.id,
            "View",
        );

        expect(result.ok).toBe(true);
    });

    test("returns error for anonymous user without url grant", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const site = await TestSite.create(session, {access: "Public"});

        const result = await authorizeSiteAccessAndReturnItemIfPossible(
            context.anonymousAction(),
            site.id,
            "View",
        );

        expect(result.ok).toBe(false);
    });

    test("returns site-not-found error result when site does not exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const result = await authorizeSiteAccessAndReturnItemIfPossible(
            session.action(),
            generateId<SiteId>(),
            "View",
        );

        expect(result.ok).toBe(false);
    });
});
