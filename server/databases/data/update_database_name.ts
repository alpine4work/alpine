import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DatabasesRealtimeTable} from "~/server/databases/data/internal/databases_realtime_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {DatabaseModel} from "~/shared/databases/database_model.js";
import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {DatabaseId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";

export async function updateDatabaseName(
    context: ServerSessionActionContext,
    databaseId: DatabaseId,
    name: string,
): Promise<DatabaseModel> {
    LabelStringSchema.validate?.(name, {
        errorDisplayMessagePrefix: errorDisplayMessage`The name you typed`,
    });

    const item = await DatabasesRealtimeTable.getItemIfExists(context, {
        partitionType: "Database",
        sortRangeType: "Attributes",
        databaseId,
    });

    if (!item) {
        throw new NotFoundError("Database not found");
    }

    await authorizeSpaceAccess(context, item.spaceId);

    await DatabasesRealtimeTable.directlyUpdateItem(context, item.update({name}));

    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId: item.spaceId,
        update: {
            type: "Database",
            databaseId,
            updatedTraits: {type: "Some", traits: ["Name"]},
        },
    });

    return new DatabaseModel({
        id: item.databaseId,
        spaceId: item.spaceId,
        version: (item.updateLockVersion ?? 0) + 1,
        createdTime: item.createdTime,
        name,
    });
}
