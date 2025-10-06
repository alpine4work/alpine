import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {authorizePostAccess} from "~/server/forum/data/authorize_post_access.js";
import {
    ForumRealtimeTable,
    allowedPostSortRangeTypesForGetPostRealtimeEvent,
} from "~/server/forum/data/internal/forum_realtime_table.js";
import {DynamoGeneralRealtimeEventStub} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {DynamoGeneralRealtimePostEvent} from "~/shared/forum/post_realtime_protocol.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {PostId} from "~/shared/id/types/id_types.js";

/**
 * Converts realtime event stubs into full realtime event objects.
 */
export async function getPostRealtimeEvent(
    context: ServerSessionActionContext,
    postId: PostId,
    eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEventStub>,
): Promise<ReadonlyArray<DynamoGeneralRealtimePostEvent>> {
    const [, actualEventTransaction] = await runAllPromises([
        // Authorizing in parallel means we'll batch the post read in
        // `authorizePostAccess()` with any DynamoDB reads from the
        // `ForumRealtimeTable.getRealtimeEvent()` call.
        authorizePostAccess(context, postId, "View"),

        ForumRealtimeTable.getRealtimeEvent(
            context,
            await runAllPromises(
                eventTransaction.map(async eventStub => {
                    const itemKey = ForumRealtimeTable.deserializeOpaqueItemKey(eventStub.item.key);

                    // Check that the `itemKey` we're reading is for the post we've
                    // authorized.
                    if (
                        itemKey.partitionType === "Post" &&
                        itemKey.postId === postId &&
                        allowedPostSortRangeTypesForGetPostRealtimeEvent[itemKey.sortRangeType]
                    ) {
                        return {...eventStub, itemKey};
                    }

                    throw new PermissionDeniedError(
                        "Can’t get realtime event for item that’s not associated with the designated post",
                    );
                }),
            ),
        ),
    ]);

    return actualEventTransaction as ReadonlyArray<DynamoGeneralRealtimePostEvent>;
}
