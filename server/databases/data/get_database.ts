import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DatabasesRealtimeTable} from "~/server/databases/data/internal/databases_realtime_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {DatabaseModel} from "~/shared/databases/database_model.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {NotFoundError} from "~/shared/error/error.js";
import {DatabaseId} from "~/shared/id/types/id_types.js";

/**
 * Gets the database metadata with the provided `DatabaseId`.
 * Throws if the database doesn't exist or the caller doesn't
 * have access to its space.
 */
export async function getDatabase(
    context: ServerActionContext,
    databaseId: DatabaseId,
): Promise<DynamoGeneralRealtimeItem<DatabaseModel>> {
    const result = (await DatabasesRealtimeTable.getRealtimeItemIfExists(
        context,
        {
            partitionType: "Database",
            sortRangeType: "Attributes",
            databaseId,
        },
        {consistency: "Eventual"},
    )) as DynamoGeneralRealtimeItem<DatabaseModel> | null;

    if (!result) {
        throw new NotFoundError("Database not found");
    }

    await authorizeSpaceAccess(context, result.model.spaceId);

    return result;
}
