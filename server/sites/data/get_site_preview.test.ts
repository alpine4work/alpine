import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    getSitePreview,
    getSitePreviewIfExists,
    getSitePreviewIfPossible,
} from "~/server/sites/data/get_site_preview.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

const context = createTestContext();

async function createTestSite(
    space: Awaited<ReturnType<typeof TestSpace.create>>,
    options: {
        siteId?: SiteId;
        accessPolicy: LocalAccessPolicy;
        name?: string;
    },
) {
    const siteId = options.siteId ?? generateId<SiteId>();
    const now = new Date();

    await SitesTable.createItem(space.systemAction(), {
        partitionType: "Site",
        sortRangeType: "Attributes",
        siteId,
        spaceId: space.id,
        name: options.name ?? "Test Site",
        accessPolicy: options.accessPolicy,
        createdTime: now,
        creatorId: generateId(),
        updatedTime: now,
        firstEntityId: null,
    });

    return siteId;
}

describe("getSitePreview", () => {
    test("returns site preview when actor has view access", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        const siteId = await createTestSite(space, {accessPolicy, name: "My Site"});

        const preview = await getSitePreview(session.action(), siteId);

        expect(preview).toBeInstanceOf(SitePreviewModel);
        expect(preview.id).toBe(siteId);
        expect(preview.initialData.name).toBe("My Site");
        expect(preview.initialData.spaceId).toBe(space.id);
    });

    test("throws NotFoundError when site does not exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const nonExistentSiteId = generateId<SiteId>();

        await expect(getSitePreview(session.action(), nonExistentSiteId)).rejects.toThrow(
            NotFoundError,
        );
    });

    test("throws PermissionDeniedError when actor lacks view access", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        const siteId = await createTestSite(space, {accessPolicy});

        await expect(getSitePreview(session2.action(), siteId)).rejects.toThrow(
            PermissionDeniedError,
        );
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

        const siteId = await createTestSite(space, {accessPolicy});

        const preview = await getSitePreview(session2.action(), siteId);

        expect(preview).toBeInstanceOf(SitePreviewModel);
        expect(preview.id).toBe(siteId);
    });

    test("system actor has full access", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        const siteId = await createTestSite(space, {accessPolicy});

        const preview = await getSitePreview(space.systemAction(), siteId);

        expect(preview).toBeInstanceOf(SitePreviewModel);
        expect(preview.id).toBe(siteId);
    });
});

describe("getSitePreviewIfExists", () => {
    test("returns site preview when site exists and actor has access", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        const siteId = await createTestSite(space, {accessPolicy, name: "Existing Site"});

        const preview = await getSitePreviewIfExists(session.action(), siteId);

        expect(preview).not.toBeNull();
        expect(preview).toBeInstanceOf(SitePreviewModel);
        expect(preview?.id).toBe(siteId);
        expect(preview?.initialData.name).toBe("Existing Site");
    });

    test("returns null when site does not exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const nonExistentSiteId = generateId<SiteId>();

        const preview = await getSitePreviewIfExists(session.action(), nonExistentSiteId);

        expect(preview).toBeNull();
    });

    test("throws PermissionDeniedError when actor lacks access to existing site", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        const siteId = await createTestSite(space, {accessPolicy});

        await expect(getSitePreviewIfExists(session2.action(), siteId)).rejects.toThrow(
            PermissionDeniedError,
        );
    });
});

describe("getSitePreviewIfPossible", () => {
    test("returns ok result with site preview when authorized", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        const siteId = await createTestSite(space, {accessPolicy, name: "Accessible Site"});

        const result = await getSitePreviewIfPossible(session.action(), siteId);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toBeInstanceOf(SitePreviewModel);
            expect(result.value.id).toBe(siteId);
            expect(result.value.initialData.name).toBe("Accessible Site");
        }
    });

    test("returns error result when site does not exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const nonExistentSiteId = generateId<SiteId>();

        const result = await getSitePreviewIfPossible(session.action(), nonExistentSiteId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toBeInstanceOf(NotFoundError);
        }
    });

    test("returns error result when actor lacks access", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        const siteId = await createTestSite(space, {accessPolicy});

        const result = await getSitePreviewIfPossible(session2.action(), siteId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toBeInstanceOf(PermissionDeniedError);
        }
    });

    test("allows anonymous access via url grant", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        };

        const siteId = await createTestSite(space, {accessPolicy, name: "Public Site"});

        const result = await getSitePreviewIfPossible(context.anonymousAction(), siteId);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.initialData.name).toBe("Public Site");
        }
    });
});
