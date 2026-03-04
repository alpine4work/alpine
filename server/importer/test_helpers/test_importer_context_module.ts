import {ImporterServiceDevelopmentContextModule} from "~/server/importer/development/importer_service_development_context_module.js";
import {
    ImporterContextModuleBase,
    PresignedUploadUrlResult,
} from "~/server/importer/importer_context_module_base.js";
import {ImporterServiceSystemActionContext} from "~/server/importer/importer_service_context.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Shared file storage for test importer modules. This allows
 * TestImporterContextModule and TestImporterServiceContextModule to share the same
 * file data in tests.
 */
export class TestImporterFileStorage {
    private readonly _files = new Map<string, Uint8Array>();

    has(importKey: string): boolean {
        return this._files.has(importKey);
    }

    get(importKey: string): Uint8Array | null {
        return this._files.get(importKey) ?? null;
    }

    set(importKey: string, data: Uint8Array): void {
        this._files.set(importKey, data);
    }

    delete(importKey: string): void {
        this._files.delete(importKey);
    }

    clone(): TestImporterFileStorage {
        const storage = new TestImporterFileStorage();
        for (const [key, value] of this._files) {
            storage._files.set(key, value);
        }
        return storage;
    }
}

/**
 * Test importer service context module that reads files from shared storage. Use
 * this as the `importerService` module in tests.
 *
 * Extends ImporterServiceDevelopmentContextModule so it can replace that module in
 * cloned contexts (Context.clone requires replacement modules to be subclasses).
 */
export class TestImporterServiceContextModule extends ImporterServiceDevelopmentContextModule {
    private readonly _storage: TestImporterFileStorage;

    constructor(storage: TestImporterFileStorage) {
        super();
        assert(process.env.NODE_ENV === "test");
        this._storage = storage;
    }

    override async readUploadedFile(importKey: string): Promise<Uint8Array | null> {
        return this._storage.get(importKey);
    }

    override fork(): TestImporterServiceContextModule {
        return new TestImporterServiceContextModule(this._storage.clone());
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
 * Test importer context module that stores files in memory.
 *
 * This module is used in unit tests where filesystem access isn't available (e.g.,
 * in Bazel sandboxed tests).
 *
 * The `waitUntilAndEscalateToSystemContext` callback is optional:
 *
 * - If provided: Used to run actual import processing in memory
 * - If not provided: The module just tracks calls without running anything
 *
 * The module tracks calls to `startValidateNotionImport` and `startNotionImport`
 * in arrays that tests can inspect to verify imports were triggered.
 */
export class TestImporterContextModule extends ImporterContextModuleBase {
    private readonly _storage: TestImporterFileStorage;
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
     * @param options.storage - Optional shared file storage. If not provided, creates
     * new storage. @param options.waitUntilAndEscalateToSystemContext - Optional
     * callback to run actual import processing, or a factory function that returns the
     * callback (for lazy initialization). If not provided, the module just tracks
     * calls without running anything.
     */
    constructor(options?: {
        storage?: TestImporterFileStorage;
        waitUntilAndEscalateToSystemContext?:
            | WaitUntilAndEscalateToSystemContext
            | (() => WaitUntilAndEscalateToSystemContext);
    }) {
        super();
        assert(process.env.NODE_ENV === "test");

        this._storage = options?.storage ?? new TestImporterFileStorage();

        const waitUntilAndEscalateToSystemContext = options?.waitUntilAndEscalateToSystemContext;

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

    /**
     * Gets the shared file storage for use with TestImporterServiceContextModule.
     */
    get storage(): TestImporterFileStorage {
        return this._storage;
    }

    async createPresignedUploadUrl({
        importKey,
    }: {
        importKey: string;
        contentType: string;
        contentLength: number;
    }): Promise<PresignedUploadUrlResult> {
        const presignedUploadUrl = `https://test.cyberworlds.dev/dev/import-upload/${importKey}`;
        return {presignedUploadUrl, importKey};
    }

    async hasUploadedFile(importKey: string): Promise<boolean> {
        return this._storage.has(importKey);
    }

    async readUploadedFile(importKey: string): Promise<Uint8Array | null> {
        return this._storage.get(importKey);
    }

    async deleteUploadedFile(importKey: string): Promise<void> {
        this._storage.delete(importKey);
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
     * Test helper to simulate a file being uploaded.
     */
    public setUploadedFile(importKey: string, data: Uint8Array): void {
        this._storage.set(importKey, data);
    }

    /**
     * Creates a TestImporterServiceContextModule that shares this module's storage.
     */
    public createServiceModule(): TestImporterServiceContextModule {
        return new TestImporterServiceContextModule(this._storage);
    }

    fork(): TestImporterContextModule {
        // Pass the already-resolved callback directly, not a factory.
        return new TestImporterContextModule({
            storage: this._storage.clone(),
            waitUntilAndEscalateToSystemContext: this._waitUntilCallback ?? undefined,
        });
    }
}
