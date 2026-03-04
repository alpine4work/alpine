import envPaths from "env-paths";
import {existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync} from "fs";
import {dirname, join as joinPath} from "path";
import {
    ImporterContextModuleBase,
    PresignedUploadUrlResult,
} from "~/server/importer/importer_context_module_base.js";
import {ImporterServiceSystemActionContext} from "~/server/importer/importer_service_context.js";
import {processStartNotionImportJob} from "~/server/importer/notion/process_start_notion_import_job.js";
import {processValidateNotionImportAndExtractMetadataJob} from "~/server/importer/notion/process_validate_notion_import_and_extract_metadata_job.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";

const devDataPath = envPaths("cyberworlds-development", {suffix: ""}).data;

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
 * Development importer context module that uses the local filesystem.
 *
 * Instead of uploading to S3, files are stored in the dev environment data
 * directory. The presigned URL points to a development-only endpoint served by the
 * app service.
 *
 * ## How it works
 *
 * 1. `createPresignedUploadUrl` returns a URL like
 *    `http://localhost:3010/dev/import-upload/{importKey}`
 * 2. The client PUTs the file to this URL
 * 3. The dev endpoint (defined in `app/routes/dev.import-upload.$.tsx`) saves the
 *    file to `{devEnvPaths.data}/import-uploads/{importKey}`
 * 4. `readUploadedFile` reads directly from the filesystem
 *
 * ## Import processing
 *
 * In development, imports are processed directly in the current process. The
 * `waitUntilAndEscalateToSystemContext` callback handles running the import in the
 * background with the appropriate context.
 *
 * ## File location
 *
 * Files are stored at: `{devEnvPaths.data}/import-uploads/{importKey}`
 *
 * Run `dev path data` to see the data directory path on your machine.
 */
export class ImporterDevelopmentContextModule extends ImporterContextModuleBase<{
    tracer: TracerContextModule;
    constants: ConstantsContextModule;
}> {
    private readonly _localUploadPath?: string;
    private readonly _waitUntilAndEscalateToSystemContext: WaitUntilAndEscalateToSystemContext;

    constructor({
        localUploadPath,
        waitUntilAndEscalateToSystemContext,
    }: {
        localUploadPath?: string;
        waitUntilAndEscalateToSystemContext: WaitUntilAndEscalateToSystemContext;
    }) {
        super();
        assert(
            process.env.NODE_ENV !== "production",
            "ImporterDevelopmentContextModule should not be used in production",
        );
        this._localUploadPath = localUploadPath;
        this._waitUntilAndEscalateToSystemContext = waitUntilAndEscalateToSystemContext;
    }

    private _getUploadPath(importKey: string): string {
        return joinPath(this._localUploadPath ?? devDataPath, "import-uploads", importKey);
    }

    async createPresignedUploadUrl({
        importKey,
    }: {
        importKey: string;
        contentType: string;
        contentLength: number;
    }): Promise<PresignedUploadUrlResult> {
        // In development, point to the local dev endpoint. The endpoint is defined in
        // `app/routes/dev.import-upload.$.tsx`.
        const presignedUploadUrl = `${this._context.constants.edgeServiceUrl}/dev/import-upload/${importKey}`;

        return {presignedUploadUrl, importKey};
    }

    async hasUploadedFile(importKey: string): Promise<boolean> {
        const filePath = this._getUploadPath(importKey);
        return existsSync(filePath) && statSync(filePath).isFile();
    }

    async readUploadedFile(importKey: string): Promise<Uint8Array | null> {
        const filePath = this._getUploadPath(importKey);

        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
            return null;
        }

        const buffer = readFileSync(filePath);
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    /**
     * Writes a file to the dev upload directory. Called by the dev upload endpoint to
     * save files that would normally go to S3.
     */
    public writeUploadedFile(importKey: string, data: Uint8Array): void {
        const filePath = this._getUploadPath(importKey);
        const dir = dirname(filePath);

        if (!existsSync(dir)) {
            mkdirSync(dir, {recursive: true});
        }

        writeFileSync(filePath, data);
    }

    async deleteUploadedFile(importKey: string): Promise<void> {
        const filePath = this._getUploadPath(importKey);
        if (existsSync(filePath) && statSync(filePath).isFile()) {
            unlinkSync(filePath);
        }
    }

    async startValidateNotionImport({
        spaceId,
        notionImportId,
    }: {
        spaceId: SpaceId;
        notionImportId: NotionImportId;
        importZipSize: number;
    }): Promise<void> {
        this._waitUntilAndEscalateToSystemContext(
            "Run Notion import validation",
            spaceId,
            async ctx => {
                await processValidateNotionImportAndExtractMetadataJob(ctx, notionImportId);
            },
        );
    }

    async startNotionImport({
        spaceId,
        notionImportId,
    }: {
        spaceId: SpaceId;
        notionImportId: NotionImportId;
        importZipSize: number;
    }): Promise<void> {
        this._waitUntilAndEscalateToSystemContext("Run Notion import", spaceId, async ctx => {
            await processStartNotionImportJob(ctx, notionImportId);
        });
    }

    fork(): ImporterDevelopmentContextModule {
        return new ImporterDevelopmentContextModule({
            localUploadPath: this._localUploadPath,
            waitUntilAndEscalateToSystemContext: this._waitUntilAndEscalateToSystemContext,
        });
    }
}
