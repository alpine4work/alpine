/**
 * Uploads files from a Notion import to Alpine's file storage.
 *
 * ## Processing Order
 *
 * Files are processed in a specific order to optimize resource usage:
 *
 * 1. **Light files** (images, PDFs, etc.) - parallel with `availableParallelism()`
 *    concurrency
 * 2. **Heavy files** (video, audio) - sequential, one at a time
 *
 * ## Why This Order
 *
 * Heavy files (video/audio) use FFmpeg which internally uses all available CPU
 * cores. Running multiple FFmpeg processes causes CPU thrashing. Light files use
 * Sharp/libuv which are lighter weight and benefit from parallelism.
 *
 * ## Why NOT worker_threads
 *
 * We considered Node.js `worker_threads` but decided against it because:
 *
 * 1. File processing requires full server context (DynamoDB, R2, tracer) which
 *    would require complex serialization
 * 2. The CPU-intensive work happens in external native processes (Sharp, FFmpeg)
 *    that already parallelize internally
 * 3. Node.js just orchestrates I/O and external tools here
 */
import {statSync} from "fs";
import {availableParallelism} from "os";
import {join as joinPath} from "path";
import {routeFileToProcessor} from "~/server/files/data/route_file_to_processor.js";
import {ImporterServiceSystemActionContext} from "~/server/importer/importer_service_context.js";
import {NotionImporterProgressState} from "~/server/importer/notion/internal/notion_importer_progress_state.js";
import {NotionImportMappedReferencesResult} from "~/server/importer/notion/internal/parse_notion_import_and_map_references.js";
import {uploadFileForNotionImport} from "~/server/importer/notion/internal/upload_file_for_notion_import.js";
import {FileContentType, getPathFileContentTypeIfExists} from "~/shared/files/file_content_type.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId, FileId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Maximum number of light files to upload concurrently.
 */
const numberOfConcurrentLightFiles = availableParallelism();

/**
 * Represents a file that needs to be uploaded, enriched with metadata.
 */
interface NotionImportFileToUpload {
    /** The relative file path within the unzipped export. */
    relativeFilePath: string;
    /** The pre-assigned file ID from reference mapping. */
    fileId: FileId;
    /** The size of the file in bytes (used for ordering). */
    sizeInBytes: number;
    /** The mimetype for counter tracking (e.g. "image/png", "video/mp4"). */
    contentType: FileContentType;
    /** The teamspace this file belongs to. */
    teamspaceId: string;
}

/**
 * Uploads all files from a Notion import to Alpine's file storage.
 *
 * This function:
 *
 * 1. Reads file metadata to determine sizes
 * 2. For each file:
 *     - Determines content type from the file extension
 *     - Creates a file record in DynamoDB
 *     - Uploads the file to Cloudflare R2
 *     - Processes the file inline using the file processor
 *
 * File processing is done inline to avoid overwhelming the file processor service
 * with many jobs during an import. We call `processFile` directly which handles
 * all content types (images, PDFs, videos, audio, code, MS Office documents).
 *
 * Files that don't have a recognized content type are uploaded as
 * `application/octet-stream` (binary/unknown).
 *
 * Processing order:
 *
 * 1. Light files (images, PDFs, etc.) - parallel with availableParallelism()
 *    concurrency
 * 2. Heavy files (video, audio) - sequential, one at a time
 */
