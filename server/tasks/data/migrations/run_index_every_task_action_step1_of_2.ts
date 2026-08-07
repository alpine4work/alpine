import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {TaskActionTable} from "~/server/tasks/data/internal/task_table.js";
import {indexTaskActionTransactionAssumingItsCommitted} from "~/server/tasks/data/task_index.js";
import {TaskRealtimeProcessContext} from "~/server/tasks/data/task_realtime_context.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

/**
 * Reindex every task action in our task actions table to rebuild our task
 * OpenSearch index.
 *
 * This migration needs to be run in two steps. The first step creates all the task
 * docs in OpenSearch. The second step applies all non-create updates. We need to
 * create docs first since if an update action doesn't find the task doc it's
 * updating it'll retry until the task doc exists. We can't guarantee the scan will
 * find create actions first so we run the migration in two steps to guarantee
 * tasks are created before updated.
 */
export async function runIndexEveryTaskActionStep1Of2(
    context: TaskRealtimeProcessContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
) {
    const {serviceName: unknownServiceName} = context.tracer.getRoot();
    assert(unknownServiceName === "MigrationService");
    const serviceName = unknownServiceName;

    let i = 0;
    const promiseWaiter = new PromiseWaiter();
    const mutexes = createArrayWithLength(10, () => new Mutex());

    for await (const item of TaskActionTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
    })) {
        const createActions = item.actions.filter(
            action =>
                (action.type === "UpdateTask" && action.taskAction.type === "Create") ||
                (action.type === "UpdateCollection" && action.collectionAction.type === "Create"),
        );
        if (createActions.length === 0) continue;

        promiseWaiter.waitUntil(
            mutexes[i++ % mutexes.length]!.withLock(() =>
                indexTaskActionTransactionAssumingItsCommitted(
                    context.clone({
                        cache: CacheContextModule.new(),
                        batch: BatchContextModule.new(),
                        actor: SystemActorContextModule.dangerouslyNew(serviceName, item.spaceId),
                    }),
                    {...item, actions: createActions},
                    {
                        // Don't record search affinity interactions when backfilling OpenSearch. Search
                        // affinity interactions should only be recorded immediately after the action is
                        // commit.
                        withoutSearchAffinityEntityInteraction: true,
                    },
                ),
            ),
        );
    }

    await promiseWaiter.wait();
}
