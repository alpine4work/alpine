import {RBTree} from "bintrees";
import {evaluateTaskQueryNormalizedFiltersForIndexDoc} from "~/server/tasks/data/evaluate_task_query_normalized_filters_for_index_doc.js";
import {getTaskQueryNormalizedSortCursorFromIndexDoc} from "~/server/tasks/data/get_task_query_normalized_sort_cursor_from_index_doc.js";
import {queryTaskIndex} from "~/server/tasks/data/task_index.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {mightTaskActionAddVisibleTaskInQueryNormalizedFilters} from "~/server/tasks/realtime/might_task_action_add_visible_task_in_query_normalized_filters.js";
import {
    TaskRealtimeQueryStoreInternal,
    TaskRealtimeQueryStoreTaskEntry,
} from "~/server/tasks/realtime/task_realtime_query_store.js";
import {TaskRealtimeQuerySubscription} from "~/server/tasks/realtime/task_realtime_query_subscription.js";
import {TaskRealtimeQueryViewer} from "~/server/tasks/realtime/task_realtime_query_viewer.js";
import {TaskRealtimeSystemActionContext} from "~/server/tasks/realtime/task_realtime_system_action_context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
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
    public readonly store: TaskRealtimeQueryStoreInternal;
    public readonly filters: TaskQueryNormalizedFilters;
    public readonly sorts: ReadonlyArray<TaskQueryNormalizedSort>;

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
        compareTaskQuerySortCursors(this.sorts, cursor1, cursor2),
    );

    /**
     * The range from the beginning of `tree` to `loadedBeforeCursor` (inclusive)
     * is considered the "loaded range". We will have loaded all tasks within the
     * loaded range and kept them up-to-date in realtime.
     *
     * If `Unloaded` then we haven't loaded any tasks into this query yet. If
     * `FullyLoaded` then we've loaded all the tasks into this query.
     *
     * This cursor may not equal the current cursor for the task it references. For
     * example, if we set this to a cursor that includes a `TaskPriority` of `High`
     * if the task later changes the priority to `Low` we don't change this cursor.
     * We keep the cursor with priority `High` and the `TaskId`. This is because if
     * the task moves in our query, we don't automatically load all the tasks
     * between the old task position and new task position. So the cursor
     * represents a kind of point-in-time snapshot where we've decided to keep all
     * tasks before it up-to-date.
     */
    private _loadedBeforeCursor: TaskQuerySortCursor | "FullyLoaded" | "Unloaded" = "Unloaded";

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

    // NOCOMMIT: Document
    private readonly _subscriptions = new Set<TaskRealtimeQuerySubscription>();

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
        this.store = store;
        this.filters = filters;
        this.sorts = sorts;
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
                this._loadedBeforeCursor !== "Unloaded" &&
                (this._loadedBeforeCursor === "FullyLoaded" ||
                    compareTaskQuerySortCursors(this.sorts, cursor, this._loadedBeforeCursor) <= 0)
            ) {
                expectedLoadedCount++;
            }

            const taskId = cursor[cursor.length - 1] as TaskId;
            assert(!visibleTaskIds.has(taskId), "Task appears in query twice");
            visibleTaskIds.add(taskId);

            assert(
                this.store.isTaskVisibleInQuery(this, taskId),
                "Task visible in query but store doesn't know",
            );

            const task = this.store.getTaskForQuery(this, taskId);

            assert(
                isDeepEqual(cursor, getTaskQueryNormalizedSortCursorFromIndexDoc(this.sorts, task)),
                "Task cursor in query does not match expected cursor from task in store",
            );

            assert(
                evaluateTaskQueryNormalizedFiltersForIndexDoc(this.filters, task),
                "Task visible in query should pass the query's filters",
            );
        }

        assert(
            this._loadedCount === expectedLoadedCount,
            "Query loaded task count does not equal expected loaded task count",
        );

        return {visibleTaskIds};
    }

    public addSubscription(subscription: TaskRealtimeQuerySubscription) {
        // NOCOMMIT: Revive from eviction
        this._subscriptions.add(subscription);
    }

    public removeSubscription(subscription: TaskRealtimeQuerySubscription) {
        // NOCOMMIT: Schedule for eviction
        this._subscriptions.delete(subscription);
    }

    /**
     * How many tasks are in our query's loaded range?
     */
    public getLoadedTaskCount(): number {
        return this._loadedCount;
    }

    /**
     * Gets some number of loaded tasks from this query up to `afterCursor`.
     */
    public getLoadedTasks({
        limit,
        afterCursor,
    }: {
        limit: number;
        afterCursor: TaskQuerySortCursor | null;
    }): {
        hasMoreTasks: boolean;
        tasks: Array<TaskIndexDoc>;
    } {
        const tasks: Array<TaskIndexDoc> = [];

        // An iterator that starts at the item after `afterCursor`. If there is no
        // `afterCursor` then the iterator starts at the first item.
        let afterCursorIterator;
        if (afterCursor) {
            afterCursorIterator = this._tree.lowerBound(afterCursor);

            // `tree.lowerBound(cursor)` returns an iterator to `cursor` or if `cursor`
            // doesn't exist the item after `cursor`. We always want the the item after
            // `cursor`.
            const iteratorCursor = afterCursorIterator.data();
            if (
                iteratorCursor !== null &&
                compareTaskQuerySortCursors(this.sorts, afterCursor, iteratorCursor) === 0
            ) {
                afterCursorIterator.next();
            }
        } else {
            afterCursorIterator = this._tree.iterator();

            // `tree.iterator()` starts as a null iterator. Call `next()` to move the
            // iterator to the first item.
            afterCursorIterator.next();
        }

        let hasMoreTasks;
        while (true) {
            const cursor = afterCursorIterator.data();
            if (cursor === null) {
                hasMoreTasks = this._loadedBeforeCursor !== "FullyLoaded";
                break;
            }
            afterCursorIterator.next();

            if (
                this._loadedBeforeCursor === "Unloaded" ||
                (this._loadedBeforeCursor !== "FullyLoaded" &&
                    compareTaskQuerySortCursors(this.sorts, cursor, this._loadedBeforeCursor) > 0)
            ) {
                hasMoreTasks = true;
                break;
            }

            // Once we've reached our limit we can stop adding tasks.
            if (typeof limit === "number" && tasks.length >= limit) {
                hasMoreTasks = true;
                break;
            }

            const taskId = cursor[cursor.length - 1] as TaskId;
            tasks.push(this.store.getTaskForQuery(this, taskId));
        }

        return {
            hasMoreTasks,
            tasks,
        };
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
    public async loadMoreTasks(
        context: TaskRealtimeSystemActionContext,
        limit: number,
    ): Promise<void> {
        assert(Number.isInteger(limit));
        if (limit < 0) return;

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

    private async _loadMoreTasks(
        context: TaskRealtimeSystemActionContext,
        limit: number,
    ): Promise<void> {
        assert(limit >= 0);

        // Our query is already fully loaded!
        if (this._loadedBeforeCursor === "FullyLoaded") return;

        const afterCursor =
            this._loadedBeforeCursor !== "Unloaded" ? this._loadedBeforeCursor : null;

        const [tasks] = await runAllPromises([
            queryTaskIndex(context, {
                spaceId: this.store.spaceId,
                filters: this.filters,
                sorts: this.sorts,
                // Load one extra task (which we'll throw away) to know if there are more tasks
                // in the query.
                limit: limit + 1,
                afterCursor,
            }),
            // We need to make sure we have a full action history store before calling
            // `onQueryTasksLoad()` which needs the action history to catch up our
            // OpenSearch query result.
            this.store.ensureFullActionHistory(context),
        ]);

        // An iterator that starts at the item after `afterCursor`. If there is no
        // `afterCursor` then the iterator starts at the first item.
        let afterCursorIterator;
        if (afterCursor) {
            afterCursorIterator = this._tree.lowerBound(afterCursor);

            // `tree.lowerBound(cursor)` returns an iterator to `cursor` or if `cursor`
            // doesn't exist the item after `cursor`. We always want the the item after
            // `cursor`.
            const iteratorCursor = afterCursorIterator.data();
            if (
                iteratorCursor !== null &&
                compareTaskQuerySortCursors(this.sorts, afterCursor, iteratorCursor) === 0
            ) {
                afterCursorIterator.next();
            }
        } else {
            afterCursorIterator = this._tree.iterator();

            // `tree.iterator()` starts as a null iterator. Call `next()` to move the
            // iterator to the first item.
            afterCursorIterator.next();
        }

        if (tasks.length === 0) {
            this._loadedBeforeCursor = "FullyLoaded";

            // Now that we've extended our query's loaded range, increment `loadedCount`
            // for any existing tasks in the new loaded range.
            //
            // NOCOMMIT: Is this while-loop tested?
            while (true) {
                const cursor = afterCursorIterator.data();
                if (cursor === null) break;
                afterCursorIterator.next();

                this._loadedCount++;
            }
        } else {
            const hasMoreTasks = tasks.length > limit;
            const hadNoVisibleTasks = this._tree.size === 0;

            // Throw away any extra tasks we loaded to check if there are more tasks in
            // the query.
            while (tasks.length > limit) {
                tasks.pop();
            }

            const lastTask = tasks[tasks.length - 1];

            // Now that we've extended our query's loaded range, increment `loadedCount`
            // for any existing tasks in the new loaded range.
            if (lastTask) {
                const lastCursor = getTaskQueryNormalizedSortCursorFromIndexDoc(
                    this.sorts,
                    lastTask,
                );
                this._loadedBeforeCursor = hasMoreTasks ? lastCursor : "FullyLoaded";

                while (true) {
                    const cursor = afterCursorIterator.data();
                    if (cursor === null) break;
                    afterCursorIterator.next();

                    if (
                        hasMoreTasks &&
                        compareTaskQuerySortCursors(this.sorts, cursor, lastCursor) > 0
                    ) {
                        break;
                    }

                    this._loadedCount++;
                }
            }

            for (const task of tasks) {
                // If the task is already visible in our query, don't add it again. When we
                // call `store.onQueryTasksLoad()`, it will move the task to its correct
                // position.
                //
                // Optimization: If there were no visible tasks in the query when we started
                // (aka `hadNoVisibleTasks` is true), we don't need to consult the store.
                if (!hadNoVisibleTasks && this.store.isTaskVisibleInQuery(this, task.id)) {
                    continue;
                }

                const cursor = getTaskQueryNormalizedSortCursorFromIndexDoc(this.sorts, task);

                this._tree.insert(cursor);
                this._loadedCount++;

                for (const subscription of this._subscriptions) {
                    subscription.onVisibleTaskAdd(context, task);
                }

                // When testing, track that the task has been added to the query.
                if (process.env.NODE_ENV !== "production") {
                    getOrSetDefaultMapValue(
                        assertExists(previousTaskIdByQueryForTest),
                        this,
                        () => new Map(),
                    ).set(task.id, task);
                }
            }
        }

        // Add all the tasks we searched to our store so we can load them later. This
        // call will also iterate through our action history and apply any relevant
        // updates to our query.
        await this.store.onQueryTasksLoad(context, this, tasks);

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
        context: TaskRealtimeSystemActionContext,
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

        const oldCursor = getTaskQueryNormalizedSortCursorFromIndexDoc(this.sorts, oldTask);

        // If the task is no longer visible, remove it from our tree.
        const isStillVisible = evaluateTaskQueryNormalizedFiltersForIndexDoc(this.filters, newTask);
        if (!isStillVisible) {
            const wasRemoved = this._tree.remove(oldCursor);
            assert(wasRemoved);

            // If the task we're removing was in our loaded range then we need to decrease
            // the loaded count.
            if (
                this._loadedBeforeCursor !== "Unloaded" &&
                (this._loadedBeforeCursor === "FullyLoaded" ||
                    compareTaskQuerySortCursors(this.sorts, oldCursor, this._loadedBeforeCursor) <=
                        0)
            ) {
                this._loadedCount--;
            }

            for (const subscription of this._subscriptions) {
                subscription.onVisibleTaskRemove(context, oldTask);
            }

            // When testing, track that the task has been removed from the query.
            if (process.env.NODE_ENV !== "production") {
                assertExists(previousTaskIdByQueryForTest).get(this)?.delete(taskId);
            }

            return {isStillVisible: false};
        }

        const newCursor = getTaskQueryNormalizedSortCursorFromIndexDoc(this.sorts, newTask);

        // If the sort values of our task have changed then we want to move it to a new
        // position in our tree. This has O(log(n)) performance since we use a binary
        // search tree.
        const haveSortValuesChanged =
            compareTaskQuerySortCursors(this.sorts, oldCursor, newCursor) !== 0;
        if (haveSortValuesChanged) {
            const wasRemoved = this._tree.remove(oldCursor);
            assert(wasRemoved);
            this._tree.insert(newCursor);

            // If our task moved across the `loadedBeforeCursor` boundary then we need to
            // update `loadedCount`.
            if (
                this._loadedBeforeCursor !== "Unloaded" &&
                this._loadedBeforeCursor !== "FullyLoaded"
            ) {
                const oldCursorComparison = compareTaskQuerySortCursors(
                    this.sorts,
                    oldCursor,
                    this._loadedBeforeCursor,
                );
                const newCursorComparison = compareTaskQuerySortCursors(
                    this.sorts,
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

        for (const subscription of this._subscriptions) {
            subscription.onVisibleTaskUpdate(context, taskId, oldTask, newTask);
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
            this.filters,
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
    public maybeAddVisibleTask(
        context: TaskRealtimeSystemActionContext,
        taskId: TaskId,
        task: TaskIndexDoc,
    ): {isVisible: boolean} {
        // When testing, track that the query class observes every update to a task and
        // that no updates are skipped.
        if (process.env.NODE_ENV !== "production") {
            assert(
                !assertExists(previousTaskIdByQueryForTest).get(this)?.get(taskId),
                "Query can't add task that's already visible again with `maybeAddVisibleTask()`",
            );
        }

        const isVisible = evaluateTaskQueryNormalizedFiltersForIndexDoc(this.filters, task);
        if (!isVisible) return {isVisible: false};

        const cursor = getTaskQueryNormalizedSortCursorFromIndexDoc(this.sorts, task);
        this._tree.insert(cursor);

        // If we are adding a task in the loaded range the increment our loaded count.
        if (
            this._loadedBeforeCursor !== "Unloaded" &&
            (this._loadedBeforeCursor === "FullyLoaded" ||
                compareTaskQuerySortCursors(this.sorts, cursor, this._loadedBeforeCursor) <= 0)
        ) {
            this._loadedCount++;
        }

        for (const subscription of this._subscriptions) {
            subscription.onVisibleTaskAdd(context, task);
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
