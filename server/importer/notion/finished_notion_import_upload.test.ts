import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createNotionImport} from "~/server/importer/notion/create_notion_import.js";
import {finishedNotionImportUpload} from "~/server/importer/notion/finished_notion_import_upload.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {TestImporterContextModule} from "~/server/importer/test_helpers/test_importer_context_module.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {NotionImportId} from "~/shared/id/types/id_types.js";

const context = createTestContext();

function getTestImporter(): TestImporterContextModule {
    return context.importer as unknown as TestImporterContextModule;
}

async function simulateFileUpload(importKey: string): Promise<void> {
    await getTestImporter().setUploadedFile(importKey, new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
}

test("transitions status from UploadPending to ValidateQueued", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {notionImportId, importKey} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    await simulateFileUpload(importKey);

    await finishedNotionImportUpload(session.action(), {
        spaceId: space.id,
        notionImportId,
    });

    const importItem = await NotionImporterTable.getItem(context, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId,
    });

    expect(importItem).toMatchObject({
        status: {type: "ValidateQueued"},
    });
});

test("triggers validation via importer context module", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {notionImportId, importKey} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    await simulateFileUpload(importKey);

    const importer = getTestImporter();
    const callsBeforeCount = importer.startValidateNotionImportCalls.length;

    await finishedNotionImportUpload(session.action(), {
        spaceId: space.id,
        notionImportId,
    });

    expect(importer.startValidateNotionImportCalls.length - callsBeforeCount).toBe(1);
    expect(importer.startValidateNotionImportCalls.at(-1)).toMatchObject({
        spaceId: space.id,
        notionImportId,
    });
});

test("throws if called when status is not UploadPending", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {notionImportId, importKey} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    await simulateFileUpload(importKey);

    // First call transitions to ValidateQueued
    await finishedNotionImportUpload(session.action(), {
        spaceId: space.id,
        notionImportId,
    });

    // Second call should throw because status is no longer UploadPending
    await expect(
        finishedNotionImportUpload(session.action(), {
            spaceId: space.id,
            notionImportId,
        }),
    ).rejects.toThrow("Status is not in the correct state for processing");
});

test("throws if status is already Validated", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {notionImportId, importKey} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    await simulateFileUpload(importKey);

    // Manually set status to Validated (simulating completed validation)
    await NotionImporterTable.updateItem(
        context,
        {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
        item => ({
            ...assertExists(item),
            status: {type: "Validated" as const},
        }),
    );

    await expect(
        finishedNotionImportUpload(session.action(), {
            spaceId: space.id,
            notionImportId,
        }),
    ).rejects.toThrow("Status is not in the correct state for processing");
});

test("throws if import does not exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const nonexistentId = generateId<NotionImportId>();

    await expect(
        finishedNotionImportUpload(session.action(), {
            spaceId: space.id,
            notionImportId: nonexistentId,
        }),
    ).rejects.toThrow("Item not found");
});

test("throws if import belongs to different space", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const session1 = await space1.createSession({role: "Admin"});
    const session2 = await space2.createSession({role: "Admin"});

    const {notionImportId, importKey} = await createNotionImport(session1.action(), {
        spaceId: space1.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    await simulateFileUpload(importKey);

    await expect(
        finishedNotionImportUpload(session2.action(), {
            spaceId: space2.id,
            notionImportId,
        }),
    ).rejects.toThrow("does not belong to space");
});

test("throws if uploaded file does not exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {notionImportId} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    // Don't simulate file upload - file should not exist

    await expect(
        finishedNotionImportUpload(session.action(), {
            spaceId: space.id,
            notionImportId,
        }),
    ).rejects.toThrow("Uploaded file not found");
});

test("throws when status is ValidateQueued", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

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
            status: {type: "ValidateQueued" as const},
        }),
    );

    await expect(
        finishedNotionImportUpload(session.action(), {
            spaceId: space.id,
            notionImportId,
        }),
    ).rejects.toThrow("Status is not in the correct state for processing");
});

test("throws when status is Validating", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

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
            status: {type: "Validating" as const},
        }),
    );

    await expect(
        finishedNotionImportUpload(session.action(), {
            spaceId: space.id,
            notionImportId,
        }),
    ).rejects.toThrow("Status is not in the correct state for processing");
});

test("throws when status is ProcessQueued", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

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
            status: {type: "ProcessQueued" as const},
        }),
    );

    await expect(
        finishedNotionImportUpload(session.action(), {
            spaceId: space.id,
            notionImportId,
        }),
    ).rejects.toThrow("Status is not in the correct state for processing");
});

test("throws when status is Processing", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

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
            status: {type: "Processing" as const},
        }),
    );

    await expect(
        finishedNotionImportUpload(session.action(), {
            spaceId: space.id,
            notionImportId,
        }),
    ).rejects.toThrow("Status is not in the correct state for processing");
});

test("throws when status is Success", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

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
            status: {type: "Success" as const},
        }),
    );

    await expect(
        finishedNotionImportUpload(session.action(), {
            spaceId: space.id,
            notionImportId,
        }),
    ).rejects.toThrow("Status is not in the correct state for processing");
});

test("throws when status is Failed", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

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
            status: {type: "Failed" as const, error: "Test error"},
        }),
    );

    await expect(
        finishedNotionImportUpload(session.action(), {
            spaceId: space.id,
            notionImportId,
        }),
    ).rejects.toThrow("Status is not in the correct state for processing");
});

test("only checks file when status is UploadPending", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {notionImportId} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: 1024,
    });

    // Status is UploadPending, no file uploaded -> should throw
    await expect(
        finishedNotionImportUpload(session.action(), {
            spaceId: space.id,
            notionImportId,
        }),
    ).rejects.toThrow("Uploaded file not found");

    // Verify status is still UploadPending (wasn't changed)
    const importItem = await NotionImporterTable.getItem(context, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId,
    });

    expect(importItem).toMatchObject({
        status: {type: "UploadPending"},
    });
});