export async function uploadNotionImportFiles(
    context: ImporterServiceSystemActionContext,
    spaceId: SpaceId,
    uploaderId: AccountId,
    mappedReferencesResult: NotionImportMappedReferencesResult,
    progressState: NotionImporterProgressState,
): Promise<void> {
    await context.tracer.withSpan("Upload notion import files", async (_tracerContext, span) => {
        const {filesToUpload, diskPathToUnzippedFiles, filePathToTeamspaceId} =
            mappedReferencesResult;

        // Build lists of files, separated by heavy vs light.
        const lightFiles: Array<NotionImportFileToUpload> = [];
        const heavyFiles: Array<NotionImportFileToUpload> = [];

        for (const [relativeFilePath, {id: fileId}] of Object.entries(filesToUpload)) {
            const absolutePath = joinPath(diskPathToUnzippedFiles, relativeFilePath);
            let sizeInBytes: number;
            try {
                const stats = statSync(absolutePath);
                sizeInBytes = stats.size;
            } catch {
                // Skip files that don't exist or can't be read.
                continue;
            }

            // NOTE(imjoshin, 2026-02-25) - Skip files that don't belong to any teamspace we're
            // importing. The Workspace-Flat export in our test fixtures has an orphaned
            // "Untitled 26c7-4124.md" file — no content, no reference in the index.html, no
            // copy of it in Notion itself. It's just... there. No pattern that would indicate
            // when it shows up, but we don't have any reason to import it.
            const teamspaceId = filePathToTeamspaceId.get(relativeFilePath);
            if (teamspaceId === undefined) continue;

            const contentType =
                getPathFileContentTypeIfExists(relativeFilePath) ?? "application/octet-stream";
            const file = {relativeFilePath, fileId, sizeInBytes, contentType, teamspaceId};

            // Classify as heavy or light using the same routing logic as file processing.
            // Heavy files (video, audio needing transcoding, large files) are processed
            // sequentially. Light files (images, small docs) are processed in parallel.
            const {jobType} = routeFileToProcessor({
                contentType,
                contentLength: sizeInBytes,
            });
            if (jobType === "ProcessFileHeavy") {
                heavyFiles.push(file);
            } else {
                lightFiles.push(file);
            }
        }

        span.addData({common: {count: lightFiles.length + heavyFiles.length}});

        // Helper to upload a single file.
        const uploadFile = async (file: NotionImportFileToUpload): Promise<void> => {
            await uploadFileForNotionImport(context, {
                spaceId,
                uploaderId,
                diskPathToUnzippedFiles,
                relativeFilePath: file.relativeFilePath,
                fileId: file.fileId,
                contentLength: file.sizeInBytes,
                contentType: file.contentType,
                teamspaceId: file.teamspaceId,
                progressState,
            });
        };

        // Phase 1: Upload light files in parallel using rotating pool.
        if (lightFiles.length > 0) {
            await context.tracer.withSpan(
                "Upload notion import light files",
                async (_tracerContext, span) => {
                    span.addData({common: {count: lightFiles.length}});
                    await uploadFilesWithPool(lightFiles, uploadFile, numberOfConcurrentLightFiles);
                },
            );
        }

        // Phase 2: Upload heavy files sequentially (one at a time). Heavy files
        // (video/audio) use FFmpeg which uses all CPU cores internally.
        if (heavyFiles.length > 0) {
            await context.tracer.withSpan(
                "Upload notion import heavy files",
                async (_tracerContext, span) => {
                    span.addData({common: {count: heavyFiles.length}});
                    for (const file of heavyFiles) {
                        await uploadFile(file);
                    }
                },
            );
        }
    });
}

/**
 * Uploads files using a rotating pool pattern.
 *
 * Maintains `concurrency` active uploads at all times. When one completes,
 * immediately starts the next. More efficient than batching because we don't wait
 * for the slowest file in each batch.
 */
async function uploadFilesWithPool(
    files: Array<NotionImportFileToUpload>,
    uploadFile: (file: NotionImportFileToUpload) => Promise<void>,
    concurrency: number,
): Promise<void> {
    let nextFileIndex = 0;
    let firstError: unknown = null;

    const getNextFile = (): NotionImportFileToUpload | null => {
        if (nextFileIndex >= files.length) {
            return null;
        }
        const file = files[nextFileIndex]!;
        nextFileIndex += 1;
        return file;
    };

    const runWorker = async (): Promise<void> => {
        while (true) {
            // If we've already encountered an error, stop processing.
            if (firstError !== null) {
                return;
            }

            const file = getNextFile();
            if (file === null) {
                return;
            }

            try {
                await uploadFile(file);
            } catch (error) {
                // Capture the first error to throw later.
                if (firstError === null) {
                    firstError = error;
                }
                return;
            }
        }
    };

    // Start the worker pool.
    const workers: Array<Promise<void>> = [];
    for (let i = 0; i < concurrency && i < files.length; i++) {
        workers.push(runWorker());
    }

    await runAllPromises(workers);

    if (firstError !== null) {
        throw firstError;
    }
}
