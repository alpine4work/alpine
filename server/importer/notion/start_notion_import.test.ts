import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createNotionImport} from "~/server/importer/notion/create_notion_import.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {startNotionImport} from "~/server/importer/notion/start_notion_import.js";
import {TestImporterContextModule} from "~/server/importer/test_helpers/test_importer_context_module.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const context = createTestContext();

function getTestImporter(): TestImporterContextModule {
    return context.importer as unknown as TestImporterContextModule;
}

test("createNotionImport creates an import record with UploadPending status", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {notionImportId, importKey} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    const importItem = await NotionImporterTable.getItem(context, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId,
    });

    expect(importItem).toMatchObject({
        spaceId: space.id,
        notionImportId,
        importKey,
        status: {type: "UploadPending"},
        importedCount: 0,
    });
    expect(importItem.createdTime).toBeInstanceOf(Date);
    expect(importItem.importKey).toBe(`${space.id}/notion/${notionImportId}`);
});

test("createNotionImport returns multipart upload details", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {uploadId, partUploadUrls, importKey} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    // Test module returns a test upload ID and part URLs containing the import key
    expect(uploadId).toMatch(/^test-multipart-/);
    expect(partUploadUrls.length).toBeGreaterThan(0);
    expect(partUploadUrls[0]!.presignedUrl).toContain("import-upload");
    expect(partUploadUrls[0]!.presignedUrl).toContain(importKey);
});

test("startNotionImport transitions from Validated to ProcessQueued", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {notionImportId} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    // Manually set status to Validated (simulating successful validation job)
    await NotionImporterTable.updateItem(
        context,
        {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
        item => ({
            ...assertExists(item),
            status: {type: "Validated" as const, result: {teamspaces: new Map()}},
            workspaceName: "Test Workspace",
            teamspaceImportOptions: [],
        }),
    );

    await startNotionImport(session.action(), {
        spaceId: space.id,
        notionImportId,
        teamspaceImportOptions: [],
    });

    const importItem = await NotionImporterTable.getItem(context, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId,
    });

    expect(importItem).toMatchObject({
        status: {type: "ProcessQueued", result: {teamspaces: new Map()}},
    });
});

test("startNotionImport triggers import via importer context module", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {notionImportId} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    // Manually set status to Validated
    await NotionImporterTable.updateItem(
        context,
        {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
        item => ({
            ...assertExists(item),
            status: {type: "Validated" as const, result: {teamspaces: new Map()}},
            workspaceName: "Test Workspace",
            teamspaceImportOptions: [],
        }),
    );

    const importer = getTestImporter();
    const callsBeforeCount = importer.startNotionImportCalls.length;

    await startNotionImport(session.action(), {
        spaceId: space.id,
        notionImportId,
        teamspaceImportOptions: [],
    });

    expect(importer.startNotionImportCalls.length - callsBeforeCount).toBe(1);
    expect(importer.startNotionImportCalls.at(-1)).toMatchObject({
        spaceId: space.id,
        notionImportId,
    });
});

test("startNotionImport succeeds when another import is already processing", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    // Create first import and set it to Processing
    const {notionImportId: firstImportId} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });
    await NotionImporterTable.updateItem(
        context,
        {partitionType: "Import", sortRangeType: "Attributes", notionImportId: firstImportId},
        item => ({
            ...assertExists(item),
            status: {type: "Processing" as const, result: {teamspaces: new Map()}},
            workspaceName: "First Workspace",
            teamspaceImportOptions: [],
        }),
    );

    // Create second import and set it to Validated
    const {notionImportId: secondImportId} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });
    await NotionImporterTable.updateItem(
        context,
        {partitionType: "Import", sortRangeType: "Attributes", notionImportId: secondImportId},
        item => ({
            ...assertExists(item),
            status: {type: "Validated" as const, result: {teamspaces: new Map()}},
            workspaceName: "Second Workspace",
            teamspaceImportOptions: [],
        }),
    );

    await startNotionImport(session.action(), {
        spaceId: space.id,
        notionImportId: secondImportId,
        teamspaceImportOptions: [],
    });

    const importItem = await NotionImporterTable.getItem(context, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId: secondImportId,
    });

    expect(importItem).toMatchObject({
        status: {type: "ProcessQueued"},
    });
});

test("startNotionImport succeeds when existing imports are completed or failed", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    // Create a completed import
    const {notionImportId: completedImportId} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });
    await NotionImporterTable.updateItem(
        context,
        {
            partitionType: "Import",
            sortRangeType: "Attributes",
            notionImportId: completedImportId,
        },
        item => ({
            ...assertExists(item),
            status: {type: "Success" as const, result: {teamspaces: new Map()}},
            workspaceName: "Completed Workspace",
            teamspaceImportOptions: [],
        }),
    );

    // Create a failed import
    const {notionImportId: failedImportId} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });
    await NotionImporterTable.updateItem(
        context,
        {partitionType: "Import", sortRangeType: "Attributes", notionImportId: failedImportId},
        item => ({
            ...assertExists(item),
            status: {type: "Failed" as const, result: {teamspaces: new Map()}},
            workspaceName: "Failed Workspace",
            teamspaceImportOptions: [],
        }),
    );

    // Create new import and set it to Validated
    const {notionImportId: newImportId} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });
    await NotionImporterTable.updateItem(
        context,
        {partitionType: "Import", sortRangeType: "Attributes", notionImportId: newImportId},
        item => ({
            ...assertExists(item),
            status: {type: "Validated" as const, result: {teamspaces: new Map()}},
            workspaceName: "New Workspace",
            teamspaceImportOptions: [],
        }),
    );

    await startNotionImport(session.action(), {
        spaceId: space.id,
        notionImportId: newImportId,
        teamspaceImportOptions: [],
    });

    const importItem = await NotionImporterTable.getItem(context, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId: newImportId,
    });

    expect(importItem).toMatchObject({
        status: {type: "ProcessQueued"},
    });
});

test("startNotionImport throws if status is not Validated", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {notionImportId} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    // Try to start without validation - should fail
    await expect(
        startNotionImport(session.action(), {
            spaceId: space.id,
            notionImportId,
            teamspaceImportOptions: [],
        }),
    ).rejects.toThrow("Cannot start import");
});

test("createNotionImport throws if user already has a pre-processing import", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    // Create first import (stays in UploadPending)
    await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    // Trying to create a second import should fail
    await expect(
        createNotionImport(session.action(), {
            spaceId: space.id,
            contentType: "application/zip",
            contentLength: 1024,
        }),
    ).rejects.toThrow("already have an import");
});

test("createNotionImport succeeds if user\u2019s existing imports are all processing or done", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    // Create an import and move it to Processing
    const {notionImportId} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });
    await NotionImporterTable.updateItem(
        context,
        {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
        item => ({
            ...assertExists(item),
            status: {type: "Processing" as const, result: {teamspaces: new Map()}},
            workspaceName: "Test Workspace",
            teamspaceImportOptions: [],
        }),
    );

    // Creating another import should succeed
    const {notionImportId: secondImportId} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    const importItem = await NotionImporterTable.getItem(context, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId: secondImportId,
    });

    expect(importItem).toMatchObject({
        status: {type: "UploadPending"},
    });
});

test("createNotionImport succeeds if another user has a pre-processing import", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession({role: "Admin"});

    // First user creates an import (stays in UploadPending)
    await createNotionImport(session1.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    // Second user should be able to create their own import
    const {notionImportId} = await createNotionImport(session2.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    const importItem = await NotionImporterTable.getItem(context, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId,
    });

    expect(importItem).toMatchObject({
        status: {type: "UploadPending"},
    });
});
