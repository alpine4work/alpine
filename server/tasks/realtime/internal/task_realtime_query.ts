import {RBTree} from "bintrees";
import {evaluateTaskQueryNormalizedFiltersForIndexDoc} from "~/server/tasks/index/evaluate_task_query_normalized_filters_for_index_doc.js";
import {getTaskQueryNormalizedSortCursorFromIndexDoc} from "~/server/tasks/index/get_task_query_normalized_sort_cursor_from_index_doc.js";
import {queryTaskIndex} from "~/server/tasks/index/task_index.js";
import {TaskIndexDoc} from "~/server/tasks/index/task_index_doc.js";
import {mightTaskActionAddVisibleTaskInQueryNormalizedFilters} from "~/server/tasks/realtime/internal/might_task_action_add_visible_task_in_query_normalized_filters.js";
import {TaskRealtimeActionContext} from "~/server/tasks/realtime/internal/task_realtime_action_context.js";
import {TaskRealtimeQueryStoreInternal} from "~/server/tasks/realtime/internal/task_realtime_query_store.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskTaskAction} from "~/shared/tasks/actions/task_task_action.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    compareTaskQuerySortCursors,
} from "~/shared/tasks/task_query_sort_cursor.js";

// Keep track of the previous task object the query saw so we can check if
// we've missed any updates. We run this validation in `development` and
// `test` since maintaining task update state correctly is a little tricky to
// get right but critical to the operation of this class.
const previousTaskIdByQueryForTest =
    process.env.NODE_ENV !== "production"
        ? new WeakMap<TaskRealtimeQuery, Map<TaskId, TaskIndexDoc>>()
        : null;

/**
 * Keeps a list of tasks up-to-date in realtime based on some defined filters
 * and sorts. A query's filters and sorts are immutable. If you want to change
 * them, create a new query.
 *
 * Queries have a "loaded range" of tasks which are kept up-to-date in
 * realtime. The query may keep track of tasks outside the loaded range but we
 * may be missing tasks outside the loaded range. The loaded range starts at
 * the beginning of the query.
 *
 * Works closely with `TaskRealtimeQueryStore` where the subscribed tasks in a
 * space are stored and kept up-to-date in realtime. This class does not hold
 * the task objects themselves, since multiple queries can reference the same
 * task tasks are stored in `TaskRealtimeQueryStore` (which also owns query
 * classes).
 *
 * The entire query doesn't need to be loaded at once. We may have a partially
 * loaded query. You can call `load()` to load more tasks into the query.
 *
 * This query class is agnostic to subscribed sessions. We do no extra
 * filtering based on task permission rules. We have another layer on top of
 * this query class that manages client WebSocket connections and permissions.
 */
export class TaskRealtimeQuery {
    private readonly _store: TaskRealtimeQueryStoreInternal;
    private readonly _filters: TaskQueryNormalizedFilters;
    private readonly _sorts: ReadonlyArray<TaskQueryNormalizedSort>;

    /**
     * Tasks in a query are represented with a red-black tree. We use a red-black
     * tree to get O(log(n)) insertion/removal of tasks at any point in the list.
     *
     * We only store task cursors in our tree (to establish order). The full task
     * object can be found in `TaskRealtimeQueryStore` which is shared across all
     * queries in a space.
     *
     * Queries have a "loaded range" in which we keep all tasks in the query of
     * that range available in realtime. We don't load all tasks in a query at once
     * as that would be inefficient for really large queries. The start of our
     * loaded range is the start of the tree and the end is `loadedBeforeCursor`
     * (inclusive).
     *
     * We may have tasks in the query outside of the loaded range. This happens
     * when a task inside the loaded range moves outside of the loaded range or
     * when we add a newly visible task to the query and it happens to land outside
     * of the loaded range. So when iterating over tasks, stop at
     * `loadedBeforeCursor`. Otherwise you'll get a sparse and inconsistent list
     * of tasks.
     */
    private readonly _tree = new RBTree<TaskQuerySortCursor>((cursor1, cursor2) =>
        compareTaskQuerySortCursors(this._sorts, cursor1, cursor2),
    );

