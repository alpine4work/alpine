import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {ImporterContextModuleBase} from "~/server/importer/importer_context_module_base.js";
import {findNotionImportRoot} from "~/server/importer/notion/internal/find_notion_import_root.js";
import {getNotionImportMetadata} from "~/server/importer/notion/internal/get_notion_import_metadata.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {ValidateNotionImportAndExtractMetadataJobDescription} from "~/server/jobs/core/job_description.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {NotionImportTeamspaceOptions} from "~/shared/importer/notion/notion_import_item.js";

/**
 * Validates a Notion import by downloading the uploaded zip, checking for
 * a valid Notion export structure (index.html), and extracting metadata
 * (workspace name and teamspaces).
 *
 * If valid: Updates the import item with workspace name and teamspace options,
 * sets status to "Validated".
 *
 * If invalid: Sets status to "Failed" and deletes the uploaded file.
 */
export async function processValidateNotionImportAndExtractMetadataJob(
    context: ServerSystemActionContext & {importer: ImporterContextModuleBase},
    job: ValidateNotionImportAndExtractMetadataJobDescription,
): Promise<void> {
    const {notionImportId} = job;

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
    const data = await context.importer.readUploadedFile(importItem.importKey);

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

    // Extract metadata (workspace name & teamspaces)
    const metadata = getNotionImportMetadata(rawFiles);
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
                status: {type: "Validated"},
                updatedTime: new Date(),
            };
        },
    );
}

async function markImportFailed(
    context: ServerSystemActionContext,
    notionImportId: ValidateNotionImportAndExtractMetadataJobDescription["notionImportId"],
    error: string,
): Promise<void> {
    await NotionImporterTable.updateItem(
        context,
        {partitionType: "Import", sortRangeType: "Attributes", notionImportId},
        item => ({
            ...assertExists(item),
            status: {type: "Failed", error},
            updatedTime: new Date(),
        }),
    );
}
