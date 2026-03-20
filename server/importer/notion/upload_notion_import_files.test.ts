import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import getPort from "get-port";
import {join as joinPath} from "path";
import {Readable} from "stream";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {MiniflareR2Client} from "~/server/cloudflare/r2/miniflare_r2_client.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getFileIfExistsAsSystem} from "~/server/files/data/files_actions.js";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {
    filesBindingName,
    filesBucketName,
} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {generateDeterministicNotionFileIdSync} from "~/server/importer/notion/internal/generate_deterministic_notion_id.js";
import {NotionImporterProgressState} from "~/server/importer/notion/internal/notion_importer_progress_state.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {NotionImportMappedReferencesResult} from "~/server/importer/notion/internal/parse_notion_import_and_map_references.js";
import {uploadNotionImportFiles} from "~/server/importer/notion/internal/upload_notion_import_files.js";
import {TestImporterContextModule} from "~/server/importer/test_helpers/test_importer_context_module.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {waitForReadableStreamUint8Array} from "~/shared/helpers/binary/wait_for_readable_stream_uint8_array.js";
import {generateId} from "~/shared/id/id.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const context = createTestContext();

let r2Client: MiniflareR2Client;

beforeAll(async () => {
    const port = await getPort();
    const r2Storage = new FileStorage(
        joinPath(context.getTemporaryDirectoryPath(), "r2", filesBindingName),
    );
    const r2Bucket = new R2Bucket(r2Storage);

    r2Client = new MiniflareR2Client({
        fileProcessorServiceUrl: `http://localhost:${port}`,
        bucketByName: new Map([[filesBucketName, r2Bucket]]),
    });
});

/**
 * Read the bytes of an R2 object. Uses `Readable.toWeb` to avoid the locked-stream
 * issue with `transformToByteArray` on miniflare responses.
 */
async function getR2ObjectBytes(bucket: string, key: string): Promise<Uint8Array> {
    const object = await r2Client.GetObject(testTracer, {Bucket: bucket, Key: key});
    return waitForReadableStreamUint8Array(
        Readable.toWeb(object.Body as Readable) as ReadableStream<Uint8Array>,
    );
}

/**
 * Create a system action context with a fresh importer module and
 * MiniflareR2Client.
 */
function createSystemActionContext(
    space: Awaited<ReturnType<typeof TestSpace.create>>,
    importer: TestImporterContextModule,
) {
    return context.cloneWithHelpers({
        tracer: new TracerContextModule(context.tracer.getTracer()),
        cache: CacheContextModule.new(),
        batch: BatchContextModule.new(),
        actor: SystemActorContextModule.dangerouslyNew("ImporterService", space.id),
        importer,
        r2: new CloudflareR2ContextModule(r2Client),
        constants: context.constants.fork(),
    });
}

/**
 * Creates a notion import item in "Processing" state and returns a state manager
 * wired up for persistence.
 */
async function createProgressStateForTest({
    systemContext,
    spaceId,
    accountId,
    mappedReferencesResult,
}: {
    systemContext: ReturnType<typeof createSystemActionContext>;
    spaceId: SpaceId;
    accountId: string;
    mappedReferencesResult: NotionImportMappedReferencesResult;
}): Promise<NotionImporterProgressState> {
    const notionImportId = generateId<NotionImportId>();
    const initialResult = {
        teamspaces: new Map(
            [...new Set(mappedReferencesResult.filePathToTeamspaceId.values())].map(id => [
                id,
                {documents: {imported: 0, expectedCount: 0}, files: new Map()},
            ]),
        ),
    };

    await NotionImporterTable.createItem(systemContext, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId,
        spaceId,
        startedByAccountId: accountId as any,
        workspaceName: "Test Workspace",
        importKey: "test-import-key",
        importZipSize: 1024,
        createdTime: new Date(),
        updatedTime: new Date(),
        startedProcessingTime: new Date(),
        teamspaceImportOptions: null,
        status: {type: "Processing", result: initialResult},
        importedCount: 0,
    });

    return new NotionImporterProgressState({
        notionImportId,
        context: systemContext,
        initialResult,
    });
}

