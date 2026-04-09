import {mkdir, stat, unlink, writeFile} from "fs/promises";
import {join as joinPath} from "path";

import {ImporterServiceDevelopmentContextModule} from "~/server/importer/importer_service/importer_service_development_context_module.js";
import {ImporterServiceSystemActionContext} from "~/server/importer/importer_service_context.js";
import {ImporterServiceContextModuleBase} from "~/server/importer/importer_service_context_module_base.js";
import {unzipToDisk} from "~/server/importer/internal/unzip_to_disk.js";
import {DataLossError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Test importer service context module that reads files from a shared disk
 * location. Use this as the `importerService` module in tests.
 *
 * Extends ImporterServiceDevelopmentContextModule so it can replace that module in
 * cloned contexts (Context.clone requires replacement modules to be subclasses).
 */
export class TestImporterServiceContextModule extends ImporterServiceDevelopmentContextModule {
    private readonly _testBasePath: string;

    constructor(basePath: string) {
        super();
        assert(process.env.NODE_ENV === "test");
        this._testBasePath = basePath;
    }

    private _testGetUploadPath(importKey: string): string {
        return joinPath(this._testBasePath, "import-uploads", importKey);
    }

    private _testGetUnzipPath(importKey: string): string {
        return joinPath(this._testBasePath, "import-unzipped", importKey);
    }

    override async downloadAndUnzipImportToDisk(options: {
        importKey: string;
    }): Promise<{diskPathToUnzippedFiles: string}> {
        const {importKey} = options;

        // Get the zip file path
        const zipFilePath = this._testGetUploadPath(importKey);
        const zipStat = await stat(zipFilePath).catch(() => null);
        if (!zipStat) {
            throw new DataLossError(`Import file not found: ${importKey}`);
        }

        // Create the unzip directory
        const unzipDir = this._testGetUnzipPath(importKey);
        await mkdir(unzipDir, {recursive: true});

        // Extract the zip file
        await unzipToDisk(zipFilePath, unzipDir);

        return {diskPathToUnzippedFiles: unzipDir};
    }

    override fork(): TestImporterServiceContextModule {
        return new TestImporterServiceContextModule(this._testBasePath);
    }
}

/**
 * Callback that handles running an action in the background with system context.
 * The caller is responsible for:
 *
 * 1. Running the action in the background (e.g., via `process.waitUntil`)
 * 2. Creating a tracer span
 * 3. Escalating to system context for the given space
 * 4. Adding the importer module to the context
 */
export type WaitUntilAndEscalateToSystemContext = (
    spanName: string,
    spaceId: SpaceId,
    action: (context: ImporterServiceSystemActionContext) => Promise<void>,
) => void;

/**
 * Test importer context module that uses disk storage via TEST_TMPDIR.
 *
 * This module is used in unit tests running in Bazel, which provides the
 * TEST_TMPDIR environment variable pointing to a writable temp directory.
 *
 * Uses the same disk-based unzip logic as production/development, ensuring tests
 * exercise the real code paths.
 *
 * The `waitUntilAndEscalateToSystemContext` callback is optional:
 *
 * - If provided: Used to run actual import processing
 * - If not provided: The module just tracks calls without running anything
 *
 * The module tracks calls to `startValidateNotionImport` and `startNotionImport`
 * in arrays that tests can inspect to verify imports were triggered.
 */
export class TestImporterContextModule extends ImporterServiceContextModuleBase {
    private readonly _getLocalUploadPath: () => string;
    private readonly _waitUntilCallback: WaitUntilAndEscalateToSystemContext | null;

    /**
     * Records of calls to startValidateNotionImport for test verification.
     */
    public readonly startValidateNotionImportCalls: Array<{
        spaceId: SpaceId;
        notionImportId: NotionImportId;
        importZipSize: number;
    }> = [];

    /**
     * Records of calls to startNotionImport for test verification.
     */
    public readonly startNotionImportCalls: Array<{
        spaceId: SpaceId;
        notionImportId: NotionImportId;
        importZipSize: number;
    }> = [];

    /**
     * Creates a test importer context module.
     *
     * @param waitUntilAndEscalateToSystemContext - Optional callback to run actual
     * import processing, or a factory function that returns the callback (for lazy
     * initialization). If not provided, the module just tracks calls without running
     * anything.
     */
    constructor({
        getLocalUploadPath,
        waitUntilAndEscalateToSystemContext,
    }: {
        getLocalUploadPath: () => string;
        waitUntilAndEscalateToSystemContext?:
            | WaitUntilAndEscalateToSystemContext
            | (() => WaitUntilAndEscalateToSystemContext);
    }) {
        super();
        assert(process.env.NODE_ENV === "test");

        this._getLocalUploadPath = getLocalUploadPath;

        // Resolve the callback eagerly since the context module is frozen after
        // construction.
        if (waitUntilAndEscalateToSystemContext === undefined) {
            this._waitUntilCallback = null;
        } else if (typeof waitUntilAndEscalateToSystemContext === "function") {
            // Check if it's a factory (0-arg) or the actual callback (3-arg)
            if (waitUntilAndEscalateToSystemContext.length === 0) {
                this._waitUntilCallback = (
                    waitUntilAndEscalateToSystemContext as () => WaitUntilAndEscalateToSystemContext
                )();
            } else {
                this._waitUntilCallback =
                    waitUntilAndEscalateToSystemContext as WaitUntilAndEscalateToSystemContext;
            }
        } else {
            this._waitUntilCallback = null;
        }
    }

    private _getUploadPath(importKey: string): string {
        return joinPath(this._getLocalUploadPath(), "import-uploads", importKey);
    }

    private _getUnzipPath(importKey: string): string {
        return joinPath(this._getLocalUploadPath(), "import-unzipped", importKey);
    }

    async createMultipartUpload({
        importKey,
    }: {
        importKey: string;
        contentType: string;
        contentLength: number;
    }): Promise<{uploadId: string; importKey: string}> {
        return {uploadId: `test-multipart-${Date.now()}`, importKey};
    }

    async createPresignedPartUploadUrls({
        importKey,
        partCount,
    }: {
        importKey: string;
        uploadId: string;
        partCount: number;
    }): Promise<Array<{partNumber: number; presignedUrl: string}>> {
        const parts: Array<{partNumber: number; presignedUrl: string}> = [];
        for (let i = 1; i <= partCount; i++) {
            parts.push({
                partNumber: i,
                presignedUrl: `https://test.cyberworlds.dev/dev/import-upload/${importKey}/part/${i}`,
            });
        }
        return parts;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async completeMultipartUpload(options: {
        importKey: string;
        uploadId: string;
        parts: ReadonlyArray<{partNumber: number; etag: string}>;
    }): Promise<void> {
        // No-op in tests.
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async abortMultipartUpload(options: {importKey: string; uploadId: string}): Promise<void> {
        // No-op in tests.
    }

    async hasUploadedFile(importKey: string): Promise<boolean> {
        const filePath = this._getUploadPath(importKey);
        const fileStat = await stat(filePath).catch(() => null);
        return fileStat?.isFile() ?? false;
    }

    async deleteUploadedFile(importKey: string): Promise<void> {
        const filePath = this._getUploadPath(importKey);
        const fileStat = await stat(filePath).catch(() => null);
        if (fileStat?.isFile()) {
            await unlink(filePath);
        }
    }

    /**
     * Downloads the import file and unzips it to disk.
     */
    async downloadAndUnzipImportToDisk(options: {
        importKey: string;
    }): Promise<{diskPathToUnzippedFiles: string}> {
        const {importKey} = options;

        // Get the zip file path
        const zipFilePath = this._getUploadPath(importKey);
        const zipStat = await stat(zipFilePath).catch(() => null);
        if (!zipStat) {
            throw new DataLossError(`Import file not found: ${importKey}`);
        }

        // Create the unzip directory
        const unzipDir = this._getUnzipPath(importKey);
        await mkdir(unzipDir, {recursive: true});

        // Extract the zip file
        await unzipToDisk(zipFilePath, unzipDir);

        return {diskPathToUnzippedFiles: unzipDir};
    }

    async startValidateNotionImport(options: {
        spaceId: SpaceId;
        notionImportId: NotionImportId;
        importZipSize: number;
    }): Promise<void> {
        // Record the call for test verification.
        this.startValidateNotionImportCalls.push(options);

        // If a callback was provided, run actual import processing. Import the process
        // function dynamically to avoid circular deps.
        const callback = this._waitUntilCallback;
        if (callback) {
            callback("Test: Run Notion import validation", options.spaceId, async ctx => {
                const {processValidateNotionImportAndExtractMetadataJob} =
                    await import("~/server/importer/notion/process_validate_notion_import_and_extract_metadata_job.js");
                await processValidateNotionImportAndExtractMetadataJob(ctx, options.notionImportId);
            });
        }
    }

    async startNotionImport(options: {
        spaceId: SpaceId;
        notionImportId: NotionImportId;
        importZipSize: number;
    }): Promise<void> {
        // Record the call for test verification.
        this.startNotionImportCalls.push(options);

        // If a callback was provided, run actual import processing. Import the process
        // function dynamically to avoid circular deps.
        const callback = this._waitUntilCallback;
        if (callback) {
            callback("Test: Run Notion import", options.spaceId, async ctx => {
                const {processStartNotionImportJob} =
                    await import("~/server/importer/notion/process_start_notion_import_job.js");
                await processStartNotionImportJob(ctx, options.notionImportId);
            });
        }
    }

    /**
     * Test helper to simulate a file being uploaded. Writes the file to disk at the
     * upload path.
     */
    public async setUploadedFile(importKey: string, data: Uint8Array): Promise<void> {
        const filePath = this._getUploadPath(importKey);
        const dir = joinPath(filePath, "..");

        await mkdir(dir, {recursive: true});
        await writeFile(filePath, data);
    }

    /**
     * Test helper to set unzipped files directly for a given disk path. This bypasses
     * the actual unzip step and allows tests to directly provide file contents that
     * will be returned by readUnzippedFile.
     *
     * @param diskPath - The disk path to use (will be created under TEST_TMPDIR)
     * @param files - Object mapping relative file paths to their contents
     */
    public async setUnzippedFiles(
        diskPath: string,
        files: Record<string, Uint8Array>,
    ): Promise<void> {
        const fullPath = joinPath(this._getLocalUploadPath(), "import-unzipped", diskPath);

        for (const [relativePath, content] of Object.entries(files)) {
            const filePath = joinPath(fullPath, relativePath);
            const dir = joinPath(filePath, "..");

            await mkdir(dir, {recursive: true});
            await writeFile(filePath, content);
        }
    }

    /**
     * Returns the actual disk path for a given lookup key. Used by tests that call
     * setUnzippedFiles with a key and need the real path.
     */
    public getUnzippedFilesPath(diskPath: string): string {
        return joinPath(this._getLocalUploadPath(), "import-unzipped", diskPath);
    }

    /**
     * Creates a TestImporterServiceContextModule that shares this module's disk
     * location.
     */
    public createServiceModule(): TestImporterServiceContextModule {
        return new TestImporterServiceContextModule(this._getLocalUploadPath());
    }

    fork(): TestImporterContextModule {
        return new TestImporterContextModule({
            getLocalUploadPath: this._getLocalUploadPath,
            // Pass the already-resolved callback directly, not a factory.
            waitUntilAndEscalateToSystemContext: this._waitUntilCallback ?? undefined,
        });
    }
}
