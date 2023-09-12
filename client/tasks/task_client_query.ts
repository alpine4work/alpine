import createTree, {Tree} from "functional-red-black-tree";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {Store} from "~/client/helpers/store/store.js";
import {ValueStore} from "~/client/helpers/store/value_store.js";
import {
    TaskClientStore,
    TaskClientStoreInternal,
    TaskClientStoreTaskEntry,
} from "~/client/tasks/task_client_store.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {evaluateTaskQueryNormalizedFiltersForModel} from "~/shared/tasks/model/evaluate_task_query_normalized_filters_for_model.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    compareTaskQuerySortCursors,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskRealtimeQueryLoadedState} from "~/shared/tasks/task_realtime_protocol.js";

/**
 * Maintains the state of a query on the client. Whenever a task is updated in
 * the client store we let all our client queries know and they decide whether
 * or not an update is needed.
 *
 * The loading sequence for a query goes like this:
 *
 * 1. A new query model is created in the store before we send a
 *    `subscribeToQuery` procedure from `TaskRealtimeProtocol` to the server.
 *
 * 2. The query receives and incorporates realtime events into the query model
 *    state, including the realtime event side-effect of `subscribeToQuery`
 *    that backfills all our tasks.
 *
 * 3. `subscribeToQuery` returns with the `loadedState` (our query's pagination
 *    state) and `previouslyBackfilledTaskIds` which is tasks the server
 *    previously backfilled that may not be in our query model since they
 *    weren't in the backfill event we sent for the query. Once we incorporate
 *    `previouslyBackfilledTaskIds` into our query model the model is considered
 *    fully loaded.
 *
 * This process is more or less repeated when loading more tasks with the
 * `loadMoreQueryTasks` procedure in `TaskRealtimeProtocol`.
 */
export class TaskClientQuery {
    public readonly store: TaskClientStore;
    public readonly filters: TaskQueryNormalizedFilters;
    public readonly sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    private readonly _internal: TaskClientQueryInternal;

    /**
     * The current loaded state of the query.
     */
    public readonly loadedStateStore: Store<"Unloaded" | "PartiallyLoaded" | "FullyLoaded">;

    /**
     * The query's loaded task order.
     *
     * The query might be keeping track of more tasks that aren't in the loaded
     * task range.
     */
    public readonly taskOrderStore: Store<Tree<TaskQuerySortCursor, null>>;

    constructor(internal: TaskClientQueryInternal) {
        this._internal = internal;
        this.store = this._internal.store.external;
        this.filters = this._internal.filters;
        this.sorts = this._internal.sorts;
        this.loadedStateStore = this._internal.loadedStateStore;
        this.taskOrderStore = this._internal.taskOrderStore;
    }

    /**
     * You're allowed to get the query's internal instance if you have an internal
     * store instance. Otherwise you must use the query's public methods.
     */
    public _getInternal(internal: TaskClientStoreInternal) {
        return this._internal;
    }

    public retain() {
        this._internal.retain();
    }

    public release() {
        this._internal.release();
    }

    public getDesiredCountSnapshot() {
        return this._internal.getDesiredCountSnapshot();
    }

    /**
     * Get the store associated with the provided `TaskId`.
     *
     * Throws an error if `TaskId` is not a part of the query when you call this
     * function.
     *
     * The `task` in this store should be non-null when this function is called but
     * if you hold onto this reference for long enough you may see `task` become
     * null because the task leaves this query and becomes unauthorized.
     */
    public getTaskEntryStore(taskId: TaskId): Store<TaskClientStoreTaskEntry> {
        return this._internal.getTaskEntryStore(taskId);
    }

    /**
     * Get a snapshot of the task associated with the provided `TaskId`. Prefer
     * using `getTaskEntryStore()` since it will give you changes to the task
     * over time.
     *
     * Throws an error if `TaskId` is not a part of the query when you call this
     * function.
     */
    public getTaskSnapshot(taskId: TaskId): TaskModel {
        return assertExists(this._internal.getTaskEntryStore(taskId).getSnapshot().task);
    }
}

