import type {ServerActionContext} from "~/server/context/server_action_context.js";
import {DatabaseTablesTable} from "~/server/databases/data/internal/database_tables_table.js";
import {NotFoundError} from "~/shared/error/error.js";
import type {DatabaseGroupId, DatabaseTableId, SpaceId} from "~/shared/id/types/id_types.js";

export async function getDatabaseTableLocation(
    context: ServerActionContext,
    tableId: DatabaseTableId,
): Promise<{databaseGroupId: DatabaseGroupId; spaceId: SpaceId}> {
    const item = await DatabaseTablesTable.getItemIfExists(
        context,
        {partitionType: "Table", sortRangeType: "Attributes", tableId},
        {consistency: "Strong"},
    );

    if (item === null) {
        throw new NotFoundError(`Database table ${tableId} not found`);
    }

    return {
        databaseGroupId: item.databaseGroupId,
        spaceId: item.spaceId,
    };
}
