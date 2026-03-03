import envPaths from "env-paths";
import {existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync} from "fs";
import {dirname, join as joinPath} from "path";
import {
    ImporterContextModuleBase,
    PresignedUploadUrlResult,
} from "~/server/importer/importer_context_module_base.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";

const devDataPath = envPaths("cyberworlds-development", {suffix: ""}).data;

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
    constructor(private localUploadPath?: string) {
        super();
        assert(
            process.env.NODE_ENV !== "production",
            "ImporterContextModuleDevelopment should not be used in production",
        );
    }

    private _getUploadPath(importKey: string): string {
        return joinPath(this.localUploadPath ?? devDataPath, "import-uploads", importKey);
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

    fork(): ImporterDevelopmentContextModule {
        return new ImporterDevelopmentContextModule(this.localUploadPath);
    }
}