    /**
     * The range from the beginning of `tree` to `loadedBeforeCursor` (inclusive)
     * is considered the "loaded range". We will have loaded all tasks within the
     * loaded range and kept them up-to-date in realtime.
     */
    private _loadedBeforeCursor: TaskQuerySortCursor | null = null;

    /**
     * The number of loaded tasks in this query. That is the number of tasks before
     * `loadedBeforeCursor` (inclusive). May be different from `tree.size` since
     * `tree` may contain tasks outside of the loaded range.
     */
    private _loadedCount = 0;

    /**
     * We only want one operation to load new tasks into our query at a time. This
     * state property helps us schedule loads.
     */
    private _loadingState: {
        readonly limit: number;
        readonly promise: Promise<void>;
    } | null = null;

    constructor(
        store: TaskRealtimeQueryStoreInternal,
        {
            filters,
            sorts,
        }: {
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        },
    ) {
        this._store = store;
        this._filters = filters;
        this._sorts = sorts;
    }

    public assertCorrectForTest() {
        // We run this validation in `development` and `test` since maintaining state
        // correctly across the store and query class is a little tricky to get right
        // but critical to the operation of the task realtime service.
        assert(process.env.NODE_ENV !== "production");

        const iterator = this._tree.iterator();
        let cursor: TaskQuerySortCursor | null;
        let expectedLoadedCount = 0;
        const visibleTaskIds = new Set<TaskId>();

        while ((cursor = iterator.next()) !== null) {
            if (
                this._loadedBeforeCursor === null ||
                compareTaskQuerySortCursors(this._sorts, cursor, this._loadedBeforeCursor) <= 0
            ) {
                expectedLoadedCount++;
            }

            const taskId = cursor[cursor.length - 1] as TaskId;
            visibleTaskIds.add(taskId);

            assert(
                this._store.isTaskVisibleInQuery(this, taskId),
                "Task visible in query but store doesn't know",
            );
        }

        assert(
            this._loadedCount === expectedLoadedCount,
            "Query loaded task count does not equal expected loaded task count",
        );

        return {visibleTaskIds};
    }

    /**
     * How many tasks are in our query's loaded range?
     */
    public getLoadedTaskCount(): number {
        return this._loadedCount;
    }

    /**
     * Get all the tasks in our query's loaded range.
     */
    public getLoadedTasks(): Array<TaskIndexDoc> {
        const tasks: Array<TaskIndexDoc> = [];

        const iterator = this._tree.iterator();
        let cursor: TaskQuerySortCursor | null;

        while ((cursor = iterator.next()) !== null) {
            if (
                this._loadedBeforeCursor !== null &&
                compareTaskQuerySortCursors(this._sorts, cursor, this._loadedBeforeCursor) > 0
            ) {
                break;
            }

            const taskId = cursor[cursor.length - 1] as TaskId;
            tasks.push(this._store.getTaskForQuery(this, taskId));
        }

        return tasks;
    }

    /**
     * Does the query have more tasks we haven't loaded yet? If true then calling
     * `loadMore()` will load more tasks into this query.
     */
    public hasMoreUnloadedTasks(): boolean {
        return this._loadedBeforeCursor !== null;
    }

    /**
     * Load some more tasks into the query. If there is another load executing
     * concurrently on this query then we can reuse its results.
     *
     * It's possible that when this function returns you have fewer tasks in the
     * query than what you requested. That happens when the data we query from
     * OpenSearch is out-of-sync from recent realtime actions we've received.
     * Likewise it's also possible the query will have more tasks than what you
     * requested.
     *
     * Callers are expected to look again at the number of tasks and decide whether
     * to load more tasks or not.
     */
    public async loadMoreTasks(context: TaskRealtimeActionContext, limit: number): Promise<void> {
        assert(Number.isInteger(limit));
        if (limit <= 0) return;

        while (this._loadingState !== null) {
            // The pending load will cover this call...
            if (this._loadingState.limit >= limit) return this._loadingState.promise;

            try {
                await this._loadingState.promise;

                // We can load fewer tasks if the pending load completes successfully since it
                // will have filled those tasks in.
                limit -= this._loadingState.limit;
            } catch {
                // noop...
            }
        }

        this._loadingState = {
            limit,
            promise: this._loadMoreTasks(context, limit),
        };
        this._loadingState.promise.finally(() => (this._loadingState = null));

        return this._loadingState.promise;
    }

