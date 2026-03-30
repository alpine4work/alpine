import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DatabasesRealtimeTable} from "~/server/databases/data/internal/databases_realtime_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {DatabaseModel} from "~/shared/databases/database_model.js";
import {
    DynamoGeneralRealtimeBackfillResult,
    DynamoGeneralRealtimeQueryResult,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {DatabaseId} from "~/shared/id/types/id_types.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

/**
 * Gets database metadata as a realtime query result so the
 * data can be kept up-to-date via the realtime framework.
 */
export async function getDatabaseMetadata(
    context: ServerActionContext,
    databaseId: DatabaseId,
): Promise<DynamoGeneralRealtimeQueryResult<DatabaseModel>> {
    const result = await DatabasesRealtimeTable.realtimeQuery(context, {
        consistency: "Eventual",
        partitionKey: {partitionType: "Database", databaseId},
        paginate: {type: "FromStart", afterItemKey: null},
        limit: 1,
    });

    if (result.items.length === 0) {
        throw new NotFoundError("Database not found");
    }

    await authorizeSpaceAccess(context, result.items[0]!.model.spaceId);

    return result;
}

/**
 * Backfill any realtime updates to catch up our client after
 * it's been disconnected from realtime.
 */
export async function backfillDatabaseMetadata(
    context: ServerActionContext,
    {
        databaseId,
        checkpoint,
    }: {
        databaseId: DatabaseId;
        checkpoint: ServerSynchronizationCheckpoint;
    },
): Promise<DynamoGeneralRealtimeBackfillResult<DatabaseModel>> {
    const [, result] = await runAllPromises([
        (async () => {
            const item = await DatabasesRealtimeTable.getItemIfExists(context, {
                partitionType: "Database",
                sortRangeType: "Attributes",
                databaseId,
            });
            if (item) {
                await authorizeSpaceAccess(context, item.spaceId);
            }
        })(),

        DatabasesRealtimeTable.backfillRealtimeQuery(context, {
            partitionKey: {partitionType: "Database", databaseId},
            checkpoint,
        }),
    ]);

    return result;
}
