import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {DatabasesRealtimeTable} from "~/server/databases/data/internal/databases_realtime_table.js";
import {DatabaseModel} from "~/shared/databases/database_model.js";
import {DatabaseId} from "~/shared/id/types/id_types.js";

/**
 * Gets the database metadata as a system actor, without
 * authorization checks. Returns `null` if the database
 * doesn't exist.
 */
export async function getDatabaseIfExistsAsSystem(
    context: ServerSystemActionContext,
    databaseId: DatabaseId,
): Promise<DatabaseModel | null> {
    context.actor.authorizeSystem();

    const result = await DatabasesRealtimeTable.getRealtimeItemIfExists(
        context,
        {
            partitionType: "Database",
            sortRangeType: "Attributes",
            databaseId,
        },
        {consistency: "Strong"},
    );

    if (!result) return null;

    return result.model as DatabaseModel;
}