    private async _loadMoreTasks(context: TaskRealtimeActionContext, limit: number): Promise<void> {
        // Our query is already fully loaded!
        if (this._loadedBeforeCursor === null) return;

        const [tasks] = await runAllPromises([
            queryTaskIndex(context, {
                spaceId: this._store.spaceId,
                filters: this._filters,
                sorts: this._sorts,
                // Load one extra task (which we'll throw away) to know if there are more tasks
                // in the query.
                limit: limit + 1,
                afterCursor: this._loadedBeforeCursor,
            }),
            // We need to make sure we have a full action history store before calling
            // `onQueryTasksLoad()` which needs the action history to catch up our
            // OpenSearch query result.
            this._store.ensureFullActionHistory(context),
        ]);

        const count = Math.min(tasks.length, limit);
        const hasMoreTasks = tasks.length > count;
        const hadNoVisibleTasks = this._tree.size === 0;

        let lastCursor = null;
        for (let i = 0; i < count; i++) {
            const task = tasks[i]!;

            const cursor = getTaskQueryNormalizedSortCursorFromIndexDoc(this._sorts, task.id, task);

            // If the task is already visible in our query, don't add it again. When we
            // call `store.onQueryTasksLoad()`, it will move the task to its correct
            // position.
            //
            // Optimization: If there were no visible tasks in the query when we started,
            // we don't need to consult the store.
            if (hadNoVisibleTasks || !this._store.isTaskVisibleInQuery(this, task.id)) {
                this._tree.insert(cursor);
                this._loadedCount++;
            }

            lastCursor = cursor;
        }

        this._loadedBeforeCursor = hasMoreTasks ? lastCursor : null;

        // Add all the tasks we searched to our store so we can load them later. This
        // call will also iterate through our action history and apply any relevant
        // updates to our query.
        await this._store.onQueryTasksLoad(context, this, tasks);

        // NOTE(calebmer): It's possible that we get here and
        // `store.onQueryTasksLoad()` has moved one or more tasks outside of our loaded
        // range so that we don't have enough tasks to address `limit` anymore. We
        // could call `loadMore()` and keep looping until we have enough tasks. Not
        // implementing this for now since I believe it's a little better to return
        // what we have to the client and let the client choose to load more instead of
        // spending more time trying to load tasks.
        //
        // When we're missing only one or two tasks it's likely the client won't have
        // reached its "load more" threshold and we'll have delayed returning data to
        // the user unnecessarily.
    }

