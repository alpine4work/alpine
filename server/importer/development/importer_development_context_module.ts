import envPaths from "env-paths";
import {mkdir, readFile, readdir, rm, stat, unlink, writeFile} from "fs/promises";
import {dirname, join as joinPath} from "path";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {ImporterContextModuleBase} from "~/server/importer/importer_context_module_base.js";
import {ImporterServiceDevelopmentContextModule} from "~/server/importer/importer_service/importer_service_development_context_module.js";
import {
    ImporterServiceContextModules,
    ImporterServiceSystemActionContext,
} from "~/server/importer/importer_service_context.js";
import {processStartNotionImportJob} from "~/server/importer/notion/process_start_notion_import_job.js";
import {processValidateNotionImportAndExtractMetadataJob} from "~/server/importer/notion/process_validate_notion_import_and_extract_metadata_job.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
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
    processContext: Context<
        Omit<ImporterServiceContextModules, "importerService" | "actor" | "cache" | "batch">
    >,
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
 * 1. `createMultipartUpload` returns an upload ID and creates a parts directory
 * 2. `createPresignedPartUploadUrls` returns URLs like
 *    `http://localhost:3010/dev/import-upload/{importKey}/part/{partNumber}`
 * 3. The client PUTs each chunk to its presigned URL
 * 4. The dev endpoint (defined in `app/routes/dev.import-upload.$.tsx`) saves each
 *    part to `{devEnvPaths.data}/import-uploads/{importKey}.parts/{partNumber}`
 * 5. `completeMultipartUpload` concatenates parts into the final file
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
    private readonly _getProcessContext: () => Context<
        Omit<ImporterServiceContextModules, "importerService" | "actor" | "cache" | "batch">
    >;
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
        getProcessContext: () => Context<
            Omit<ImporterServiceContextModules, "importerService" | "actor" | "cache" | "batch">
        >;
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

    async createMultipartUpload({
        importKey,
    }: {
        importKey: string;
        contentType: string;
        contentLength: number;
    }): Promise<{uploadId: string; importKey: string}> {
        const uploadId = `dev-multipart-${Date.now()}`;

        // Create the parts directory for storing individual parts before assembly.
        const partsDir = joinPath(this._getBasePath(), "import-uploads", `${importKey}.parts`);
        await mkdir(partsDir, {recursive: true});

        return {uploadId, importKey};
    }

    async createPresignedPartUploadUrls({
        importKey,
        partCount,
    }: {
        importKey: string;
        uploadId: string;
        partCount: number;
    }): Promise<Array<{partNumber: number; presignedUrl: string}>> {
        // In development, point to the local dev endpoint. The endpoint is defined in
        // `app/routes/dev.import-upload.$.tsx`.
        const parts: Array<{partNumber: number; presignedUrl: string}> = [];
        for (let i = 1; i <= partCount; i++) {
            parts.push({
                partNumber: i,
                presignedUrl: `${this._context.constants.edgeServiceUrl}/dev/import-upload/${importKey}/part/${i}`,
            });
        }
        return parts;
    }

    async completeMultipartUpload({
        importKey,
    }: {
        importKey: string;
        uploadId: string;
        parts: ReadonlyArray<{partNumber: number; etag: string}>;
    }): Promise<void> {
        const partsDir = joinPath(this._getBasePath(), "import-uploads", `${importKey}.parts`);
        const finalPath = this._getUploadPath(importKey);

        // Read all part files and concatenate them in order. This holds the entire zip in
        // memory to reassemble it, which is fine for development since imports are small.
        // In production, S3 handles reassembly server-side via CompleteMultipartUpload.
        const partFiles = await readdir(partsDir);
        const sortedPartNumbers = partFiles.map(f => parseInt(f, 10)).sort((a, b) => a - b);

        const buffers: Array<Uint8Array> = [];
        for (const partNumber of sortedPartNumbers) {
            const partPath = joinPath(partsDir, String(partNumber));
            const buffer = await readFile(partPath);
            buffers.push(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
        }

        const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const buffer of buffers) {
            combined.set(buffer, offset);
            offset += buffer.length;
        }

        const dir = dirname(finalPath);
        await mkdir(dir, {recursive: true});
        await writeFile(finalPath, combined);

        // Clean up parts directory.
        await rm(partsDir, {recursive: true, force: true});
    }

    async abortMultipartUpload({importKey}: {importKey: string; uploadId: string}): Promise<void> {
        const partsDir = joinPath(this._getBasePath(), "import-uploads", `${importKey}.parts`);
        await rm(partsDir, {recursive: true, force: true}).catch(() => {});
    }

    async hasUploadedFile(importKey: string): Promise<boolean> {
        const filePath = this._getUploadPath(importKey);
        return doesFilePathExist(filePath);
    }

    /**
     * Writes a part file to the dev parts directory. Called by the dev upload endpoint
     * to save individual parts that would normally go to S3.
     */
    public async writePartFile(
        importKey: string,
        partNumber: number,
        data: Uint8Array,
    ): Promise<void> {
        const partsDir = joinPath(this._getBasePath(), "import-uploads", `${importKey}.parts`);
        const partPath = joinPath(partsDir, String(partNumber));

        await mkdir(partsDir, {recursive: true});
        await writeFile(partPath, data);
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
            importerService: new ImporterServiceDevelopmentContextModule({
                getLocalUploadPath:
                    typeof localUploadPath === "string" ? () => localUploadPath : undefined,
            }),
        });
    };
}
