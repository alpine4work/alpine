import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {createImportUploadKey} from "~/server/importer/import_upload_key.js";
import {ImporterContextModuleBase} from "~/server/importer/importer_context_module_base.js";
import {
    NotionImportItem,
    NotionImporterTable,
} from "~/server/importer/notion/internal/notion_importer_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {generateId} from "~/shared/id/id.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Creates a new Notion import record and generates a presigned S3 PutObject URL
 * for the client to upload the zip file directly.
 */
export async function createNotionImport(
    context: ServerSessionActionContext & {importer: ImporterContextModuleBase},
    {
        spaceId,
        contentType,
        contentLength,
    }: {
        spaceId: SpaceId;
        contentType: string;
        contentLength: number;
    },
): Promise<{notionImportId: NotionImportId; presignedUploadUrl: string; importKey: string}> {
    await authorizeSpaceAccess(context, spaceId, "Member");

    const notionImportId = generateId<NotionImportId>();
    const importKey = createImportUploadKey({spaceId, type: "notion", importId: notionImportId});

    const currentTime = new Date();
    const importItem: NotionImportItem = {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId,
        spaceId,
        importKey,
        importZipSize: contentLength,
        startedByAccountId: context.actor.getAccountId(),
        createdTime: currentTime,
        updatedTime: currentTime,
        workspaceName: null,
        teamspaceImportOptions: null,
        status: {type: "UploadPending"},
        importedCount: 0,
    };

    const [{presignedUploadUrl}] = await runAllPromises([
        context.importer.createPresignedUploadUrl({
            importKey,
            contentType,
            contentLength,
        }),
        NotionImporterTable.createItem(context, importItem),
    ]);

    return {notionImportId, presignedUploadUrl, importKey};
}
