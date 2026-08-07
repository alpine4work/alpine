import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {createImportUploadKey} from "~/server/importer/import_upload_key.js";
import {ImporterContextModuleBase} from "~/server/importer/importer_context_module_base.js";
import {getAllNotionImportsForSpace} from "~/server/importer/notion/get_notion_import.js";
import {
    NotionImportItem,
    NotionImporterTable,
} from "~/server/importer/notion/internal/notion_importer_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {importMultipartUploadPartSize} from "~/shared/files/file_constants.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {notionImportMaxZipSize} from "~/shared/importer/notion/notion_import_max_zip_size.js";

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

    if (contentLength > notionImportMaxZipSize) {
        throw new FailedPreconditionError(
            `Couldn\u2019t import Notion data. The selected file is too large.`,
            {
                displayMessage: errorDisplayMessage`Couldn\u2019t import Notion data. The selected file is too large.`,
            },
        );
    }

    const currentAccountId = context.actor.getAccountId();
    const existingImports = await getAllNotionImportsForSpace(context, {spaceId});
    const preProcessingImport = existingImports.find(item => {
        if (item.startedByAccountId !== currentAccountId) return false;
        const status = item.status.type;
        return (
            status === "UploadPending" ||
            status === "ValidateQueued" ||
            status === "Validating" ||
            status === "Validated"
        );
    });

    if (preProcessingImport) {
        throw new FailedPreconditionError(
            `Can\u2019t create import. You already have an import that hasn\u2019t started processing yet.`,
            {
                displayMessage: errorDisplayMessage`Can\u2019t create import. You already have an import that hasn\u2019t started processing yet.`,
            },
        );
    }

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
