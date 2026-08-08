import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {runIndexTaskInitialAssigneePositionMigrationForTask} from "~/server/tasks/data/task_index.js";
import {Context} from "~/shared/context/context.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

/**
 * We added `assigneePosition` on 2025-03-10. This migration makes sure
 * `rawAssigneePosition` and `assigneePosition` exist on every task in OpenSearch.
 */
export async function runIndexTaskInitialAssigneePositionMigration(
    context: Context<DynamoContextModules & {opensearch: OpensearchContextModule}>,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
) {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    let i = 0;
    const promiseWaiter = new PromiseWaiter();
    const mutexes = createArrayWithLength(5, () => new Mutex());

    for await (const item of TaskTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [{partitionType: "Task", sortRangeType: "EssentialAttributes"}],
    })) {
        assert(item.partitionType === "Task" && item.sortRangeType === "EssentialAttributes");

        promiseWaiter.waitUntil(
            mutexes[i++ % mutexes.length]!.withLock(() =>
                runIndexTaskInitialAssigneePositionMigrationForTask(
                    context,
                    item.spaceId,
                    item.taskId,
                ),
            ),
        );
    }

    await promiseWaiter.wait();
}
