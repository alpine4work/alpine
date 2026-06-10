import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    getSitePreview,
    getSitePreviewIfExists,
    getSitePreviewIfPossible,
} from "~/server/sites/data/get_site_preview.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

const context = createTestContext();

describe("getSitePreview", () => {
    test("returns site preview when actor has view access", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const site = await TestSite.create(session, {access: "Private", name: "My Site"});

        const preview = await getSitePreview(session.action(), site.id);

        expect(preview).toBeInstanceOf(SitePreviewModel);
        expect(preview.id).toBe(site.id);
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

        const site = await TestSite.create(session1, {access: "Private"});

        await expect(getSitePreview(session2.action(), site.id)).rejects.toThrow(
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

        const site = await TestSite.create(session1, {access: accessPolicy});

        const preview = await getSitePreview(session2.action(), site.id);

        expect(preview).toBeInstanceOf(SitePreviewModel);
        expect(preview.id).toBe(site.id);
    });

    test("system actor has full access", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const site = await TestSite.create(session, {access: "Private"});

        const preview = await getSitePreview(space.systemAction(), site.id);

        expect(preview).toBeInstanceOf(SitePreviewModel);
        expect(preview.id).toBe(site.id);
    });
});

describe("getSitePreviewIfExists", () => {
    test("returns site preview when site exists and actor has access", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const site = await TestSite.create(session, {access: "Private", name: "Existing Site"});

        const preview = await getSitePreviewIfExists(session.action(), site.id);

        expect(preview).not.toBeNull();
        expect(preview).toBeInstanceOf(SitePreviewModel);
        expect(preview?.id).toBe(site.id);
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

        const site = await TestSite.create(session1, {access: "Private"});

        await expect(getSitePreviewIfExists(session2.action(), site.id)).rejects.toThrow(
            PermissionDeniedError,
        );
    });
});

describe("getSitePreviewIfPossible", () => {
    test("returns ok result with site preview when authorized", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const site = await TestSite.create(session, {
            access: "Private",
            name: "Accessible Site",
        });

        const result = await getSitePreviewIfPossible(session.action(), site.id);

        expect(result?.ok).toBe(true);
        if (result?.ok) {
            expect(result.value).toBeInstanceOf(SitePreviewModel);
            expect(result.value.id).toBe(site.id);
            expect(result.value.initialData.name).toBe("Accessible Site");
        }
    });

    test("returns null when site does not exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const nonExistentSiteId = generateId<SiteId>();

        const result = await getSitePreviewIfPossible(session.action(), nonExistentSiteId);

        expect(result).toBeNull();
    });

    test("returns error result when actor lacks access", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const site = await TestSite.create(session1, {access: "Private"});

        const result = await getSitePreviewIfPossible(session2.action(), site.id);

        expect(result?.ok).toBe(false);
        if (result && !result.ok) {
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

        const site = await TestSite.create(session, {access: accessPolicy, name: "Public Site"});

        const result = await getSitePreviewIfPossible(context.anonymousAction(), site.id);

        expect(result?.ok).toBe(true);
        if (result?.ok) {
            expect(result.value.initialData.name).toBe("Public Site");
        }
    });
});
