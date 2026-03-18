import {ImporterServiceSystemActionContext} from "~/server/importer/importer_service_context.js";
import {computeNotionImportExpectedStatistics} from "~/server/importer/notion/internal/compute_notion_import_expected_statistics.js";
import {findNotionImportRoot} from "~/server/importer/notion/internal/find_notion_import_root.js";
import {getNotionImportMetadata} from "~/server/importer/notion/internal/get_notion_import_metadata.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
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

    // Read the uploaded file
    const data = await context.importerService.readUploadedFile(importItem.importKey);

    if (!data) {
        await markImportFailed(context, notionImportId, "Import file not found");
        return;
    }

    // Find the Notion export root (handles nested zips)
    const rawFiles = findNotionImportRoot(data);
    if (!rawFiles) {
        await markImportFailed(
            context,
            notionImportId,
            "Invalid Notion export: no index.html found",
        );
        return;
    }

    // Find and extract index.html content
    const indexHtmlKey = Object.keys(rawFiles).find(
        key => key.endsWith("/index.html") || key === "index.html",
    );
    if (!indexHtmlKey) {
        await markImportFailed(
            context,
            notionImportId,
            "Invalid Notion export: no index.html found",
        );
        return;
    }
    const indexHtmlContent = rawFiles[indexHtmlKey]!;

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

    // Compute expected counts and file sizes per teamspace by scanning the zip
    // contents. This gives users an estimate of the import scope before they confirm.
    const result = computeNotionImportExpectedStatistics(
        rawFiles,
        indexHtmlContent,
        teamspaceNameById,
        metadata.workspaceId,
    );

    // Update the import item with extracted metadata
    await NotionImporterTable.updateItem(
        context,
        {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
        item => {
            const existingItem = assertExists(item);

            if (existingItem.status.type !== "Validating") {
                throw new FailedPreconditionError(
                    "Status is not in the correct state for validation",
                );
            }

            return {
                ...existingItem,
                workspaceName: metadata.workspaceName,
                teamspaceImportOptions,
                status: {type: "Validated", result},
                updatedTime: new Date(),
            };
        },
    );
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
