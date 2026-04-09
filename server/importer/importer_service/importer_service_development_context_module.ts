import envPaths from "env-paths";
import {mkdir, stat} from "fs/promises";
import {join as joinPath} from "path";
import {ImporterServiceContextModuleBase} from "~/server/importer/importer_service_context_module_base.js";
import {unzipToDisk} from "~/server/importer/internal/unzip_to_disk.js";
import {DataLossError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

const devDataPath = envPaths("cyberworlds-development", {suffix: ""}).data;

/**
 * Development importer service context module that reads files from the local
 * filesystem.
 *
 * This module is used when running the importer service locally in development. It
 * reads from the same directory that `ImporterDevelopmentContextModule` writes to:
 * `{devEnvPaths.data}/import-uploads/{importKey}`
 *
 * Run `dev path data` to see the data directory path on your machine.
 */
export class ImporterServiceDevelopmentContextModule extends ImporterServiceContextModuleBase {
    private readonly _getLocalUploadPath?: () => string;

    constructor({getLocalUploadPath}: {getLocalUploadPath?: () => string} = {}) {
        super();
        assert(
            process.env.NODE_ENV !== "production",
            "ImporterServiceDevelopmentContextModule should not be used in production",
        );
        this._getLocalUploadPath = getLocalUploadPath;
    }

    private _getBasePath(): string {
        return this._getLocalUploadPath?.() ?? devDataPath;
    }

    private _getUploadPath(importKey: string): string {
        return joinPath(this._getBasePath(), "import-uploads", importKey);
    }

    private _getUnzipPath(importKey: string): string {
        return joinPath(this._getBasePath(), "import-unzipped", importKey.replace(/\//g, "_"));
    }

    /**
     * Reads the import file from local storage and unzips it to disk.
     */
    async downloadAndUnzipImportToDisk(options: {
        importKey: string;
    }): Promise<{diskPathToUnzippedFiles: string}> {
        const {importKey} = options;

        // Get the zip file path (already on disk from the upload)
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

    fork(): ImporterServiceDevelopmentContextModule {
        return new ImporterServiceDevelopmentContextModule({
            getLocalUploadPath: this._getLocalUploadPath,
        });
    }
}
