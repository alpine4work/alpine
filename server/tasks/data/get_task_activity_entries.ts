import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {TaskActivityTable} from "~/server/tasks/data/internal/task_activity_table.js";
import {DynamoItemPartitionKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {
    RynamoBackfillResult,
    RynamoEvent,
    RynamoQueryResult,
} from "~/shared/dynamo/rynamo_types.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {getMinId} from "~/shared/id/id.open_source.js";
import {TaskActivityEntryId} from "~/shared/id/types/id_types.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {
    TaskActivityFeedDiscreteEntryModel,
    TaskActivityFeedWindowChunkModel,
    TaskActivityModel,
} from "~/shared/tasks/task_activity.js";
import {
    ServerSynchronizationCheckpoint,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export function getTaskActivityEntriesPartitionKey(
    spaceId: SpaceId,
    taskId: TaskId,
): DynamoItemPartitionKey {
    return TaskActivityTable.getRealtimeQueryPartitionKey({partitionType: "Task", spaceId, taskId});
}

/**
 * Loads a task's activity entries in entry id (projection) order. Clients
 * order/aggregate the full set themselves (entries carry their own
 * `lastActivityTime`).
 */
export async function getTaskActivityEntries(
    context: ServerActionContext,
    {
        taskId,
    }: {
        taskId: TaskId;
    },
): Promise<{
    entriesResult: RynamoQueryResult<TaskActivityModel>;
}> {
    const {spaceId} = await authorizeTaskAccess(context, taskId, "View");

    // Spans the client-visible ranges — discrete entries plus both window chunk
    // ranges, which sort between `ActivityEntry` and `WindowSnapshot` — while
    // excluding the internal window snapshots.
    const entriesResult = await TaskActivityTable.realtimeQuery(context, {
        partitionKey: {partitionType: "Task", spaceId, taskId},
        startSortKey: {
            sortRangeType: "ActivityEntry",
            activityEntryId: getMinId<TaskActivityEntryId>(),
        },
        endSortKey: {
            sortRangeType: "TitleWindowChunks",
            chunkNumber: Number.MAX_SAFE_INTEGER,
        },
        // The read-time aggregation design assumes ALL feed items are loaded on the client
        // at once — partial loads would make the derived feed jumpy and unpredictable.
        // Cost: entries are ~250 bytes/item and are written permanently per effective
        // field update, so a task with 5,000 entries is ~1.2 MB ≈ ~150 eventually
        // consistent RCU per task detail page view, plus the same bytes through the app
        // server and into the SSR payload.
        limit: "All",
    });

    return {entriesResult};
}

/** Backfills task activity changes that occurred after `checkpoint`. */
export async function backfillTaskActivity(
    context: ServerActionContext,
    {
        taskId,
        checkpoint,
    }: {
        taskId: TaskId;
        checkpoint: ServerSynchronizationCheckpoint;
    },
): Promise<RynamoBackfillResult<TaskActivityModel>> {
    const {spaceId} = await authorizeTaskAccess(context, taskId, "View");

    const result = await TaskActivityTable.backfillRealtimeQuery(context, {
        partitionKey: {partitionType: "Task", spaceId, taskId},
        checkpoint,
    });
    if (result.type === "Unavailable") return result;

    // The partition also holds internal bookkeeping items (window snapshots and
    // active-group pointers); only entry events belong to clients. Delete events carry
    // no model to filter by, but activity entries are never deleted, so every delete
    // event is internal and dropped too.
    return {
        ...result,
        events: result.events.filter(
            (event): event is RynamoEvent<TaskActivityModel> =>
                event.type === "PutItem" &&
                (event.item.model instanceof TaskActivityFeedDiscreteEntryModel ||
                    event.item.model instanceof TaskActivityFeedWindowChunkModel),
        ),
    };
}

export function getEmptyTaskActivityEntries(
    spaceId: SpaceId,
    taskId: TaskId,
): {
    entriesResult: RynamoQueryResult<TaskActivityModel>;
} {
    return {
        entriesResult: {
            checkpoint: generateServerSynchronizationCheckpoint(),
            partitionKey: getTaskActivityEntriesPartitionKey(spaceId, taskId),
            startItemKey: null,
            endItemKey: null,
            pageInfo: {type: "FromStart", afterItemKey: null, hasNextPage: false},
            items: emptyArray,
        },
    };
}
