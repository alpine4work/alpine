import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {ImporterContextModuleBase} from "~/server/importer/importer_context_module_base.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Cancels a Notion import that hasn't started processing yet.
 *
 * This deletes the import record from DynamoDB and the uploaded zip file from S3.
 * Can only be called by the user who started the import, and only if the import
 * is in a cancellable state (UploadPending, Validating, or Validated).
 */
export async function cancelNotionImport(
    context: ServerSessionActionContext & {importer: ImporterContextModuleBase},
    {spaceId, notionImportId}: {spaceId: SpaceId; notionImportId: NotionImportId},
): Promise<void> {
    await authorizeSpaceAccess(context, spaceId, "Admin");

    const currentAccountId = context.actor.getAccountId();

    const item = await NotionImporterTable.getItemIfExists(context, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId,
    });

    if (!item || item.spaceId !== spaceId) {
        throw new FailedPreconditionError("Import not found");
    }

    // Only the user who started the import can cancel it
    if (item.startedByAccountId !== currentAccountId) {
        throw new FailedPreconditionError("You can only cancel imports you started");
    }

    // Can only cancel imports that haven't started processing
    const isCancellable =
        item.status.type === "UploadPending" ||
        item.status.type === "Validating" ||
        item.status.type === "Validated";

    if (!isCancellable) {
        throw new FailedPreconditionError(
            "Cannot cancel an import that has already started processing",
        );
    }

    await runAllPromises([
        context.importer.deleteUploadedFile(item.importKey),
        NotionImporterTable.deleteItem(context, item),
    ]);
}
