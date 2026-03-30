import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {createImportUploadKey} from "~/server/importer/import_upload_key.js";
import {ImporterContextModuleBase} from "~/server/importer/importer_context_module_base.js";
import {
    NotionImportItem,
    NotionImporterTable,
} from "~/server/importer/notion/internal/notion_importer_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {importMultipartUploadPartSize} from "~/shared/files/file_constants.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {generateId} from "~/shared/id/id.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Creates a new Notion import record and initiates a multipart upload for the
 * client to upload the zip file directly to S3.
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
): Promise<{
    notionImportId: NotionImportId;
    uploadId: string;
    partUploadUrls: Array<{partNumber: number; presignedUrl: string}>;
    importKey: string;
}> {
    await authorizeSpaceAccess(context, spaceId, "Member");

    const notionImportId = generateId<NotionImportId>();
    const importKey = createImportUploadKey({spaceId, type: "notion", importId: notionImportId});

    const {uploadId} = await context.importer.createMultipartUpload({
        importKey,
        contentType,
        contentLength,
    });

    const partCount = Math.ceil(contentLength / importMultipartUploadPartSize);
    const [partUploadUrls] = await runAllPromises([
        context.importer.createPresignedPartUploadUrls({
            importKey,
            uploadId,
            partCount,
        }),
        (async () => {
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
                startedProcessingTime: null,
                startedValidatingTime: null,
                teamspaceImportOptions: null,
                multipartUploadId: uploadId,
                status: {type: "UploadPending"},
                importedCount: 0,
            };

            await NotionImporterTable.createItem(context, importItem);
        })(),
    ]);

    return {notionImportId, uploadId, partUploadUrls, importKey};
}
