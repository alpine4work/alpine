import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {ImporterContextModuleBase} from "~/server/importer/importer_context_module_base.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";

/** Number of days that import files are retained before being deleted. */
const fileRetentionDays = 7;

/**
 * Retries a failed Notion import by re-queueing it for processing.
 *
 * This can only be called on imports that:
 *
 * 1. Have status "Failed"
 * 2. Were created within the last 7 days (file retention period)
 *
 * The import will be transitioned back to "ProcessQueued" status and the import
 * job will be started again.
 */
export async function retryNotionImport(
    context: ServerSessionActionContext & {importer: ImporterContextModuleBase},
    {spaceId, notionImportId}: {spaceId: SpaceId; notionImportId: NotionImportId},
): Promise<void> {
    await authorizeSpaceAccess(context, spaceId, "Member");

    const now = new Date();
    const retentionCutoff = new Date(now.getTime() - fileRetentionDays * 24 * 60 * 60 * 1000);

    const updatedItem = assertExists(
        await NotionImporterTable.updateItem(
            context,
            {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
            item => {
                const existingItem = assertExists(item);

                if (existingItem.spaceId !== spaceId) {
                    throw new PermissionDeniedError(
                        `You don\u2019t have access to this Notion import.`,
                    );
                }

                if (existingItem.status.type !== "Failed") {
                    throw new FailedPreconditionError(
                        `Cannot retry import with status \u201C${existingItem.status.type}\u201D. ` +
                            `Only failed imports can be retried.`,
                    );
                }

                if (existingItem.createdTime < retentionCutoff) {
                    throw new FailedPreconditionError(
                        `Cannot retry import. The uploaded file has been deleted after ` +
                            `${fileRetentionDays} days. Please upload a new file.`,
                    );
                }

                return {
                    ...existingItem,
                    status: {type: "ProcessQueued" as const},
                    updatedTime: now,
                };
            },
        ),
    );

    // Start the import process. In development, this runs directly in the current
    // process. In production, this spawns an ECS task.
    await context.importer.startNotionImport({
        spaceId,
        notionImportId,
        importZipSize: updatedItem.importZipSize,
    });
}
