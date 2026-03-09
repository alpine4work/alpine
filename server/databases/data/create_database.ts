import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {
    DatabaseAttributesItem,
    DatabasesRealtimeTable,
} from "~/server/databases/data/internal/databases_realtime_table.js";
import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {generateId} from "~/shared/id/id.js";
import {DatabaseId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Create a new database.
 */
export async function createDatabase(
    context: ServerSessionActionContext,
    {
        spaceId,
        databaseId = generateId<DatabaseId>(),
        name,
    }: {
        spaceId: SpaceId;
        databaseId?: DatabaseId;
        name: string;
    },
): Promise<{
    id: DatabaseId;
    createdTime: Date;
}> {
    await authorizeSpaceAccess(context, spaceId);

    const creatorId = context.actor.getAccountId();

    const databaseItem: DatabaseAttributesItem = {
        partitionType: "Database",
        sortRangeType: "Attributes",
        databaseId,
        spaceId,
        createdTime: new Date(),
        creatorId,
        name,
    };

    const {transactionEntry} = DatabasesRealtimeTable.transactionCreateItemWithEvent(databaseItem);

    await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [transactionEntry]);

    return {
        id: databaseItem.databaseId,
        createdTime: databaseItem.createdTime,
    };
}
