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

test("createNotionImport returns a presigned upload URL", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {presignedUploadUrl, importKey} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    // Test module returns a test URL containing the import key
    expect(presignedUploadUrl).toContain("import-upload");
    expect(presignedUploadUrl).toContain(importKey);
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
        status: {type: "ProcessQueued"},
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
