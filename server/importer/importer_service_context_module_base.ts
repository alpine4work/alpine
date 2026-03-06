import {readFile, readdir, stat} from "fs/promises";
import {join as joinPath} from "path";

import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

/**
 * Base context module for the importer service (the spawned Fargate task).
 *
 * This module handles reading and processing import files that have already been
 * uploaded. It does NOT handle:
 *
 * - Creating presigned URLs (app service does this)
 * - Spawning tasks (app service does this)
 *
 * ## Production (`ImporterServiceContextModule`)
 *
 * Downloads files from S3 to disk for processing.
 *
 * ## Development (`ImporterServiceDevelopmentContextModule`)
 *
 * Reads files from the local dev data directory.
 */
export abstract class ImporterServiceContextModuleBase<
    Modules extends {
        tracer: TracerContextModule;
    } = {
        tracer: TracerContextModule;
    },
> extends ContextModuleBase<Modules> {
    /**
     * Reads an uploaded import file.
     *
     * In production: Reads from S3. In development: Reads from the local filesystem.
     *
     * This is typically used for validation before extraction.
     *
     * @param importKey - The key returned from `createPresignedUploadUrl` @returns The
     * file contents as a Uint8Array, or null if not found
     */
    abstract readUploadedFile(importKey: string): Promise<Uint8Array | null>;

    /**
     * Downloads an import zip file and extracts it to disk.
     *
     * In production: Downloads from S3 to disk, then unzips to a directory. In
     * development: Reads from local storage, then unzips to a local directory.
     *
     * @param importKey - The key of the import file to download @returns The path to
     * the unzipped files on disk
     */
    abstract downloadAndUnzipImportToDisk(options: {
        importKey: string;
    }): Promise<{diskPathToUnzippedFiles: string}>;

    /**
     * Lists all files in the unzipped import directory.
     *
     * @param diskPathToUnzippedFiles - The disk path from downloadAndUnzipImportToDisk
     * @returns Array of relative file paths
     */
    async listUnzippedFiles(options: {diskPathToUnzippedFiles: string}): Promise<Array<string>> {
        const {diskPathToUnzippedFiles} = options;

        const dirStat = await stat(diskPathToUnzippedFiles).catch(() => null);
        if (!dirStat) {
            return [];
        }

        const results: Array<string> = [];
        const walkDir = async (dir: string, prefix: string): Promise<void> => {
            const entries = await readdir(dir, {withFileTypes: true});
            for (const entry of entries) {
                const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    await walkDir(joinPath(dir, entry.name), relativePath);
                } else if (entry.isFile()) {
                    results.push(relativePath);
                }
            }
        };

        await walkDir(diskPathToUnzippedFiles, "");
        return results;
    }

    /**
     * Reads a file from the unzipped import directory.
     *
     * @param diskPathToUnzippedFiles - The disk path from downloadAndUnzipImportToDisk
     * @param relativeFilePath - The path of the file relative to the unzipped root
     * @returns The file contents, or null if not found
     */
    async readUnzippedFile(options: {
        diskPathToUnzippedFiles: string;
        relativeFilePath: string;
    }): Promise<Uint8Array | null> {
        const {diskPathToUnzippedFiles, relativeFilePath} = options;
        const filePath = joinPath(diskPathToUnzippedFiles, relativeFilePath);

        const fileStat = await stat(filePath).catch(() => null);
        if (!fileStat?.isFile()) {
            return null;
        }

        const buffer = await readFile(filePath);
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    abstract fork(): ForkableContextModuleBase;
}
