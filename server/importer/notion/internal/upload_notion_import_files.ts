import {statSync} from "fs";
import {tmpdir} from "os";
import {join as joinPath} from "path";
import {fileProcessorDeclarationByContentType} from "~/server/files/data/file_processor_declaration_by_content_type.js";
import {
    finishUploadingAndStartProcessingFile,
    getFileIfExistsAsSystem,
    startUploadingFile,
} from "~/server/files/data/files_actions.js";
import {routeFileToProcessor} from "~/server/files/data/route_file_to_processor.js";
import {processFile} from "~/server/files/processor/process_file.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {withTemporaryDirectory} from "~/server/helpers/node/with_temporary_directory.js";
import {ImporterServiceSystemActionContext} from "~/server/importer/importer_service_context.js";
import {NotionImportMappedReferencesResult} from "~/server/importer/notion/internal/parse_notion_import_and_map_references.js";
import {impersonateAccountAsSystemContext} from "~/server/spaces/impersonate_account_as_system_context.js";
import {getPathFileContentTypeIfExists} from "~/shared/files/file_content_type.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {AccountId, FileId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Represents a file that needs to be uploaded, enriched with size information for
 * sorting.
 */
interface NotionImportFileToUpload {
    /** The relative file path within the unzipped export. */
    relativeFilePath: string;
    /** The pre-assigned file ID from reference mapping. */
    fileId: FileId;
    /** The size of the file in bytes (used for ordering). */
    sizeInBytes: number;
}

/**
 * Uploads all files from a Notion import to Alpine's file storage.
 *
 * This function:
 *
 * 1. Reads file metadata to determine sizes
 * 2. Orders files by size (smallest first) to process many files quickly
 * 3. For each file:
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
 * @param context - System action context with importer module @param spaceId - The
 * space to upload files into @param uploaderId - The account ID to attribute
 * uploads to @param mappedReferencesResult - Contains filesToUpload and disk paths
 */
export async function uploadNotionImportFiles(
    context: ImporterServiceSystemActionContext,
    spaceId: SpaceId,
    uploaderId: AccountId,
    mappedReferencesResult: NotionImportMappedReferencesResult,
): Promise<void> {
    const {filesToUpload, diskPathToUnzippedFiles} = mappedReferencesResult;

    // Build list of files with their sizes for ordering.
    const filesToProcess: Array<NotionImportFileToUpload> = [];
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

        filesToProcess.push({relativeFilePath, fileId, sizeInBytes});
    }

    // Sort by size ascending - process smaller files first so they complete quickly
    // while larger files continue processing.
    filesToProcess.sort((a, b) => a.sizeInBytes - b.sizeInBytes);

    if (filesToProcess.length === 0) {
        return;
    }

    // TODO: Upload files in parallel using a worker pool pattern. Upload files
    // sequentially.
    for (const file of filesToProcess) {
        await uploadSingleNotionImportFile(context, {
            spaceId,
            uploaderId,
            diskPathToUnzippedFiles,
            relativeFilePath: file.relativeFilePath,
            fileId: file.fileId,
            contentLength: file.sizeInBytes,
        });
    }
}

/**
 * Uploads a single file from the Notion import to Alpine's file storage and
 * processes it inline using `processFile`.
 *
 * This creates the file record in DynamoDB, uploads to R2, marks the upload
 * complete (without scheduling a file processor job), and then runs the same file
 * processing logic that the file processor service would run. This handles all
 * content types including images, PDFs, videos, audio, code, and MS Office
 * documents.
 *
 * If the file has already been uploaded (fileId exists in DynamoDB), the upload is
 * skipped. This supports resumable imports where a previous attempt may have
 * partially completed.
 */
async function uploadSingleNotionImportFile(
    context: ImporterServiceSystemActionContext,
    {
        spaceId,
        uploaderId,
        diskPathToUnzippedFiles,
        relativeFilePath,
        fileId,
        contentLength,
    }: {
        spaceId: SpaceId;
        uploaderId: AccountId;
        diskPathToUnzippedFiles: string;
        relativeFilePath: string;
        fileId: FileId;
        contentLength: number;
    },
): Promise<void> {
    // Check if the file has already been uploaded (supports resumable imports).
    const existingFile = await getFileIfExistsAsSystem(context, fileId);
    if (existingFile) {
        // File already exists - skip the upload.
        return;
    }

    // Determine content type from file extension. Fall back to
    // application/octet-stream for unknown types.
    const contentType =
        getPathFileContentTypeIfExists(relativeFilePath) ?? "application/octet-stream";

    // Read the file content from disk.
    const fileContent = assertExists(
        await context.importerService.readUnzippedFile({
            diskPathToUnzippedFiles,
            relativeFilePath,
        }),
    );

    // File operations require an account context, so we impersonate the uploader
    // account to perform the upload.
    await impersonateAccountAsSystemContext(context, uploaderId, async impersonatedContext => {
        // Create the file record in DynamoDB. We provide the pre-assigned fileId from
        // reference mapping.
        await startUploadingFile(impersonatedContext, {
            spaceId,
            fileId,
            contentType,
            contentLength,
        });

        // Upload the file content to Cloudflare R2. Skip if using the empty test R2 client
        // (tests without R2 access).
        if (!context.r2.isEmptyForTest()) {
            await context.r2.PutObject({
                Bucket: filesBucketName,
                Key: `${spaceId}/${fileId}`,
                Body: fileContent,
                ContentType: contentType,
                ContentLength: contentLength,
            });
        }

        // Mark upload complete without scheduling a file processor job. We process files
        // inline below instead.
        await finishUploadingAndStartProcessingFile(impersonatedContext, {
            spaceId,
            fileId,
            withoutProcessJob: true,
        });

        // Process the file inline using the same logic as the file processor service. This
        // handles all content types (images, PDFs, videos, audio, code, MS Office
        // documents).
        //
        // If inline processing fails, fall back to scheduling a file processor job so the
        // file can be processed later.
        const {hasAlternative, hasPreview} = fileProcessorDeclarationByContentType[contentType];

        // Skip file processing if
        //
        // 1. the file is invalid (no alternative or preview)
        // 2. the file was actually uploaded to R2 (not true in test)
        if ((!hasAlternative && !hasPreview) || context.r2.isEmptyForTest()) {
            return;
        }

        await context.tracer.withSpan(
            "Process notion import file",
            async (_tracerContext, span) => {
                try {
                    await withTemporaryDirectory(
                        tmpdir(),
                        `notion-import-${fileId}_`,
                        async temporaryDirectoryPath => {
                            await processFile(impersonatedContext, span, {
                                spaceId,
                                fileId,
                                contentType,
                                temporaryDirectoryPath,
                            });
                        },
                    );
                } catch (error) {
                    span.addException(error);

                    // Schedule a file processor job so the file can be processed by the service later.
                    const {jobType, reason} = routeFileToProcessor({
                        contentType,
                        contentLength,
                    });

                    await impersonatedContext.jobs.sendAndWait({
                        type: jobType,
                        spaceId,
                        fileId,
                        contentType,
                        reason,
                    });
                }
            },
        );
    });
}
