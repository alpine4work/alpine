import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {ImporterContextModuleBase} from "~/server/importer/importer_context_module_base.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {NotionImportId} from "~/shared/id/types/id_types.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Called by the client after the file upload to S3/local storage completes.
 *
 * This function:
 *
 * 1. Verifies the import exists and is in the correct state (UploadPending)
 * 2. Completes the S3 multipart upload (assembles all parts into final object)
 * 3. Verifies the uploaded file exists in storage
 * 4. Transitions the import to Validating status
 * 5. Queues the validation job to extract metadata from the uploaded zip
 *
 * ## Why use an RPC instead of S3 event notifications?
 *
 * Previously, we used S3 event notifications to trigger a Lambda function that
 * would queue the validation job. This had several downsides:
 *
 * - **Complexity**: Required Lambda infrastructure, IAM permissions, and S3 bucket
 *   notification configuration
 * - **Development friction**: Needed a separate dev endpoint to mimic the S3 ->
 *   Lambda flow locally
 * - **Debugging**: Harder to trace issues across the async Lambda boundary
 * - **Timing**: S3 notifications can be delayed; RPC gives immediate feedback
 *
 * With this RPC approach:
 *
 * - Same code path runs in dev and production
 * - Client controls exactly when validation starts (after upload completes)
 * - Full observability in the main request tracing
 * - Simpler infrastructure (no Lambda, no S3 notifications)
 */
export async function finishedNotionImportUpload(
    context: ServerSessionActionContext & {importer: ImporterContextModuleBase},
    {
        spaceId,
        notionImportId,
        uploadId,
        parts,
    }: {
        spaceId: SpaceId;
        notionImportId: NotionImportId;
        uploadId: string;
        parts: ReadonlyArray<{partNumber: number; etag: string}>;
    },
): Promise<void> {
    await authorizeSpaceAccess(context, spaceId, "Member");

    // First, get the import to check its state and get the import key.
    const importItem = await NotionImporterTable.getItem(context, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId,
    });

    if (importItem.spaceId !== spaceId) {
        throw new InvalidArgumentError(
            `Notion import ${notionImportId} does not belong to space ${spaceId}`,
        );
    }

    // If already past UploadPending, the file check and job queue already happened.
    if (importItem.status.type !== "UploadPending") {
        throw new FailedPreconditionError("Status is not in the correct state for processing");
    }

    // Complete the multipart upload to assemble all parts into the final object.
    const importKey = assertExists(importItem.importKey);
    await context.importer.completeMultipartUpload({importKey, uploadId, parts});

    // Verify the uploaded file exists before transitioning status.
    const fileExists = await context.importer.hasUploadedFile(importKey);
    if (!fileExists) {
        throw new InvalidArgumentError(`Uploaded file not found for import ${notionImportId}`);
    }

    const startedValidatingTime = new Date();

    await NotionImporterTable.updateItem(
        context,
        {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
        item => ({
            ...assertExists(item),
            status: {type: "ValidateQueued"},
            updatedTime: startedValidatingTime,
            startedValidatingTime,
            multipartUploadId: null,
        }),
    );

    // Start the validation process. In development, this runs directly in the current
    // process. In production, this spawns an ECS task.
    await context.importer.startValidateNotionImport({
        spaceId,
        notionImportId,
        importZipSize: importItem.importZipSize,
    });
}
