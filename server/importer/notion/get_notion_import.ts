import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {
    NotionImportItem,
    NotionImporterTable,
    SpaceNotionImportsIndex,
} from "~/server/importer/notion/internal/notion_importer_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Get a single Notion import by ID.
 *
 * Only admins and owners can view imports.
 */
export async function getNotionImport(
    context: ServerActionContext,
    {spaceId, notionImportId}: {spaceId: SpaceId; notionImportId: NotionImportId},
): Promise<NotionImportItem | null> {
    await authorizeSpaceAccess(context, spaceId, "Admin");

    const item = await NotionImporterTable.getItemIfExists(context, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId,
    });

    if (!item || item.spaceId !== spaceId) {
        return null;
    }

    return item;
}

/**
 * Get all Notion imports for a space.
 *
 * Only admins and owners can view imports.
 *
 * Filters out in-progress imports (not Success or Failed) that were started by
 * other users. This prevents users from seeing each other's in-progress imports
 * while still showing their own and all completed/failed imports.
 */
export async function getAllNotionImportsForSpace(
    context: ServerSessionActionContext,
    {spaceId}: {spaceId: SpaceId},
): Promise<Array<NotionImportItem>> {
    await authorizeSpaceAccess(context, spaceId, "Admin");

    const currentAccountId = context.actor.getAccountId();

    // Query the index to get the keys
    const indexItems = await arrayFromAsyncIterable(
        SpaceNotionImportsIndex.query(context, {
            partitionKey: {spaceId},
            limit: "All",
        }),
    );

    // Fetch full items from the main table
    const items = await runAllPromises(
        indexItems.map(indexItem =>
            NotionImporterTable.getItemIfExists(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId: indexItem.notionImportId,
            }),
        ),
    );

    // Filter out in-progress imports from other users
    return items.filter(isNonNullable).filter(item => {
        const isFinished = item.status.type === "Success" || item.status.type === "Failed";
        const isOwnImport = item.startedByAccountId === currentAccountId;
        return isFinished || isOwnImport;
    });
}
