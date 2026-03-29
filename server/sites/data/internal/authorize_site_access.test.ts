import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    authorizeSiteAccess,
    authorizeSiteAccessIfPossible,
} from "~/server/sites/data/internal/authorize_site_access.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {SiteId} from "~/shared/id/types/id_types.js";

const context = createTestContext();

describe("authorizeSiteAccess", () => {
    test("allows access when actor has required access level", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        await expect(
            authorizeSiteAccess(
                session.action(),
                {id: siteId, spaceId: space.id, accessPolicy},
                "Manage",
            ),
        ).resolves.not.toThrow();
    });

    test("allows access when actor has higher access level than required", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        await expect(
            authorizeSiteAccess(
                session.action(),
                {id: siteId, spaceId: space.id, accessPolicy},
                "View",
            ),
        ).resolves.not.toThrow();
    });

    test("throws PermissionDeniedError when actor lacks required access level", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const siteId = generateId<SiteId>();
        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        await expect(
            authorizeSiteAccess(
                session2.action(),
                {id: siteId, spaceId: space.id, accessPolicy},
                "View",
            ),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("allows access via default grant", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const siteId = generateId<SiteId>();
        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        };

        await expect(
            authorizeSiteAccess(
                session2.action(),
                {id: siteId, spaceId: space.id, accessPolicy},
                "View",
            ),
        ).resolves.not.toThrow();
    });

    test("denies access when default grant is insufficient", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const siteId = generateId<SiteId>();
        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        };

        await expect(
            authorizeSiteAccess(
                session2.action(),
                {id: siteId, spaceId: space.id, accessPolicy},
                "Edit",
            ),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("works with siteId property instead of id", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        await expect(
            authorizeSiteAccess(
                session.action(),
                {siteId, spaceId: space.id, accessPolicy},
                "Manage",
            ),
        ).resolves.not.toThrow();
    });

    test("system actor has full access", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        await expect(
            authorizeSiteAccess(
                space.systemAction(),
                {id: siteId, spaceId: space.id, accessPolicy},
                "Manage",
            ),
        ).resolves.not.toThrow();
    });
});

describe("authorizeSiteAccessIfPossible", () => {
    test("returns ok result when access is authorized", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        const result = await authorizeSiteAccessIfPossible(
            session.action(),
            {id: siteId, spaceId: space.id, accessPolicy},
            "Manage",
        );

        expect(result).toEqual({ok: true, value: undefined});
    });

    test("returns error result when access is denied", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const siteId = generateId<SiteId>();
        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        const result = await authorizeSiteAccessIfPossible(
            session2.action(),
            {id: siteId, spaceId: space.id, accessPolicy},
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

        const siteId = generateId<SiteId>();
        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        };

        const result = await authorizeSiteAccessIfPossible(
            context.anonymousAction(),
            {id: siteId, spaceId: space.id, accessPolicy},
            "View",
        );

        expect(result).toEqual({ok: true, value: undefined});
    });

    test("returns error for anonymous user without url grant", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        };

        const result = await authorizeSiteAccessIfPossible(
            context.anonymousAction(),
            {id: siteId, spaceId: space.id, accessPolicy},
            "View",
        );

        expect(result.ok).toBe(false);
    });
});
