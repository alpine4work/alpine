import envPaths from "env-paths";
import {mkdir, readFile, stat, unlink, writeFile} from "fs/promises";
import {dirname, join as joinPath} from "path";

import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {
    ImporterContextModuleBase,
    PresignedUploadUrlResult,
} from "~/server/importer/importer_context_module_base.js";
import {ImporterServiceDevelopmentContextModule} from "~/server/importer/importer_service/importer_service_development_context_module.js";
import {ImporterServiceSystemActionContext} from "~/server/importer/importer_service_context.js";
import {processStartNotionImportJob} from "~/server/importer/notion/process_start_notion_import_job.js";
import {processValidateNotionImportAndExtractMetadataJob} from "~/server/importer/notion/process_validate_notion_import_and_extract_metadata_job.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";

const devDataPath = envPaths("cyberworlds-development", {suffix: ""}).data;

/**
 * Callback that escalates to importer service context for running import jobs.
 *
 * Takes the process context and space ID, and returns a new context with the
 * importer module set to `ImporterServiceDevelopmentContextModule`.
 */
export type EscalateToImporterServiceContext = (
    processContext: ServerProcessContext,
    spaceId: SpaceId,
) => ImporterServiceSystemActionContext;

async function doesFilePathExist(filePath: string) {
    const result = await stat(filePath).catch(() => null);
    return !!result?.isFile();
}

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
 * In development, imports are processed directly in the current process using
 * `process.waitUntil`. The `escalateToImporterServiceContext` callback constructs
 * a context with `ImporterServiceDevelopmentContextModule`.
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
    private readonly _getProcessContext: () => ServerProcessContext;
    private readonly _escalateToImporterServiceContext: EscalateToImporterServiceContext;

    /**
     * Creates a development importer context module.
     *
     * @param localUploadPath - Optional path for local file storage (defaults to dev
     * data path) @param getProcessContext - Getter that returns the process context.
     * This is a getter instead of a direct value because of circular dependencies: the
     * importer module is created before the process context, but the process context
     * includes the importer module. The getter is only called when methods like
     * `startValidateNotionImport` are invoked, by which time the process context
     * exists. @param escalateToImporterServiceContext - Callback to create an importer
     * service context
     */
    constructor({
        localUploadPath,
        getProcessContext,
        escalateToImporterServiceContext,
    }: {
        localUploadPath?: string;
        getProcessContext: () => ServerProcessContext;
        escalateToImporterServiceContext: EscalateToImporterServiceContext;
    }) {
        super();
        assert(
            process.env.NODE_ENV !== "production",
            "ImporterDevelopmentContextModule should not be used in production",
        );
        this._localUploadPath = localUploadPath;
        this._getProcessContext = getProcessContext;
        this._escalateToImporterServiceContext = escalateToImporterServiceContext;
    }

    private _getBasePath(): string {
        return this._localUploadPath ?? devDataPath;
    }

    private _getUploadPath(importKey: string): string {
        return joinPath(this._getBasePath(), "import-uploads", importKey);
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
        return doesFilePathExist(filePath);
    }

    async readUploadedFile(importKey: string): Promise<Uint8Array | null> {
        const filePath = this._getUploadPath(importKey);

        const isFile = await doesFilePathExist(filePath);
        if (!isFile) {
            return null;
        }

        const buffer = await readFile(filePath);
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    /**
     * Writes a file to the dev upload directory. Called by the dev upload endpoint to
     * save files that would normally go to S3.
     */
    public async writeUploadedFile(importKey: string, data: Uint8Array): Promise<void> {
        const filePath = this._getUploadPath(importKey);
        const dir = dirname(filePath);

        await mkdir(dir, {recursive: true});
        await writeFile(filePath, data);
    }

    async deleteUploadedFile(importKey: string): Promise<void> {
        const filePath = this._getUploadPath(importKey);
        const isFile = await doesFilePathExist(filePath);
        if (isFile) {
            await unlink(filePath);
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
        const processContext = this._getProcessContext();
        processContext.process.waitUntil(
            processContext.tracer.withSpan("Run Notion import validation", async () => {
                const serviceContext = this._escalateToImporterServiceContext(
                    processContext,
                    spaceId,
                );

                await processValidateNotionImportAndExtractMetadataJob(
                    serviceContext,
                    notionImportId,
                );
            }),
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
        const processContext = this._getProcessContext();
        processContext.process.waitUntil(
            processContext.tracer.withSpan("Run Notion import", async () => {
                const serviceContext = this._escalateToImporterServiceContext(
                    processContext,
                    spaceId,
                );

                await processStartNotionImportJob(serviceContext, notionImportId);
            }),
        );
    }

    fork(): ImporterDevelopmentContextModule {
        return new ImporterDevelopmentContextModule({
            localUploadPath: this._localUploadPath,
            getProcessContext: this._getProcessContext,
            escalateToImporterServiceContext: this._escalateToImporterServiceContext,
        });
    }
}

/**
 * Creates the default escalation function for development.
 *
 * This constructs a new context with:
 *
 * - System actor for the given space
 * - ImporterServiceDevelopmentContextModule as the importer
 */
export function createDevelopmentEscalateToImporterServiceContext({
    localUploadPath,
}: {
    localUploadPath?: string;
} = {}): EscalateToImporterServiceContext {
    return (processContext, spaceId) => {
        return processContext.clone({
            tracer: new TracerContextModule(processContext.tracer.getTracer()),
            cache: CacheContextModule.new(),
            batch: BatchContextModule.new(),
            actor: SystemActorContextModule.dangerouslyNew("ImporterService", spaceId),
            importerService: new ImporterServiceDevelopmentContextModule({localUploadPath}),
        });
    };
}
