import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {
    NotionImportItem,
    NotionImporterTable,
} from "~/server/importer/notion/internal/notion_importer_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Transitions a Notion import from "Validated" to "ProcessQueued" and queues
 * the import job. Called after the client finishes uploading the zip
 * file to S3.
 */
export async function startNotionImport(
    context: ServerSessionActionContext,
    {
        spaceId,
        notionImportId,
        teamspaceImportOptions,
    }: {
        spaceId: SpaceId;
        notionImportId: NotionImportId;
        teamspaceImportOptions: NotionImportItem["teamspaceImportOptions"];
    },
): Promise<void> {
    await authorizeSpaceAccess(context, spaceId, "Member");

    await NotionImporterTable.updateItem(
        context,
        {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
        item => {
            const existingItem = assertExists(item);

            if (existingItem.status.type !== "Validated") {
                throw new FailedPreconditionError(
                    `Cannot start import with status \u201C${existingItem.status.type}\u201D. ` +
                        `Import must be validated first.`,
                );
            }

            if (existingItem.spaceId !== spaceId) {
                throw new PermissionDeniedError(
                    `You don\u2019t have access to this Notion import.`,
                );
            }

            return {
                ...existingItem,
                status: {type: "ProcessQueued" as const},
                teamspaceImportOptions,
                updatedTime: new Date(),
            };
        },
    );

    context.jobs.send({
        type: "StartNotionImport",
        spaceId,
        notionImportId,
    });
}
