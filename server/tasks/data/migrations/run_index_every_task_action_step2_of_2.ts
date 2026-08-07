import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {TaskActionTable} from "~/server/tasks/data/internal/task_table.js";
import {indexTaskActionTransactionAssumingItsCommitted} from "~/server/tasks/data/task_index.js";
import {TaskRealtimeProcessContext} from "~/server/tasks/data/task_realtime_context.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.open_source.js";
import {defaultMaxRetryAttemptCount} from "~/shared/helpers/async/retry_with_exponential_backoff.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";

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
export async function runIndexEveryTaskActionStep2Of2(
    context: TaskRealtimeProcessContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
) {
    const {serviceName: unknownServiceName} = context.tracer.getRoot();
    assert(unknownServiceName === "MigrationService");
    const serviceName = unknownServiceName;

    const promiseWaiter = new PromiseWaiter();
    let concurrencyMutexSequence = 0;
    const concurrencyMutexes = createArrayWithLength(10, () => new Mutex());
    const mutexByTaskId = new Map<TaskId, Mutex>();

    for await (const item of TaskActionTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
    })) {
        const updateActions = item.actions.filter(
            action =>
                !(action.type === "UpdateTask" && action.taskAction.type === "Create") &&
                !(action.type === "UpdateCollection" && action.collectionAction.type === "Create"),
        );
        if (updateActions.length === 0) continue;

        let action = () =>
            // Once all our task mutexes unlock, now we wait for a concurrency mutex to unlock
            // before indexing the task.
            concurrencyMutexes[concurrencyMutexSequence++ % concurrencyMutexes.length]!.withLock(
                () =>
                    indexTaskActionTransactionAssumingItsCommitted(
                        context.clone({
                            cache: CacheContextModule.new(),
                            batch: BatchContextModule.new(),
                            actor: SystemActorContextModule.dangerouslyNew(
                                serviceName,
                                item.spaceId,
                            ),
                        }),
                        {...item, actions: updateActions},
                        {
                            // Don't record search affinity interactions when backfilling OpenSearch. Search
                            // affinity interactions should only be recorded immediately after the action is
                            // commit.
                            withoutSearchAffinityEntityInteraction: true,
                            // Perform more retries while indexing during this migration. Since we may have a
                            // lot of update contention while trying to reindex all past actions at once.
                            maxRetryAttemptCount: defaultMaxRetryAttemptCount * 2,
                        },
                    ),
            );

        // We only want one transaction per task to be running at a time. Otherwise the
        // transactions will conflict creating a lot of retries. So we have a mutex per
        // `TaskId` and will only start indexing once the mutex for the first task in the
        // transaction unlocks.
        //
        // This is purely an optimization, it's not necessary for correctness. We could run
        // all actions at the same time and accept retries for tasks trying to update the
        // same data. In practice, I've found this migration has a 50% failure rate since
        // we'll often be updating 20+ `UpdateTitle` actions on the same task at once which
        // are constantly conflicting with each other causing failures.
        //
        // We only use the mutex for the first task in the transaction because otherwise
        // we're at risk of deadlocks. For example, transaction A that updates `task1` then
        // `task2` and another transaction B that updates `task2` then `task1`. If we're
        // not careful, transaction A will lock the mutex for `task1` while transaction B
        // locks the mutex for `task2`. Then transaction A tries to lock the mutex for
        // `task2` as well at the same time transaction B tries to lock the mutex for
        // `task1`. Boom, deadlock!
        //
        // Since we use mutexes mostly as an optimization for when we're indexing many
        // `UpdateTitle` actions at once we think it's acceptable to let conflicting
        // multi-task transactions run (they're rarer and usually not near each other in
        // the database).
        const taskIdForMutex = findMapIterable(updateActions, action =>
            action.type === "UpdateTask" ? action.taskId : undefined,
        );
        if (taskIdForMutex !== undefined) {
            const taskMutex = getOrSetDefaultMapValue(
                mutexByTaskId,
                taskIdForMutex,
                () => new Mutex(),
            );

            const originalAction = action;
            action = () => taskMutex.withLock(originalAction);
        }

        promiseWaiter.waitUntil(action);
    }

    await promiseWaiter.wait();
}
