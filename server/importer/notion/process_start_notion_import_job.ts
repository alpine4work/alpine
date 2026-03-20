import {ImporterServiceSystemActionContext} from "~/server/importer/importer_service_context.js";
import {convertExtractedNotionDataToEntities} from "~/server/importer/notion/internal/convert_extracted_notion_data_to_entities.js";
import {normalizeNotionExportDirectory} from "~/server/importer/notion/internal/normalize_notion_export_directory.js";
import {NotionImporterProgressState} from "~/server/importer/notion/internal/notion_importer_progress_state.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {parseNotionImportAndMapReferences} from "~/server/importer/notion/internal/parse_notion_import_and_map_references.js";
import {uploadNotionImportFiles} from "~/server/importer/notion/internal/upload_notion_import_files.js";
import {DataLossError, FailedPreconditionError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
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

                const now = new Date();

                return {
                    ...existingItem,
                    status: {
                        type: "Processing" as const,
                        result: existingItem.status.result,
                    },
                    startedProcessingTime: now,
                    updatedTime: now,
                };
            },
        ),
    );

    assert(importItem.status.type === "Processing");
    const initialResult = importItem.status.result;

    await context.tracer.withSpan("Process notion import", async (_tracerContext, span) => {
        span.addData({importer: {type: "Notion"}});

        // Download and unzip the import file to disk
        let diskPathToUnzippedFiles: string;
        try {
            const result = await context.importerService.downloadAndUnzipImportToDisk({
                importKey: importItem.importKey,
            });
            diskPathToUnzippedFiles = result.diskPathToUnzippedFiles;

            // Normalize Notion's export structure (extract nested zips, flatten Export-xxx
            // dirs)
            await context.tracer.withSpan("Normalize notion export directory", async () => {
                await normalizeNotionExportDirectory(diskPathToUnzippedFiles);
            });
        } catch {
            await NotionImporterTable.updateItem(
                context,
                {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
                item => ({
                    ...assertExists(item),
                    status: {
                        type: "Failed" as const,
                        error: "Import file not found in S3",
                        result: initialResult,
                    },
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

        // Track progress with periodic persistence and update the import status to Success
        // or Failed when done.
        await NotionImporterProgressState.with(
            {notionImportId, context, persistIntervalMs: 1000, initialResult},
            async progressState => {
                // Process in order: light files (parallel), heavy files (sequential), then
                // documents. This ordering optimizes resource usage:
                //
                // 1. Light files (images, small docs) run in parallel with availableParallelism()
                //    concurrency
                // 2. Heavy files (video, audio, large files) run one at a time to avoid CPU
                //    thrashing
                // 3. Documents are created last, after all files are uploaded and processing

                // Phase 1 & 2: Upload files (light in parallel, then heavy sequentially)
                await uploadNotionImportFiles(
                    context,
                    importItem.spaceId,
                    importItem.startedByAccountId,
                    parsedNotionImport,
                    progressState,
                );

                // Phase 3: Create documents (batched 10 at a time)
                await convertExtractedNotionDataToEntities(
                    context,
                    notionImportId,
                    importItem,
                    parsedNotionImport,
                    progressState,
                );
            },
        );
    });
}