describe("uploadNotionImportFiles", () => {
    test("uploads files to R2 and creates file records", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const importerModule = new TestImporterContextModule();
        const testDiskPath = "test-upload-files";

        // Create test file content.
        const imageContent = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header
        const pdfContent = new Uint8Array([37, 80, 68, 70]); // %PDF

        // Set up unzipped files.
        await importerModule.setUnzippedFiles(testDiskPath, {
            "attachments/image.png": imageContent,
            "attachments/doc.pdf": pdfContent,
        });

        const diskPathToUnzippedFiles = importerModule.getUnzippedFilesPath(testDiskPath);

        // Generate deterministic file IDs.
        const workspaceId = "test-workspace";
        const importTime = Date.now();
        const imageFileId = generateDeterministicNotionFileIdSync(
            space.id,
            workspaceId,
            "file:attachments/image.png",
            importTime,
        );
        const pdfFileId = generateDeterministicNotionFileIdSync(
            space.id,
            workspaceId,
            "file:attachments/doc.pdf",
            importTime,
        );

        const mappedReferencesResult: NotionImportMappedReferencesResult = {
            notionWorkspaceId: workspaceId,
            teamspaces: [],
            filesToUpload: {
                "attachments/image.png": {id: imageFileId},
                "attachments/doc.pdf": {id: pdfFileId},
            },
            diskPathToUnzippedFiles,
            inlineDatabaseChildren: new Map(),
            rootLevelCsvDatabases: new Map(),
            csvDatabasesRequiringDocuments: new Map(),
            pathToDocumentId: new Map(),
            documentIdToPath: new Map(),
            filePathToTeamspaceId: new Map([
                ["attachments/image.png", "test-teamspace"],
                ["attachments/doc.pdf", "test-teamspace"],
            ]),
        };

        const systemContext = createSystemActionContext(space, importerModule);
        const progressState = await createProgressStateForTest({
            systemContext,
            spaceId: space.id,
            accountId: session.account.id,
            mappedReferencesResult,
        });

        await uploadNotionImportFiles(
            systemContext,
            space.id,
            session.account.id,
            mappedReferencesResult,
            progressState,
        );

        // Verify files were uploaded to R2.
        const imageBytes = await getR2ObjectBytes(filesBucketName, `${space.id}/${imageFileId}`);
        expect(imageBytes).toEqual(imageContent);

        const pdfBytes = await getR2ObjectBytes(filesBucketName, `${space.id}/${pdfFileId}`);
        expect(pdfBytes).toEqual(pdfContent);

        // Verify file records were created in DynamoDB.
        const imageFile = await getFileIfExistsAsSystem(systemContext, imageFileId);
        expect(imageFile).not.toBeNull();
        expect(imageFile?.contentType).toBe("image/png");

        const pdfFile = await getFileIfExistsAsSystem(systemContext, pdfFileId);
        expect(pdfFile).not.toBeNull();
        expect(pdfFile?.contentType).toBe("application/pdf");
    });

    test("skips files that already exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const importerModule = new TestImporterContextModule();
        const testDiskPath = "test-skip-existing";

        // Create test file content.
        const imageContent = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

        // Set up unzipped files.
        await importerModule.setUnzippedFiles(testDiskPath, {
            "attachments/image.png": imageContent,
        });

        const diskPathToUnzippedFiles = importerModule.getUnzippedFilesPath(testDiskPath);

        const workspaceId = "test-workspace";
        const importTime = Date.now();
        const imageFileId = generateDeterministicNotionFileIdSync(
            space.id,
            workspaceId,
            "file:attachments/image.png",
            importTime,
        );

        const mappedReferencesResult: NotionImportMappedReferencesResult = {
            notionWorkspaceId: workspaceId,
            teamspaces: [],
            filesToUpload: {
                "attachments/image.png": {id: imageFileId},
            },
            diskPathToUnzippedFiles,
            inlineDatabaseChildren: new Map(),
            rootLevelCsvDatabases: new Map(),
            csvDatabasesRequiringDocuments: new Map(),
            pathToDocumentId: new Map(),
            documentIdToPath: new Map(),
            filePathToTeamspaceId: new Map([["attachments/image.png", "test-teamspace"]]),
        };

        const systemContext = createSystemActionContext(space, importerModule);
        const progressState = await createProgressStateForTest({
            systemContext,
            spaceId: space.id,
            accountId: session.account.id,
            mappedReferencesResult,
        });

        // Upload once.
        await uploadNotionImportFiles(
            systemContext,
            space.id,
            session.account.id,
            mappedReferencesResult,
            progressState,
        );

        // Upload again - should not throw and should skip the existing file.
        await uploadNotionImportFiles(
            systemContext,
            space.id,
            session.account.id,
            mappedReferencesResult,
            progressState,
        );

        // Verify file still exists in R2.
        const imageBytes = await getR2ObjectBytes(filesBucketName, `${space.id}/${imageFileId}`);
        expect(imageBytes).toEqual(imageContent);
    });

    test("skips files that do not exist on disk", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const importerModule = new TestImporterContextModule();
        const testDiskPath = "test-missing-files";

        // Set up unzipped files - only one file exists.
        const imageContent = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        await importerModule.setUnzippedFiles(testDiskPath, {
            "attachments/image.png": imageContent,
        });

        const diskPathToUnzippedFiles = importerModule.getUnzippedFilesPath(testDiskPath);

        const workspaceId = "test-workspace";
        const importTime = Date.now();
        const imageFileId = generateDeterministicNotionFileIdSync(
            space.id,
            workspaceId,
            "file:attachments/image.png",
            importTime,
        );
        const missingFileId = generateDeterministicNotionFileIdSync(
            space.id,
            workspaceId,
            "file:attachments/missing.pdf",
            importTime,
        );

        const mappedReferencesResult: NotionImportMappedReferencesResult = {
            notionWorkspaceId: workspaceId,
            teamspaces: [],
            filesToUpload: {
                "attachments/image.png": {id: imageFileId},
                "attachments/missing.pdf": {id: missingFileId}, // This file doesn't exist
            },
            diskPathToUnzippedFiles,
            inlineDatabaseChildren: new Map(),
            rootLevelCsvDatabases: new Map(),
            csvDatabasesRequiringDocuments: new Map(),
            pathToDocumentId: new Map(),
            documentIdToPath: new Map(),
            filePathToTeamspaceId: new Map([
                ["attachments/image.png", "test-teamspace"],
                ["attachments/missing.pdf", "test-teamspace"],
            ]),
        };

        const systemContext = createSystemActionContext(space, importerModule);
        const progressState = await createProgressStateForTest({
            systemContext,
            spaceId: space.id,
            accountId: session.account.id,
            mappedReferencesResult,
        });

        // Should not throw even though one file is missing.
        await uploadNotionImportFiles(
            systemContext,
            space.id,
            session.account.id,
            mappedReferencesResult,
            progressState,
        );

        // Verify the existing file was uploaded.
        const imageBytes = await getR2ObjectBytes(filesBucketName, `${space.id}/${imageFileId}`);
        expect(imageBytes).toEqual(imageContent);

        // Verify the missing file was not created.
        const missingFile = await getFileIfExistsAsSystem(systemContext, missingFileId);
        expect(missingFile).toBeNull();
    });

    test("skips files without a teamspace", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const importerModule = new TestImporterContextModule();
        const testDiskPath = "test-no-teamspace";

        const imageContent = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        const orphanContent = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);

        await importerModule.setUnzippedFiles(testDiskPath, {
            "attachments/image.png": imageContent,
            "attachments/orphan.png": orphanContent,
        });

        const diskPathToUnzippedFiles = importerModule.getUnzippedFilesPath(testDiskPath);

        const workspaceId = "test-workspace";
        const importTime = Date.now();
        const imageFileId = generateDeterministicNotionFileIdSync(
            space.id,
            workspaceId,
            "file:attachments/image.png",
            importTime,
        );
        const orphanFileId = generateDeterministicNotionFileIdSync(
            space.id,
            workspaceId,
            "file:attachments/orphan.png",
            importTime,
        );

        const mappedReferencesResult: NotionImportMappedReferencesResult = {
            notionWorkspaceId: workspaceId,
            teamspaces: [],
            filesToUpload: {
                "attachments/image.png": {id: imageFileId},
                "attachments/orphan.png": {id: orphanFileId},
            },
            diskPathToUnzippedFiles,
            inlineDatabaseChildren: new Map(),
            rootLevelCsvDatabases: new Map(),
            csvDatabasesRequiringDocuments: new Map(),
            pathToDocumentId: new Map(),
            documentIdToPath: new Map(),
            // Only image.png has a teamspace; orphan.png does not.
            filePathToTeamspaceId: new Map([["attachments/image.png", "test-teamspace"]]),
        };

        const systemContext = createSystemActionContext(space, importerModule);
        const progressState = await createProgressStateForTest({
            systemContext,
            spaceId: space.id,
            accountId: session.account.id,
            mappedReferencesResult,
        });

        await uploadNotionImportFiles(
            systemContext,
            space.id,
            session.account.id,
            mappedReferencesResult,
            progressState,
        );

        // Verify the image with a teamspace was uploaded.
        const imageBytes = await getR2ObjectBytes(filesBucketName, `${space.id}/${imageFileId}`);
        expect(imageBytes).toEqual(imageContent);

        // Verify the orphan without a teamspace was not uploaded.
        const orphanFile = await getFileIfExistsAsSystem(systemContext, orphanFileId);
        expect(orphanFile).toBeNull();
    });

    test("handles empty filesToUpload", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const importerModule = new TestImporterContextModule();

        const mappedReferencesResult: NotionImportMappedReferencesResult = {
            notionWorkspaceId: "test-workspace",
            teamspaces: [],
            filesToUpload: {},
            diskPathToUnzippedFiles: "/nonexistent/path",
            inlineDatabaseChildren: new Map(),
            rootLevelCsvDatabases: new Map(),
            csvDatabasesRequiringDocuments: new Map(),
            pathToDocumentId: new Map(),
            documentIdToPath: new Map(),
            filePathToTeamspaceId: new Map(),
        };

        const systemContext = createSystemActionContext(space, importerModule);
        const progressState = await createProgressStateForTest({
            systemContext,
            spaceId: space.id,
            accountId: session.account.id,
            mappedReferencesResult,
        });

        // Should complete without error.
        await uploadNotionImportFiles(
            systemContext,
            space.id,
            session.account.id,
            mappedReferencesResult,
            progressState,
        );
    });

    test("uploads files concurrently with rotating pool", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const importerModule = new TestImporterContextModule();
        const testDiskPath = "test-concurrent";

        // Create multiple test files of different sizes.
        const files: Record<string, Uint8Array> = {};
        for (let i = 0; i < 10; i++) {
            // Create files of varying sizes (10, 20, 30, ... bytes).
            const content = new Uint8Array((i + 1) * 10);
            content.fill(i);
            files[`file${i}.bin`] = content;
        }

        await importerModule.setUnzippedFiles(testDiskPath, files);
        const diskPathToUnzippedFiles = importerModule.getUnzippedFilesPath(testDiskPath);

        const workspaceId = "test-workspace";
        const importTime = Date.now();
        const filesToUpload: NotionImportMappedReferencesResult["filesToUpload"] = {};
        for (const fileName of Object.keys(files)) {
            const fileId = generateDeterministicNotionFileIdSync(
                space.id,
                workspaceId,
                `file:${fileName}`,
                importTime,
            );
            filesToUpload[fileName] = {id: fileId};
        }

        const filePathToTeamspaceId = new Map<string, string>();
        for (const fileName of Object.keys(files)) {
            filePathToTeamspaceId.set(fileName, "test-teamspace");
        }

        const mappedReferencesResult: NotionImportMappedReferencesResult = {
            notionWorkspaceId: workspaceId,
            teamspaces: [],
            filesToUpload,
            diskPathToUnzippedFiles,
            inlineDatabaseChildren: new Map(),
            rootLevelCsvDatabases: new Map(),
            csvDatabasesRequiringDocuments: new Map(),
            pathToDocumentId: new Map(),
            documentIdToPath: new Map(),
            filePathToTeamspaceId,
        };

        const systemContext = createSystemActionContext(space, importerModule);
        const progressState = await createProgressStateForTest({
            systemContext,
            spaceId: space.id,
            accountId: session.account.id,
            mappedReferencesResult,
        });

        await uploadNotionImportFiles(
            systemContext,
            space.id,
            session.account.id,
            mappedReferencesResult,
            progressState,
        );

        // Verify all files were uploaded.
        for (const [fileName, content] of Object.entries(files)) {
            const fileId = filesToUpload[fileName]!.id;
            const bytes = await getR2ObjectBytes(filesBucketName, `${space.id}/${fileId}`);
            expect(bytes).toEqual(content);
        }
    });
});
