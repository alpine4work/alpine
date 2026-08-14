import {ImporterServiceSystemActionContext} from "~/server/importer/importer_service_context.js";
import {buildSiteFileSpanData} from "~/server/importer/notion/internal/build_site_file_span_data.js";
import {computeNotionImportExpectedStatistics} from "~/server/importer/notion/internal/compute_notion_import_expected_statistics.js";
import {getNotionImportMetadata} from "~/server/importer/notion/internal/get_notion_import_metadata.js";
import {normalizeNotionExportDirectory} from "~/server/importer/notion/internal/normalize_notion_export_directory.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {NotionImportId} from "~/shared/id/types/id_types.js";
import {NotionImportTeamspaceOptions} from "~/shared/importer/notion/notion_import_item.js";

/**
 * Validates a Notion import by downloading the uploaded zip, checking for a valid
 * Notion export structure (index.html), and extracting metadata (workspace name
 * and teamspaces).
 *
 * If valid: Updates the import item with workspace name and teamspace options,
 * sets status to "Validated".
 *
 * If invalid: Sets status to "Failed" and deletes the uploaded file.
 */
export async function processValidateNotionImportAndExtractMetadataJob(
    context: ImporterServiceSystemActionContext,
    notionImportId: NotionImportId,
): Promise<void> {
    await context.tracer.withSpan("Validate notion import", async (_tracerContext, span) => {
        span.addData({importer: {type: "Notion"}});
        // Update the import item to "Validating" status
        const updatedImportItem = await NotionImporterTable.updateItem(
            context,
            {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
            item => {
                const existingItem = assertExists(item);

                if (existingItem.status.type !== "ValidateQueued") {
                    throw new FailedPreconditionError(
                        "Status is not in the correct state for validation",
                    );
                }

                return {
                    ...existingItem,
                    status: {type: "Validating"},
                    updatedTime: new Date(),
                };
            },
        );

        const importItem = assertExists(updatedImportItem);

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
            await markImportFailed(context, notionImportId, "Import file not found");
            return;
        }

        // List all files in the unzipped export
        const filePaths = await context.importerService.listUnzippedFiles({
            diskPathToUnzippedFiles,
        });

        // Find index.html
        const indexHtmlPath = filePaths.find(
            path => path === "index.html" || path.endsWith("/index.html"),
        );
        if (!indexHtmlPath) {
            await markImportFailed(
                context,
                notionImportId,
                "Invalid Notion export: no index.html found",
            );
            return;
        }

        // Read index.html from disk
        const indexHtmlContent = await context.importerService.readUnzippedFile({
            diskPathToUnzippedFiles,
            relativeFilePath: indexHtmlPath,
        });
        if (!indexHtmlContent) {
            await markImportFailed(
                context,
                notionImportId,
                "Invalid Notion export: no index.html found",
            );
            return;
        }

        // Extract metadata (workspace name & teamspaces)
        const metadata = getNotionImportMetadata(indexHtmlContent);
        if (!metadata) {
            await markImportFailed(
                context,
                notionImportId,
                "Invalid Notion export: could not extract workspace name",
            );
            return;
        }

        // If no teamspaces were detected, create one using the workspace name
        const teamspaceNameById =
            metadata.teamspaceNameById.size > 0
                ? metadata.teamspaceNameById
                : new Map([["default", metadata.workspaceName]]);

        // Build teamspace import options with smart defaults:
        //
        // - If the teamspace name contains "private" or "shared", default to Private
        //   (Notion often has these teamspaces by default that are only visible to you.
        //   "Shared" does not mean global, so keep them private.)
        // - Otherwise, default to Public
        const teamspaceImportOptions: NotionImportTeamspaceOptions = [
            ...teamspaceNameById.entries(),
        ].map(([id, name]) => {
            const lowerName = name.toLowerCase();
            const shouldBePrivate = lowerName.includes("private") || lowerName.includes("shared");

            return {
                teamspaceId: id,
                teamspaceName: name,
                option: {type: shouldBePrivate ? "Private" : "Public"},
            };
        });

        // Compute expected counts and file sizes per teamspace by scanning the unzipped
        // files on disk. This gives users an estimate of the import scope before they
        // confirm.
        const result = await computeNotionImportExpectedStatistics({
            readFile: relativePath =>
                context.importerService.readUnzippedFile({
                    diskPathToUnzippedFiles,
                    relativeFilePath: relativePath,
                }),
            diskPathToUnzippedFiles,
            filePaths,
            indexHtmlContent,
            teamspaceNameById,
            workspaceId: metadata.workspaceId,
        });

        // Emit per-teamspace validation spans with file metrics.
        for (const [teamspaceId, stats] of result.teamspaces) {
            context.tracer.withSpanSync("Validate notion import site", (_tracerContext, span) => {
                span.addData({
                    importer: {
                        site: {notionId: teamspaceId},
                        created: {documents: stats.documents.expectedCount},
                        uploaded: buildSiteFileSpanData(stats.files),
                    },
                });
            });
        }

        // Update the import item with extracted metadata
        await NotionImporterTable.updateItem(
            context,
            {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
            item => {
                // The import may have been cancelled while validation was running. If the item no
                // longer exists, exit gracefully instead of throwing.
                if (!item) return null;

                if (item.status.type !== "Validating") {
                    throw new FailedPreconditionError(
                        "Status is not in the correct state for validation",
                    );
                }

                return {
                    ...item,
                    workspaceName: metadata.workspaceName,
                    teamspaceImportOptions,
                    status: {type: "Validated", result},
                    updatedTime: new Date(),
                };
            },
        );
    });
}

async function markImportFailed(
    context: ImporterServiceSystemActionContext,
    notionImportId: NotionImportId,
    error: string,
): Promise<void> {
    await NotionImporterTable.updateItem(
        context,
        {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
        item => {
            const existingItem = assertExists(item);

            const result =
                "result" in existingItem.status
                    ? existingItem.status.result
                    : {teamspaces: new Map()};

            return {
                ...existingItem,
                status: {type: "Failed" as const, error, result},
                updatedTime: new Date(),
            };
        },
    );
}
