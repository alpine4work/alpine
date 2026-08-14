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
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.open_source.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {NotionImportId} from "~/shared/id/types/id_types.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get a single Notion import by ID.
 */
export async function getNotionImport(
    context: ServerActionContext,
    {spaceId, notionImportId}: {spaceId: SpaceId; notionImportId: NotionImportId},
): Promise<NotionImportItem | null> {
    await authorizeSpaceAccess(context, spaceId, "Member");

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
 * Filters out imports that haven't queued processing yet from other users. Once an
 * import reaches ProcessQueued or later, all space members can see it. This
 * prevents users from seeing each other's uploads/validations while still showing
 * all imports that are queued, processing, or done.
 */
export async function getAllNotionImportsForSpace(
    context: ServerSessionActionContext,
    {spaceId}: {spaceId: SpaceId},
): Promise<Array<NotionImportItem>> {
    await authorizeSpaceAccess(context, spaceId, "Member");

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

    // Filter out imports that haven't queued processing yet from other users. Once
    // processing is queued, all space members can see the import.
    return items.filter(isNonNullable).filter(item => {
        const isOwnImport = item.startedByAccountId === currentAccountId;
        if (isOwnImport) return true;

        const status = item.status.type;
        return (
            status === "ProcessQueued" ||
            status === "Processing" ||
            status === "Success" ||
            status === "Failed"
        );
    });
}
