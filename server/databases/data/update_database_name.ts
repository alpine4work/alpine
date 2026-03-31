import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DatabasesRealtimeTable} from "~/server/databases/data/internal/databases_realtime_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {DatabaseModel} from "~/shared/databases/database_model.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {DatabaseId, SpaceId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";

export async function updateDatabaseName(
    context: ServerSessionActionContext,
    databaseId: DatabaseId,
    name: string,
): Promise<{
    getDynamoGeneralRealtimeEventTransaction: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<DynamoGeneralRealtimeEvent<DatabaseModel>>>;
}> {
    LabelStringSchema.validate?.(name, {
        errorDisplayMessagePrefix: errorDisplayMessage`The name you typed`,
    });

    let spaceId: SpaceId | null = null;

    const result = await DatabasesRealtimeTable.updateItem(
        context,
        {partitionType: "Database", sortRangeType: "Attributes", databaseId},
        async item => {
            if (!item) throw new NotFoundError("Database not found");
            spaceId = item.spaceId;
            await authorizeSpaceAccess(context, item.spaceId);
            return item.update({name});
        },
    );

    assert(spaceId);

    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId,
        update: {
            type: "Database",
            databaseId,
            updatedTraits: {type: "Some", traits: ["Name"]},
        },
    });

    return {
        getDynamoGeneralRealtimeEventTransaction: async context => [await result.getEvent(context)],
    };
}