export class TaskClientQueryInternal {
    public readonly store: TaskClientStoreInternal;
    public readonly filters: TaskQueryNormalizedFilters;
    public readonly sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    public readonly external: TaskClientQuery;

    /**
     * Queries start with 1 reference. The reference count can be increased by
     * calling `retain()` and decreased by calling `release()` once the
     * reference count reaches 0 the query is unloaded.
     */
    private _referenceCount = 1;

    /**
     * The desired number of tasks we'd like to load into this query. Used as the
     * query's `limit` when initially loading. We may have more than or fewer tasks
     * than the desired count at any point in time.
     */
    private _desiredCount: number;

    private readonly _taskOrderAndLoadedStateStore: ValueStore<{
        // `loadedState` is null when the query has not finished loading for the
        // first time.
        readonly loadedState: TaskRealtimeQueryLoadedState | null;
        readonly taskOrder: Tree<TaskQuerySortCursor, null>;
    }>;
    private readonly _taskEntryStoreById = new Map<TaskId, Store<TaskClientStoreTaskEntry>>();

    /**
     * The current loaded state of the query.
     */
    public readonly loadedStateStore: Store<"Unloaded" | "PartiallyLoaded" | "FullyLoaded">;

    /**
     * The query's loaded task order.
     *
     * The query might be keeping track of more tasks that aren't in the loaded
     * task range.
     */
    public readonly taskOrderStore: Store<Tree<TaskQuerySortCursor, null>>;

    // NOCOMMIT: Referenced tasks and collections

    constructor({
        store,
        desiredCount,
        filters,
        sorts,
    }: {
        store: TaskClientStoreInternal;
        desiredCount: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    }) {
        this.store = store;
        this._desiredCount = desiredCount;
        this.filters = filters;
        this.sorts = sorts;
        this._taskOrderAndLoadedStateStore = new ValueStore<{
            loadedState: TaskRealtimeQueryLoadedState | null;
            taskOrder: Tree<TaskQuerySortCursor, null>;
        }>({
            loadedState: null,
            taskOrder: createTree<TaskQuerySortCursor, null>((cursor1, cursor2) =>
                compareTaskQuerySortCursors(this.sorts, cursor1, cursor2),
            ),
        });

        this.loadedStateStore = this._taskOrderAndLoadedStateStore.map(({loadedState}) => {
            if (loadedState === null) return "Unloaded";
            if (loadedState.type === "Full") return "FullyLoaded";
            return "PartiallyLoaded";
        });

        this.taskOrderStore = this._taskOrderAndLoadedStateStore.map(({loadedState, taskOrder}) => {
            if (loadedState?.type === "Full") return taskOrder;

            if (loadedState === null || loadedState.endCursor === null) {
                return taskOrder.length === 0 ? taskOrder : createTree(taskOrder._compare);
            } else {
                let loadedTaskOrder = taskOrder;
                let iterator = loadedTaskOrder.end;

                // Remove tasks that are out of the loaded range until we find the last task in
                // the loaded range.
                while (iterator.valid) {
                    const cursor = iterator.key!;

                    if (
                        compareTaskQuerySortCursors(this.sorts, cursor, loadedState.endCursor) <= 0
                    ) {
                        break;
                    }

                    loadedTaskOrder = iterator.remove();
                    iterator = loadedTaskOrder.end;
                }

                return loadedTaskOrder;
            }
        });

        this.external = new TaskClientQuery(this);
    }

