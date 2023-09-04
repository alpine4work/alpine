import createTree, {Tree} from "functional-red-black-tree";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {evaluateTaskQueryNormalizedFiltersForModel} from "~/shared/tasks/model/evaluate_task_query_normalized_filters_for_model.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    compareTaskQuerySortCursors,
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
export class TaskQueryModel {
    public readonly filters: TaskQueryNormalizedFilters;
    public readonly sorts: ReadonlyArray<TaskQueryNormalizedSort>;

    private readonly _taskOrder: Tree<TaskQuerySortCursor, null>;
    private readonly _taskIds: Tree<TaskId, null>;

    private readonly _loadedState: TaskRealtimeQueryLoadedState;

    private constructor({
        filters,
        sorts,
        taskOrder,
        taskIds,
        loadedState,
    }: {
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        taskOrder: Tree<TaskQuerySortCursor, null>;
        taskIds: Tree<TaskId, null>;
        loadedState: TaskRealtimeQueryLoadedState;
    }) {
        this.filters = filters;
        this.sorts = sorts;
        this._taskOrder = taskOrder;
        this._taskIds = taskIds;
        this._loadedState = loadedState;
    }

    public static new({
        filters,
        sorts,
    }: {
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    }) {
        return new TaskQueryModel({
            filters,
            sorts,
            taskOrder: createTree<TaskQuerySortCursor, null>((cursor1, cursor2) =>
                compareTaskQuerySortCursors(sorts, cursor1, cursor2),
            ),
            taskIds: createTree<TaskId, null>(defaultCompareStrings),
            loadedState: {type: "Partial", endCursor: null},
        });
    }

    /**
     * Update what we consider as the loaded range for a query. If the loaded state
     * is less than what we already believe to be loaded then this is a noop.
     */
    public extendLoadedState(loadedState: TaskRealtimeQueryLoadedState): TaskQueryModel {
        // Can only extend the loaded state, if we're already fully loaded there's no
        // more extending we can do.
        if (this._loadedState.type === "Full") return this;

        // The query is fully loaded now. Yay!
        if (loadedState.type === "Full") {
            return new TaskQueryModel({
                filters: this.filters,
                sorts: this.sorts,
                taskOrder: this._taskOrder,
                taskIds: this._taskIds,
                loadedState,
            });
        }

        // Loaded state didn't change.
        if (this._loadedState.endCursor === null && loadedState.endCursor === null) return this;

        // Is this loaded state an extension of the last one?
        const isExtending =
            this._loadedState.endCursor === null ||
            (loadedState.endCursor !== null &&
                compareTaskQuerySortCursors(
                    this.sorts,
                    this._loadedState.endCursor,
                    loadedState.endCursor,
                ) < 0);

        if (!isExtending) return this;

        return new TaskQueryModel({
            filters: this.filters,
            sorts: this.sorts,
            taskOrder: this._taskOrder,
            taskIds: this._taskIds,
            loadedState,
        });
    }

    /**
     * Called when a task is added to our query store.
     *
     * Only `TaskModelStore` should call this function. It's ok that this is a
     * public function because since this class is immutable only `TaskModelStore`
     * can update its internal reference.
     */
    public onTaskCreate(newTask: TaskModel): TaskQueryModel {
        const isVisible = evaluateTaskQueryNormalizedFiltersForModel(this.filters, newTask);
        if (!isVisible) return this;

        const newCursor = getTaskQueryNormalizedSortCursorForModel(this.sorts, newTask);

        return new TaskQueryModel({
            filters: this.filters,
            sorts: this.sorts,
            taskOrder: this._taskOrder.insert(newCursor, null),
            taskIds: this._taskIds.insert(newTask.id, null),
            loadedState: this._loadedState,
        });
    }

