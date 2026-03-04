import envPaths from "env-paths";
import {unzipSync} from "fflate";
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from "fs";
import {dirname, join as joinPath} from "path";
import {ImporterServiceContextModuleBase} from "~/server/importer/importer_service_context_module_base.js";
import {DataLossError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

const devDataPath = envPaths("cyberworlds-development", {suffix: ""}).data;

/**
 * Development importer service context module that reads files from the local
 * filesystem.
 *
 * This is the `importerService` module used in dev mode when imports are processed
 * in-process. It shares the same file storage location as
 * `ImporterDevelopmentContextModule` (the `importer` module that handles presigned
 * URLs and spawning).
 *
 * In production, `ImporterServiceContextModule` reads from S3 instead.
 *
 * ## File location
 *
 * Files are stored at: `{devEnvPaths.data}/import-uploads/{importKey}`
 *
 * Run `dev path data` to see the data directory path on your machine.
 */
export class ImporterServiceDevelopmentContextModule extends ImporterServiceContextModuleBase {
    private readonly _localUploadPath?: string;

    constructor({localUploadPath}: {localUploadPath?: string} = {}) {
        super();
        assert(
            process.env.NODE_ENV !== "production",
            "ImporterServiceDevelopmentContextModule should not be used in production",
        );
        this._localUploadPath = localUploadPath;
    }

    private _getUploadPath(importKey: string): string {
        return joinPath(this._localUploadPath ?? devDataPath, "import-uploads", importKey);
    }

    private _getUnzipPath(importKey: string): string {
        return joinPath(
            this._localUploadPath ?? devDataPath,
            "import-unzipped",
            importKey.replace(/\//g, "_"),
        );
    }

    async readUploadedFile(importKey: string): Promise<Uint8Array | null> {
        const filePath = this._getUploadPath(importKey);

        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
            return null;
        }

        const buffer = readFileSync(filePath);
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    async downloadAndUnzipImportToDisk(options: {
        importKey: string;
    }): Promise<{diskPathToUnzippedFiles: string}> {
        const {importKey} = options;

        // Get the zip file path (already on disk from the upload)
        const zipFilePath = this._getUploadPath(importKey);
        if (!existsSync(zipFilePath)) {
            throw new DataLossError(`Import file not found: ${importKey}`);
        }

        // Create the unzip directory
        const unzipDir = this._getUnzipPath(importKey);
        if (!existsSync(unzipDir)) {
            mkdirSync(unzipDir, {recursive: true});
        }

        // Extract the zip file to disk
        const zipData = readFileSync(zipFilePath);
        const unzipped = unzipSync(new Uint8Array(zipData));

        for (const [relativePath, data] of Object.entries(unzipped)) {
            const fullPath = joinPath(unzipDir, relativePath);
            const dir = dirname(fullPath);
            if (!existsSync(dir)) {
                mkdirSync(dir, {recursive: true});
            }
            writeFileSync(fullPath, data);
        }

        return {diskPathToUnzippedFiles: unzipDir};
    }

    fork(): ImporterServiceDevelopmentContextModule {
        return new ImporterServiceDevelopmentContextModule({
            localUploadPath: this._localUploadPath,
        });
    }
}
