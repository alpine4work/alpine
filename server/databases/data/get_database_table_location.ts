import type {ServerActionContext} from "~/server/context/server_action_context.js";
import {DatabasesRynamo} from "~/server/databases/data/internal/databases_rynamo.js";
import {createDatabaseTableNotFoundError} from "~/shared/databases/database_error_messages.js";
import type {
    DatabaseGroupId,
    DatabaseTableId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";

export async function getDatabaseTableLocation(
    context: ServerActionContext,
    tableId: DatabaseTableId,
): Promise<{databaseGroupId: DatabaseGroupId; spaceId: SpaceId}> {
    let item = await DatabasesRynamo.getItemIfExists(
        context,
        {partitionType: "Table", sortRangeType: "Attributes", tableId},
        {consistency: "Eventual", allowsEventualReadConsistency: true},
    );

    // Location attributes never change. An eventual hit is authoritative, but a miss
    // may be replication lag immediately after creation and needs a strong retry.
    if (item === null) {
        item = await DatabasesRynamo.getItemIfExists(
            context,
            {partitionType: "Table", sortRangeType: "Attributes", tableId},
            {consistency: "Strong"},
        );

        if (item === null) {
            throw createDatabaseTableNotFoundError(tableId);
        }
    }

    return {
        databaseGroupId: item.databaseGroupId,
        spaceId: item.spaceId,
    };
}