    /**
     * Called when a task is updated in our query store.
     *
     * Only `TaskModelStore` should call this function. It's ok that this is a
     * public function because since this class is immutable only `TaskModelStore`
     * can update its internal reference.
     *
     * You may receive an update for a task the query did not receive an
     * `onTaskCreate()` event for! This happens because when a query is initialized
     * we don't iterate over tasks in our store to see which tasks belong in our
     * query. So this class will receive updates for those tasks without a create
     * event. Be careful not to assume `oldTask` is a member of the query.
     *
     * `maybeAddVisibleTask()` is used to add tasks previously in the store to
     * our query.
     */
    public onTaskUpdate(oldTask: TaskModel, newTask: TaskModel): TaskQueryModel {
        assert(oldTask.id === newTask.id);

        const wasVisible = evaluateTaskQueryNormalizedFiltersForModel(this.filters, oldTask);
        const isVisible = evaluateTaskQueryNormalizedFiltersForModel(this.filters, newTask);

        // If the task wasn't visible in the query and still isn't visible the query
        // hasn't changed.
        if (!wasVisible && !isVisible) return this;

        // Task is newly visible in the query. Insert at the correct position.
        if (!wasVisible && isVisible) {
            const newCursor = getTaskQueryNormalizedSortCursorForModel(this.sorts, newTask);

            return new TaskQueryModel({
                filters: this.filters,
                sorts: this.sorts,
                taskOrder: this._taskOrder.insert(newCursor, null),
                taskIds: this._taskIds.insert(newTask.id, null),
                loadedState: this._loadedState,
            });
        }

        // Task used to be visible in the query but not anymore.
        if (wasVisible && !isVisible) {
            const oldCursor = getTaskQueryNormalizedSortCursorForModel(this.sorts, oldTask);

            return new TaskQueryModel({
                filters: this.filters,
                sorts: this.sorts,
                taskOrder: this._taskOrder.remove(oldCursor),
                taskIds: this._taskIds.remove(oldTask.id),
                loadedState: this._loadedState,
            });
        }

        const newCursor = getTaskQueryNormalizedSortCursorForModel(this.sorts, newTask);

        // If the old task was visible in the query but was not inserted in the query
        // then we need to insert the task fresh instead of removing the old cursor
        // (since there will be no old cursor).
        //
        // When a query is initialized we don't loop over tasks currently in our store
        // to discover tasks that are part of the query. That means at any point a
        // store may have tasks that are visible in this query but the query doesn't
        // know about.
        if (!this._taskIds.find(newTask.id).valid) {
            return new TaskQueryModel({
                filters: this.filters,
                sorts: this.sorts,
                taskOrder: this._taskOrder.insert(newCursor, null),
                taskIds: this._taskIds.insert(newTask.id, null),
                loadedState: this._loadedState,
            });
        }

        const oldCursor = getTaskQueryNormalizedSortCursorForModel(this.sorts, oldTask);

        const haveSortValuesChanged =
            compareTaskQuerySortCursors(this.sorts, oldCursor, newCursor) !== 0;

        // The task is visible in the query but the change does not affect its position
        // in the query.
        if (!haveSortValuesChanged) return this;

        return new TaskQueryModel({
            filters: this.filters,
            sorts: this.sorts,
            taskOrder: this._taskOrder.remove(oldCursor).insert(newCursor, null),
            taskIds: this._taskIds,
            loadedState: this._loadedState,
        });
    }

    /**
     * Called when we think a task might be visible in the query but the query
     * doesn't know about the task since the query was initialized after the task
     * was created.
     *
     * Used with `previouslyBackfilledTaskIds` to add tasks to our query that our
     * realtime connection sent us before the query was initialized.
     */
    public maybeAddVisibleTask(task: TaskModel): TaskQueryModel {
        // If the task is already in the query, great! We don't need to add it.
        if (this._taskIds.find(task.id).valid) return this;

        const isVisible = evaluateTaskQueryNormalizedFiltersForModel(this.filters, task);
        if (!isVisible) return this;

        const newCursor = getTaskQueryNormalizedSortCursorForModel(this.sorts, task);

        return new TaskQueryModel({
            filters: this.filters,
            sorts: this.sorts,
            taskOrder: this._taskOrder.insert(newCursor, null),
            taskIds: this._taskIds.insert(task.id, null),
            loadedState: this._loadedState,
        });
    }

    /**
     * Get the number of tasks in our query's loaded range. There may be more tasks
     * that match the query's filters in the store but this function tells us how
     * many are considered fully loaded and kept up-to-date in realtime.
     */
    public getLoadedCount(): number {
        if (this._loadedState.type === "Full") return this._taskOrder.length;
        if (this._loadedState.endCursor === null) return 0;

        let loadedCount = this._taskOrder.length;
        const iterator = this._taskOrder.end;

        while (iterator.valid) {
            const cursor = iterator.key!;

            if (compareTaskQuerySortCursors(this.sorts, cursor, this._loadedState.endCursor) <= 0) {
                break;
            }

            loadedCount--;
            iterator.prev();
        }

        return loadedCount;
    }
}
