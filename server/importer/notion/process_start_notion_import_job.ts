import {ImporterServiceSystemActionContext} from "~/server/importer/importer_service_context.js";
import {convertExtractedNotionDataToEntities} from "~/server/importer/notion/internal/convert_extracted_notion_data_to_entities.js";
import {normalizeNotionExportDirectory} from "~/server/importer/notion/internal/normalize_notion_export_directory.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {parseNotionImportAndMapReferences} from "~/server/importer/notion/internal/parse_notion_import_and_map_references.js";
import {DataLossError, FailedPreconditionError} from "~/shared/error/error.js";
// TODO: Re-enable when file attachments are implemented import {runAllPromises}
// from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {NotionImportId} from "~/shared/id/types/id_types.js";

/**
 * Processes the actual Notion import. Fetches the uploaded zip file and imports
 * its contents into the space. Called after validation has completed and the user
 * has confirmed import options.
 */
export async function processStartNotionImportJob(
    context: ImporterServiceSystemActionContext,
    notionImportId: NotionImportId,
): Promise<void> {
    // Transition from ProcessQueued to Processing
    const importItem = assertExists(
        await NotionImporterTable.updateItem(
            context,
            {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
            item => {
                const existingItem = assertExists(item);

                if (existingItem.status.type !== "ProcessQueued") {
                    throw new FailedPreconditionError(
                        "Status is not in the correct state for processing",
                    );
                }

                return {
                    ...existingItem,
                    status: {type: "Processing" as const},
                    updatedTime: new Date(),
                };
            },
        ),
    );

    // Download and unzip the import file to disk
    let diskPathToUnzippedFiles: string;
    try {
        const result = await context.importerService.downloadAndUnzipImportToDisk({
            importKey: importItem.importKey,
        });
        diskPathToUnzippedFiles = result.diskPathToUnzippedFiles;

        // Normalize Notion's export structure (extract nested zips, flatten Export-xxx
        // dirs)
        await normalizeNotionExportDirectory(diskPathToUnzippedFiles);
    } catch {
        await NotionImporterTable.updateItem(
            context,
            {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
            item => ({
                ...assertExists(item),
                status: {type: "Failed" as const, error: "Import file not found in S3"},
                updatedTime: new Date(),
            }),
        );

        throw new DataLossError("Notion import file not found in S3");
    }

    const parsedNotionImport = await parseNotionImportAndMapReferences(
        context,
        diskPathToUnzippedFiles,
        importItem,
    );

    if (!parsedNotionImport) {
        throw new DataLossError(
            "Failed to parse Notion export: invalid zip structure or missing workspace metadata",
        );
    }

    try {
        // Create documents for the import. TODO: File uploads are disabled until file
        // attachment logic is added. The uploadNotionImportFiles function uploads files to
        // R2 and creates file records, but files must also be attached to their parent
        // documents for users to access them. Without attachments, getFileSignedUrl throws
        // "File isn't attached to target". Once attachment logic is added, enable:
        //
        // await runAllPromises([ uploadNotionImportFiles( context, importItem.spaceId,
        // importItem.startedByAccountId, parsedNotionImport, ),
        // convertExtractedNotionDataToEntities( context, notionImportId, importItem,
        // parsedNotionImport, ), ]);
        await convertExtractedNotionDataToEntities(
            context,
            notionImportId,
            importItem,
            parsedNotionImport,
        );

        await NotionImporterTable.updateItem(
            context,
            {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
            item => ({
                ...assertExists(item),
                status: {type: "Success" as const},
                updatedTime: new Date(),
            }),
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error during import";

        await NotionImporterTable.updateItem(
            context,
            {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
            item => ({
                ...assertExists(item),
                status: {type: "Failed" as const, error: errorMessage},
                updatedTime: new Date(),
            }),
        );

        throw error;
    }
}