    public assertCorrectForTest() {
        assert(process.env.NODE_ENV !== "production");

        const {taskOrder} = this._taskOrderAndLoadedStateStore.getSnapshot();
        const taskOrderIds = new Set<TaskId>();

        const iterator = taskOrder.begin;
        while (iterator.valid) {
            const taskId = getTaskQuerySortCursorTaskId(iterator.key!);

            assert(
                !taskOrderIds.has(taskId),
                "A task may not appear in a query's task order more than once",
            );
            taskOrderIds.add(taskId);

            assert(
                this._taskEntryStoreById.has(taskId),
                "Query must have a reference for every task entry store in the task order",
            );

            iterator.next();
        }

        assert(
            taskOrderIds.size === this._taskEntryStoreById.size,
            "Query must not have a reference to a task entry store that's not in the task order",
        );
    }

    /**
     * Add a reference for our query. You should call `release()` later when you no
     * longer need the reference. Once the query hits zero references we will clean
     * up this query and all its data.
     */
    public retain() {
        assert(this._referenceCount > 0, "Can't retain a released query");

        this._referenceCount++;
    }

    /**
     * Release our reference to the query. Once the query hits zero references we
     * will clean up this query and all its data.
     */
    public release() {
        assert(this._referenceCount > 0, "Query is already released");

        this._referenceCount--;

        if (this._referenceCount === 0) {
            batchStoreUpdates(() => {
                // Delete the query from our store.
                this.store.onQueryFinallyRelease(this);

                // Clear our query's task data.
                this._taskEntryStoreById.clear();
                this._taskOrderAndLoadedStateStore.set({
                    loadedState: null,
                    taskOrder: createTree<TaskQuerySortCursor, null>((cursor1, cursor2) =>
                        compareTaskQuerySortCursors(this.sorts, cursor1, cursor2),
                    ),
                });
            });
        }
    }

    public getDesiredCountSnapshot() {
        return this._desiredCount;
    }

    public getTaskEntryStore(taskId: TaskId): Store<TaskClientStoreTaskEntry> {
        const taskEntryStore = this._taskEntryStoreById.get(taskId);
        if (!taskEntryStore) throw new InternalError("Task is not visible in query");
        return taskEntryStore;
    }

    /**
     * Called by `TaskClientStore` after applying a realtime update event. This
     * function updates our task client query's internal state.
     */
    public onTasksUpdated(
        taskEntryUpdateById: Map<
            TaskId,
            {
                taskEntryStore: ValueStore<TaskClientStoreTaskEntry>;
                oldTaskEntry: TaskClientStoreTaskEntry | null;
                newTaskEntry: TaskClientStoreTaskEntry;
            }
        >,
    ) {
        // Noop if this query is released.
        if (this._referenceCount === 0) return;

        const {loadedState, taskOrder: previousTaskOrder} =
            this._taskOrderAndLoadedStateStore.getSnapshot();
        let taskOrder = previousTaskOrder;

        for (const [taskId, {taskEntryStore, oldTaskEntry, newTaskEntry}] of taskEntryUpdateById) {
            if (newTaskEntry.task === null) {
                // Ignore tasks that haven't been backfilled yet.
                if (oldTaskEntry === null || oldTaskEntry.task === null) continue;

                // If a task is being reverted we need to remove it from our query. But we
                // don't have to remove tasks that don't exist in our query.
                if (!this._taskEntryStoreById.has(taskId)) continue;

                const oldCursor = getTaskQueryNormalizedSortCursorForModel(
                    this.sorts,
                    oldTaskEntry.task,
                );

                taskOrder = taskOrder.remove(oldCursor);

                // Get rid of our task entry store reference so it can be garbage collected.
                this._taskEntryStoreById.delete(taskId);
                continue;
            }

            const isVisible = evaluateTaskQueryNormalizedFiltersForModel(
                this.filters,
                newTaskEntry.task,
            );

            // If a task was not visible in our query, check if it's visible now and add it
            // if so.
            if (!this._taskEntryStoreById.has(taskId)) {
                if (!isVisible) continue;

                const newCursor = getTaskQueryNormalizedSortCursorForModel(
                    this.sorts,
                    newTaskEntry.task,
                );

                taskOrder = taskOrder.insert(newCursor, null);

                // Capture a reference to the task entry store so it's not garbage collected.
                this._taskEntryStoreById.set(taskId, taskEntryStore);
                continue;
            }

            // If this task exists in our query that means we've seen the backfilled
            // task before.
            assert(oldTaskEntry?.task);

            // Task used to be visible in the query but not anymore.
            if (!isVisible) {
                const oldCursor = getTaskQueryNormalizedSortCursorForModel(
                    this.sorts,
                    oldTaskEntry.task,
                );

                taskOrder = taskOrder.remove(oldCursor);

                // Get rid of our task entry store reference so it can be garbage collected.
                this._taskEntryStoreById.delete(taskId);
                continue;
            }

            const newCursor = getTaskQueryNormalizedSortCursorForModel(
                this.sorts,
                newTaskEntry.task,
            );
            const oldCursor = getTaskQueryNormalizedSortCursorForModel(
                this.sorts,
                oldTaskEntry.task,
            );

            const haveSortValuesChanged =
                compareTaskQuerySortCursors(this.sorts, oldCursor, newCursor) !== 0;

            // The task is visible in the query but the change does not affect its position
            // in the query.
            if (!haveSortValuesChanged) continue;

            taskOrder = taskOrder.remove(oldCursor).insert(newCursor, null);
        }

        if (taskOrder !== previousTaskOrder) {
            this._taskOrderAndLoadedStateStore.set({loadedState, taskOrder});
        }

        // Make sure our query is well formed in test environments.
        if (process.env.NODE_ENV !== "production") {
            this.assertCorrectForTest();
        }
    }

