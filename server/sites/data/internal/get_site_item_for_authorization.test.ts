import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    getSiteItemForAuthorization,
    getSiteItemForAuthorizationIfExists,
} from "~/server/sites/data/internal/get_site_item_for_authorization.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {NotFoundError} from "~/shared/error/error.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {SiteId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext();

describe("getSiteItemForAuthorization", () => {
    test("returns site item when site exists", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        const site = await TestSite.create(session, {access: accessPolicy, name: "Test Site"});

        const item = await getSiteItemForAuthorization(session.action(), site.id);

        expect(item.siteId).toBe(site.id);
        expect(item.spaceId).toBe(space.id);
        expect(item.name).toBe("Test Site");
        expect(item.accessPolicy).toEqual(accessPolicy);
    });

    test("throws NotFoundError when site does not exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const nonExistentSiteId = generateId<SiteId>();

        await expect(
            getSiteItemForAuthorization(session.action(), nonExistentSiteId),
        ).rejects.toThrow(NotFoundError);
    });

    test("returns item regardless of actor access level", async () => {
        // getSiteItemForAuthorization does not check access, it just returns the item
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const site = await TestSite.create(session1, {access: "Private"});

        // session2 has no access, but can still get the item for authorization purposes
        const item = await getSiteItemForAuthorization(session2.action(), site.id);

        expect(item.siteId).toBe(site.id);
    });

    test("works with system actor", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const site = await TestSite.create(session, {access: "Private"});

        const item = await getSiteItemForAuthorization(space.systemAction(), site.id);

        expect(item.siteId).toBe(site.id);
    });
});

describe("getSiteItemForAuthorizationIfExists", () => {
    test("returns site item when site exists", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Edit"},
            urlGrant: {level: "View"},
        };

        const site = await TestSite.create(session, {
            access: accessPolicy,
            name: "Existing Site",
        });

        const item = await getSiteItemForAuthorizationIfExists(session.action(), site.id);

        expect(item).not.toBeNull();
        expect(item?.siteId).toBe(site.id);
        expect(item?.spaceId).toBe(space.id);
        expect(item?.name).toBe("Existing Site");
        expect(item?.accessPolicy).toEqual(accessPolicy);
    });

    test("returns null when site does not exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const nonExistentSiteId = generateId<SiteId>();

        const item = await getSiteItemForAuthorizationIfExists(session.action(), nonExistentSiteId);

        expect(item).toBeNull();
    });

    test("returns item regardless of actor access level", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const site = await TestSite.create(session1, {access: "Private"});

        // session2 has no access, but can still get the item for authorization purposes
        const item = await getSiteItemForAuthorizationIfExists(session2.action(), site.id);

        expect(item).not.toBeNull();
        expect(item?.siteId).toBe(site.id);
    });

    test("works with anonymous actor", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const site = await TestSite.create(session, {access: "Private"});

        const item = await getSiteItemForAuthorizationIfExists(context.anonymousAction(), site.id);

        expect(item).not.toBeNull();
        expect(item?.siteId).toBe(site.id);
    });

    test("returns consistent results with eventual consistency", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const site = await TestSite.create(session, {access: "Private"});

        const item = await getSiteItemForAuthorizationIfExists(session.action(), site.id, {
            consistency: "Eventual",
        });

        expect(item?.siteId).toBe(site.id);
    });
});

describe("SiteItemAuthorizationCache", () => {
    test("returns same cached item on subsequent calls with eventual consistency", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const requestContext = session.action();

        const site = await TestSite.create(session, {access: "Private"});

        // First call loads from database
        const item1 = await getSiteItemForAuthorizationIfExists(requestContext, site.id, {
            consistency: "Eventual",
        });

        // Second call should return cached item (same object reference)
        const item2 = await getSiteItemForAuthorizationIfExists(requestContext, site.id, {
            consistency: "Eventual",
        });

        expect(item1).not.toBeNull();
        expect(item1).toBe(item2); // Same object reference means it came from cache
    });

    test("strong consistency bypasses cache", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const requestContext = session.action();

        const site = await TestSite.create(session, {access: "Private"});

        // First call with eventual consistency
        const item1 = await getSiteItemForAuthorizationIfExists(requestContext, site.id, {
            consistency: "Eventual",
        });

        // Second call with strong consistency should reload from database
        const item2 = await getSiteItemForAuthorizationIfExists(requestContext, site.id, {
            consistency: "Strong",
        });

        expect(item1).not.toBeNull();
        expect(item2).not.toBeNull();
        // Different object references because strong consistency reloads
        expect(item1).not.toBe(item2);
        // But data should be the same
        expect(item1?.siteId).toBe(item2?.siteId);
    });

    test("strong consistency result is cached for subsequent eventual reads", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const requestContext = session.action();

        const site = await TestSite.create(session, {access: "Private"});

        // First call with strong consistency
        const item1 = await getSiteItemForAuthorizationIfExists(requestContext, site.id, {
            consistency: "Strong",
        });

        // Second call with eventual consistency should return the cached strong result
        const item2 = await getSiteItemForAuthorizationIfExists(requestContext, site.id, {
            consistency: "Eventual",
        });

        expect(item1).not.toBeNull();
        expect(item1).toBe(item2); // Same object because strong result was cached
    });

    test("StrongWithinCache returns cached strong result", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const requestContext = session.action();

        const site = await TestSite.create(session, {access: "Private"});

        // First call with strong consistency
        const item1 = await getSiteItemForAuthorizationIfExists(requestContext, site.id, {
            consistency: "Strong",
        });

        // Second call with StrongWithinCache should return cached strong result
        const item2 = await getSiteItemForAuthorizationIfExists(requestContext, site.id, {
            consistency: "StrongWithinCache",
        });

        expect(item1).not.toBeNull();
        expect(item1).toBe(item2); // Same object because it was loaded with Strong
    });

    test("StrongWithinCache reloads if cached with eventual consistency", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const requestContext = session.action();

        const site = await TestSite.create(session, {access: "Private"});

        // First call with eventual consistency
        const item1 = await getSiteItemForAuthorizationIfExists(requestContext, site.id, {
            consistency: "Eventual",
        });

        // Second call with StrongWithinCache should reload because previous was Eventual
        const item2 = await getSiteItemForAuthorizationIfExists(requestContext, site.id, {
            consistency: "StrongWithinCache",
        });

        expect(item1).not.toBeNull();
        expect(item2).not.toBeNull();
        // Different object references because StrongWithinCache had to reload
        expect(item1).not.toBe(item2);
    });

    test("cache returns null for non-existent site", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const requestContext = session.action();

        const nonExistentSiteId = generateId<SiteId>();

        // First call returns null
        const item1 = await getSiteItemForAuthorizationIfExists(requestContext, nonExistentSiteId, {
            consistency: "Eventual",
        });

        // Second call should also return null from cache
        const item2 = await getSiteItemForAuthorizationIfExists(requestContext, nonExistentSiteId, {
            consistency: "Eventual",
        });

        expect(item1).toBeNull();
        expect(item2).toBeNull();
    });
});