    /**
     * When a task that's visible in our query changes `TaskRealtimeQueryStore`
     * calls this function. The query is then responsible for:
     *
     * 1. Determining if the task is still visible after the update
     * 2. Moving the task to its new position if the sort order changed
     * 3. Propagating this update to connected clients
     *
     * Expectations:
     *
     * - The `TaskId` must be visible in the query
     * - `oldTask` must be exactly the same as the last task object our query
     *   has seen for this `TaskId`
     *
     * If expectations fail then we throw an error in dev and test.
     */
    public onVisibleTaskUpdate(
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
    ): {isStillVisible: boolean} {
        // When testing, track that the query class observes every update to a task and
        // that no updates are skipped.
        if (process.env.NODE_ENV !== "production") {
            assert(previousTaskIdByQueryForTest);

            const previousTaskById = getOrSetDefaultMapValue(
                previousTaskIdByQueryForTest,
                this,
                () => new Map(),
            );

            const previousTask = previousTaskById.get(taskId);
            assert(
                previousTask,
                "Query can't update hidden task that hasn't been added with `maybeAddVisibleTask()`",
            );
            assert(
                previousTask === oldTask,
                "Query must observe all updates to a visible task through `onVisibleTaskUpdate()`",
            );
            previousTaskById.set(taskId, newTask);
        }

        const oldCursor = getTaskQueryNormalizedSortCursorFromIndexDoc(
            this._sorts,
            taskId,
            oldTask,
        );

        // If the task is no longer visible, remove it from our tree.
        const isStillVisible = evaluateTaskQueryNormalizedFiltersForIndexDoc(
            this._filters,
            newTask,
        );
        if (!isStillVisible) {
            const wasRemoved = this._tree.remove(oldCursor);
            assert(wasRemoved);

            // If the task we're removing was in our loaded range then we need to decrease
            // the loaded count.
            if (
                this._loadedBeforeCursor === null ||
                compareTaskQuerySortCursors(this._sorts, oldCursor, this._loadedBeforeCursor) <= 0
            ) {
                this._loadedCount--;
            }

            // When testing, track that the task has been removed from the query.
            if (process.env.NODE_ENV !== "production") {
                assertExists(previousTaskIdByQueryForTest).get(this)?.delete(taskId);
            }

            return {isStillVisible: false};
        }

        const newCursor = getTaskQueryNormalizedSortCursorFromIndexDoc(
            this._sorts,
            taskId,
            newTask,
        );

        // If the sort values of our task have changed then we want to move it to a new
        // position in our tree. This has O(log(n)) performance since we use a binary
        // search tree.
        const haveSortValuesChanged =
            compareTaskQuerySortCursors(this._sorts, oldCursor, newCursor) !== 0;
        if (haveSortValuesChanged) {
            const wasRemoved = this._tree.remove(oldCursor);
            assert(wasRemoved);
            this._tree.insert(newCursor);

            // If our task moved across the `loadedBeforeCursor` boundary then we need to
            // update `loadedCount`.
            if (this._loadedBeforeCursor !== null) {
                const oldCursorComparison = compareTaskQuerySortCursors(
                    this._sorts,
                    oldCursor,
                    this._loadedBeforeCursor,
                );
                const newCursorComparison = compareTaskQuerySortCursors(
                    this._sorts,
                    newCursor,
                    this._loadedBeforeCursor,
                );

                if (oldCursorComparison <= 0 && newCursorComparison > 0) {
                    this._loadedCount--;
                }
                if (oldCursorComparison > 0 && newCursorComparison <= 0) {
                    this._loadedCount++;
                }
            }
        }

        return {isStillVisible: true};
    }

    public mightActionAddVisibleTask(
        actionTime: HybridLogicalTime,
        action: TaskTaskAction,
    ): boolean {
        return mightTaskActionAddVisibleTaskInQueryNormalizedFilters(
            actionTime,
            action,
            this._filters,
        );
    }

    /**
     * Tests whether the task is visible in our query and adds it if so.
     *
     * Expectations:
     *
     * - The task must be hidden in our query, whether or not we end up adding
     *   it as a visible task
     *
     * If expectations fail then we throw an error in dev and test.
     */
    public maybeAddVisibleTask(taskId: TaskId, task: TaskIndexDoc): {isVisible: boolean} {
        // When testing, track that the query class observes every update to a task and
        // that no updates are skipped.
        if (process.env.NODE_ENV !== "production") {
            assert(
                !assertExists(previousTaskIdByQueryForTest).get(this)?.get(taskId),
                "Query can't add task that's already visible again with `maybeAddVisibleTask()`",
            );
        }

        const isVisible = evaluateTaskQueryNormalizedFiltersForIndexDoc(this._filters, task);
        if (!isVisible) return {isVisible: false};

        const cursor = getTaskQueryNormalizedSortCursorFromIndexDoc(this._sorts, taskId, task);
        this._tree.insert(cursor);

        // If we are adding a task in the loaded range the increment our loaded count.
        if (
            this._loadedBeforeCursor === null ||
            compareTaskQuerySortCursors(this._sorts, cursor, this._loadedBeforeCursor) <= 0
        ) {
            this._loadedCount++;
        }

        // When testing, track that the task has been added to the query.
        if (process.env.NODE_ENV !== "production") {
            assert(previousTaskIdByQueryForTest);

            const previousTaskById = getOrSetDefaultMapValue(
                previousTaskIdByQueryForTest,
                this,
                () => new Map(),
            );

            previousTaskById.set(taskId, task);
        }

        return {isVisible: true};
    }
}