    /**
     * Called by `TaskClientStore` after the server tells us that all the tasks for
     * a query have loaded. The server also tells us which tasks it didn't include
     * in the backfill update event which we should have and should backfill into
     * our query.
     */
    public onTasksLoaded(
        loadedState: TaskRealtimeQueryLoadedState,
        previouslyBackfilledTasks: Array<{
            taskEntryStore: ValueStore<TaskClientStoreTaskEntry>;
            taskEntry: TaskClientStoreTaskEntry & {task: TaskModel};
        }>,
    ): void {
        // Noop if this query is released.
        if (this._referenceCount === 0) return;

        const {loadedState: previousLoadedState, taskOrder: previousTaskOrder} =
            this._taskOrderAndLoadedStateStore.getSnapshot();

        // Optimization: Maintain our `loadedState` reference if it didn't change.
        const nextLoadedState = isDeepEqual(loadedState, previousLoadedState)
            ? previousLoadedState
            : loadedState;

        let nextTaskOrder = previousTaskOrder;

        for (const {taskEntryStore, taskEntry} of previouslyBackfilledTasks) {
            // If the task is already in our store (perhaps an update event added it) then
            // we don't need to insert the task again.
            if (this._taskEntryStoreById.has(taskEntry.task.id)) continue;

            const isVisible = evaluateTaskQueryNormalizedFiltersForModel(
                this.filters,
                taskEntry.task,
            );
            if (!isVisible) continue;

            const newCursor = getTaskQueryNormalizedSortCursorForModel(this.sorts, taskEntry.task);

            nextTaskOrder = nextTaskOrder.insert(newCursor, null);

            // Capture a reference to the task entry store so it's not garbage collected.
            this._taskEntryStoreById.set(taskEntry.task.id, taskEntryStore);
        }

        if (previousLoadedState !== nextLoadedState || previousTaskOrder !== nextTaskOrder) {
            this._taskOrderAndLoadedStateStore.set({
                loadedState: nextLoadedState,
                taskOrder: nextTaskOrder,
            });
        }

        // Make sure our query is well formed in test environments.
        if (process.env.NODE_ENV !== "production") {
            this.assertCorrectForTest();
        }
    }
}
