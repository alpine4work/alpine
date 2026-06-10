import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

/**
 * Scan every task and task collection in our database. Use when migrating data.
 */
export async function* expensiveScanEveryTaskAndTaskCollectionForMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
): AsyncIterableIterator<
    | {type: "Task"; spaceId: SpaceId; taskId: TaskId}
    | {type: "TaskCollection"; spaceId: SpaceId; collectionId: TaskCollectionId}
> {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    for await (const item of TaskTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [
            {partitionType: "Task", sortRangeType: "EssentialAttributes"},
            {partitionType: "TaskCollection", sortRangeType: "EssentialAttributes"},
        ],
    })) {
        if (item.partitionType === "Task") {
            if (item.sortRangeType !== "EssentialAttributes") continue;
            yield {type: "Task", spaceId: item.spaceId, taskId: item.taskId};
        } else if (item.partitionType === "TaskCollection") {
            if (item.sortRangeType !== "EssentialAttributes") continue;
            yield {type: "TaskCollection", spaceId: item.spaceId, collectionId: item.collectionId};
        }
    }
}
