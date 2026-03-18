/**
 * Uploads a single file from a Notion import to Alpine's file storage.
 *
 * This module handles the complete upload workflow for a single file:
 *
 * 1. Check if already uploaded (skip if exists)
 * 2. Create file record in DynamoDB
 * 3. Upload to Cloudflare R2
 * 4. Mark upload complete (without scheduling a processor job)
 * 5. Process the file inline using `processFile`
 * 6. If inline processing fails, fall back to scheduling a job
 */

import {tmpdir} from "os";
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
import {NotionImporterProgressState} from "~/server/importer/notion/internal/notion_importer_progress_state.js";
import {impersonateAccountAsSystemContext} from "~/server/spaces/impersonate_account_as_system_context.js";
import {FileContentType, getPathFileContentTypeIfExists} from "~/shared/files/file_content_type.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {AccountId, FileId, SpaceId} from "~/shared/id/types/id_types.js";

export interface NotionImportUploadSingleFileOptions {
    spaceId: SpaceId;
    uploaderId: AccountId;
    diskPathToUnzippedFiles: string;
    relativeFilePath: string;
    fileId: FileId;
    contentLength: number;
    contentType: FileContentType;
    teamspaceId: string;
    progressState: NotionImporterProgressState;
}

/**
 * Uploads a single file from the Notion import to Alpine's file storage.
 *
 * This creates the file record in DynamoDB, uploads to R2, and triggers file
 * processing for previews and alternatives.
 *
 * If the file has already been uploaded (fileId exists in DynamoDB), the upload is
 * skipped. This supports resumable imports where a previous attempt may have
 * partially completed.
 */
export async function uploadFileForNotionImport(
    context: ImporterServiceSystemActionContext,
    options: NotionImportUploadSingleFileOptions,
): Promise<void> {
    const {
        spaceId,
        uploaderId,
        diskPathToUnzippedFiles,
        relativeFilePath,
        fileId,
        contentLength,
        contentType: contentTypeFromCaller,
        teamspaceId,
        progressState,
    } = options;

    // Check if the file has already been uploaded (supports resumable imports).
    const existingFile = await getFileIfExistsAsSystem(context, fileId);
    if (existingFile) {
        // File already exists - skip the upload but still count it.
        progressState.incrementFileCounter(teamspaceId, contentTypeFromCaller);
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

    // Increment the file counter for this mimetype
    progressState.incrementFileCounter(teamspaceId, contentTypeFromCaller);
}
