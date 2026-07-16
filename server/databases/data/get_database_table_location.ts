import type {ServerActionContext} from "~/server/context/server_action_context.js";
import {DatabaseTableIdsIndex} from "~/server/databases/data/internal/database_tables_table.js";
import {NotFoundError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import type {DatabaseGroupId, DatabaseTableId, SpaceId} from "~/shared/id/types/id_types.js";

export async function getDatabaseTableLocation(
    context: ServerActionContext,
    tableId: DatabaseTableId,
): Promise<{databaseGroupId: DatabaseGroupId; spaceId: SpaceId}> {
    const items = await DatabaseTableIdsIndex.query(context, {
        partitionKey: {tableId},
        limit: 2,
        consistency: "Strong",
    });

    if (items.length === 0) {
        throw new NotFoundError(`Database table ${tableId} not found`);
    }
    assert(items.length === 1, `Database table ${tableId} belongs to multiple database groups`);

    const item = items[0]!;
    return {
        databaseGroupId: item.databaseGroupId,
        spaceId: assertExists(item.spaceId),
    };
}
