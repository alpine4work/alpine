import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DatabasesRealtimeTable} from "~/server/databases/data/internal/databases_realtime_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {DynamoGeneralRealtimeDatabaseEvent} from "~/shared/databases/database_realtime_protocol.js";
import {DynamoGeneralRealtimeEventStub} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {DatabaseId} from "~/shared/id/types/id_types.js";

/**
 * Converts realtime event stubs into full realtime event
 * objects for a database. Authorizes that the caller has
 * access to the database's space.
 */
export async function getDatabaseRealtimeEvent(
    context: ServerSessionActionContext,
    databaseId: DatabaseId,
    eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEventStub>,
): Promise<ReadonlyArray<DynamoGeneralRealtimeDatabaseEvent>> {
    const [, actualEventTransaction] = await runAllPromises([
        // Authorize in parallel with the DynamoDB reads from
        // `getRealtimeEvent()`.
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

        DatabasesRealtimeTable.getRealtimeEvent(
            context,
            eventTransaction.map(eventStub => {
                const itemKey = DatabasesRealtimeTable.deserializeOpaqueItemKey(eventStub.item.key);

                if (itemKey.partitionType === "Database" && itemKey.databaseId === databaseId) {
                    return {...eventStub, itemKey};
                }

                throw new PermissionDeniedError(
                    "Can\u2019t get realtime event for item that\u2019s not associated with the designated database",
                );
            }),
        ),
    ]);

    return actualEventTransaction as ReadonlyArray<DynamoGeneralRealtimeDatabaseEvent>;
}
