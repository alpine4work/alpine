import {RBTree} from "bintrees";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {OpensearchClientDocWithId} from "~/server/opensearch/opensearch_client.js";
import {applyTaskActionToTaskIndexDoc} from "~/server/tasks/data/apply_task_action_to_task_index_doc.js";
import {applyTaskUpdateAccountNameToTaskIndexDoc} from "~/server/tasks/data/apply_task_update_account_name_to_task_index_doc.js";
import {evaluateTaskQueryNormalizedFiltersForIndexDoc} from "~/server/tasks/data/evaluate_task_query_normalized_filters_for_index_doc.js";
import {getTaskQueryNormalizedSortCursorForIndexDoc} from "~/server/tasks/data/get_task_query_normalized_sort_cursor_for_index_doc.js";
import {TaskSystemActionContext} from "~/server/tasks/data/task_action_context.js";
import {queryTaskIndex} from "~/server/tasks/data/task_index.js";
import {TaskIndexActualDoc, TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {mightTaskActionAddTaskToQueryLoadedRange} from "~/server/tasks/realtime/might_task_action_add_task_to_query_loaded_range.js";
import {TaskRealtimeQuerySubscriptionInternal} from "~/server/tasks/realtime/task_realtime_query_subscription.js";
import {
    TaskRealtimeStoreInternal,
    TaskRealtimeStoreTaskEntry,
} from "~/server/tasks/realtime/task_realtime_store.js";
import {TaskRealtimeUpdateEventBuilderBase} from "~/server/tasks/realtime/task_realtime_update_event_builder.js";
import {CancelledError, InternalError} from "~/shared/error/error.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskTaskAction} from "~/shared/tasks/actions/task_task_action.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    compareTaskQuerySortCursors,
} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskRealtimeQueryLoadedState} from "~/shared/tasks/task_realtime_protocol.js";

// Keep track of the previous task object the query saw so we can check if
// we've missed any updates. We run this validation in `development` and
// `test` since maintaining task update state correctly is a little tricky to
// get right but critical to the operation of this class.
const previousTaskByIdByQueryForTest =
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
 * Works closely with `TaskRealtimeStore` where the subscribed tasks in a
 * space are stored and kept up-to-date in realtime. This class does not hold
 * the task objects themselves, since multiple queries can reference the same
 * task tasks are stored in `TaskRealtimeStore` (which also owns query
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
    public readonly store: TaskRealtimeStoreInternal;
    public readonly filters: TaskQueryNormalizedFilters;
    public readonly sorts: ReadonlyArray<TaskQueryNormalizedSort>;

    private _isDestroyed = false;

    /**
     * Tasks in a query are represented with a red-black tree. We use a red-black
     * tree to get O(log(n)) insertion/removal of tasks at any point in the list.
     *
     * We only store task cursors in our tree (to establish order). The full task
     * object can be found in `TaskRealtimeStore` which is shared across all
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

    /**
     * Subscriptions to a query are managed in another class. Each subscription has
     * its own loaded range since it maps to a client's loaded range. Each
     * subscription also loads referenced parent tasks and collections then keeps
     * track of updates to them.
     */
    private readonly _subscriptions = new Set<TaskRealtimeQuerySubscriptionInternal>();

    constructor(
        store: TaskRealtimeStoreInternal,
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

        this.store.addEvictableQuery(this);
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
                "Task visible in query but store doesn’t know",
            );

            const task = this.store.getTaskForQuery(this, taskId);

            assert(
                isDeepEqual(cursor, getTaskQueryNormalizedSortCursorForIndexDoc(this.sorts, task)),
                "Task cursor in query does not match expected cursor from task in store",
            );

            assert(
                evaluateTaskQueryNormalizedFiltersForIndexDoc(this.filters, task),
                "Task visible in query should pass the query’s filters",
            );
        }

        assert(
            this._loadedCount === expectedLoadedCount,
            "Query loaded task count does not equal expected loaded task count",
        );

        for (const subscription of this._subscriptions) {
            subscription.assertCorrectForTest();
        }

        return {visibleTaskIds};
    }

    public destroy() {
        assert(!this._isDestroyed);
        this._isDestroyed = true;

        const iterator = this._tree.iterator();
        let cursor: TaskQuerySortCursor | null;
        while ((cursor = iterator.next()) !== null) {
            const taskId = cursor[cursor.length - 1] as TaskId;
            const taskEntry = assertExists(this.store.getTaskEntryIfExists(taskId));
            taskEntry.removeQueryDependent(this);
        }
    }

    public addSubscription(subscription: TaskRealtimeQuerySubscriptionInternal) {
        assert(!this._isDestroyed);
        const wasEvictable = this._subscriptions.size === 0;
        this._subscriptions.add(subscription);
        if (wasEvictable) this.store.removeEvictableQuery(this);
    }

    public removeSubscription(subscription: TaskRealtimeQuerySubscriptionInternal) {
        assert(!this._isDestroyed);
        this._subscriptions.delete(subscription);
        const isEvictable = this._subscriptions.size === 0;
        if (isEvictable) this.store.addEvictableQuery(this);
    }

    /**
     * How many tasks are in our query's loaded range?
     */
    public getLoadedTaskCount(): number {
        return this._loadedCount;
    }

    /**
     * Gets some number of loaded tasks from this query after `afterCursor`.
     *
     * Will return a `loadedState` you can use to paginate through the rest of the
     * query. If you are in a `Partial` loaded state then you may call this
     * function again with `endCursor` as `afterCursor` to get the next page.
     */
    public getLoadedTasks({
        limit,
        afterCursor,
    }: {
        limit: number;
        afterCursor: TaskQuerySortCursor | null;
    }): {
        loadedState: TaskRealtimeQueryLoadedState;
        tasks: Array<TaskIndexDoc>;
    } {
        assert(!this._isDestroyed);

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

        let lastCursor: TaskQuerySortCursor | null = afterCursor;
        let loadedState: TaskRealtimeQueryLoadedState;
        while (true) {
            const cursor = afterCursorIterator.data();
            if (cursor === null) {
                if (this._loadedBeforeCursor === "FullyLoaded") {
                    loadedState = {type: "Full"};
                } else {
                    loadedState = {
                        type: "Partial",
                        endCursor:
                            this._loadedBeforeCursor !== "Unloaded"
                                ? this._loadedBeforeCursor
                                : null,
                    };
                }
                break;
            }
            afterCursorIterator.next();

            // Once we've reached our limit we can stop adding tasks.
            if (typeof limit === "number" && tasks.length >= limit) {
                loadedState = {type: "Partial", endCursor: lastCursor};
                break;
            }

            // If we reached the `loadedBeforeCursor` barrier then we can only ever be
            // partially loaded stopping at that barrier. We don't use `lastCursor` since
            // we haven't hit our limit.
            if (
                this._loadedBeforeCursor === "Unloaded" ||
                (this._loadedBeforeCursor !== "FullyLoaded" &&
                    compareTaskQuerySortCursors(this.sorts, cursor, this._loadedBeforeCursor) > 0)
            ) {
                loadedState = {
                    type: "Partial",
                    endCursor:
                        this._loadedBeforeCursor !== "Unloaded" ? this._loadedBeforeCursor : null,
                };
                break;
            }

            const taskId = cursor[cursor.length - 1] as TaskId;
            tasks.push(this.store.getTaskForQuery(this, taskId));
            lastCursor = cursor;
        }

        return {
            loadedState,
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
    public async loadMoreTasks(context: TaskSystemActionContext, limit: number): Promise<void> {
        assert(!this._isDestroyed);
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

            // If the query was destroyed while we were loading, don't continue updating
            // the query's state.
            if (this._isDestroyed)
                throw new CancelledError("Query was destroyed while loading data");
        }

        this._loadingState = {
            limit,
            promise: this._loadMoreTasks(context, limit),
        };
        void this._loadingState.promise.finally(() => (this._loadingState = null));

        return this._loadingState.promise;
    }

    /**
     * Actually loads more tasks into the query. You're guaranteed that there's
     * only one call to this function ongoing at a time.
     *
     * At a high level this function loads tasks from OpenSearch and puts them in
     * our store. For tasks that are already in our store we use their data and
     * ignore the loaded task. Then we run our entire action history to see if we
     * need to add tasks that were recently made visible in the query and update
     * stale tasks returned by the query.
     *
     * To break it down a little more, the procedure is:
     *
     * 1. Executes our query in OpenSearch starting at `loadedBeforeCursor` and
     *    loads `limit` tasks.
     *
     * 2. If our server just started we will kick off a backfill of the action
     *    history for this space. We need a full action history to catch up our
     *    stale tasks from OpenSearch. (This is the
     *    `store.ensureFullActionHistory()` call.)
     *
     * 3. Extend our query's loaded range by updating `loadedBeforeCursor`.
     *
     * 4. Add loaded tasks to our query which already have an entry in our store.
     *    We discard the loaded task object and use the task object from our store.
     *
     * 5. Iterate through our entire action history looking for: 1) updates to
     *    freshly loaded tasks, 2) tasks that may have been made visible by a
     *    recent action that wasn't returned in our query.
     *
     * 6. Added freshly loaded tasks to our query if they're still visible after
     *    applying updates from action history.
     *
     * 7. Load tasks from step 5 we think we might need to add to our query and
     *    test if they are actually visible in our query or not.
     */
    private async _loadMoreTasks(context: TaskSystemActionContext, limit: number): Promise<void> {
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
            // `_loadMoreTasksSync()` which needs the action history to catch up our
            // OpenSearch query result.
            this.store.ensureFullActionHistory(context),
        ]);

        // If the query was destroyed while we were loading, don't continue updating
        // the query's state.
        if (this._isDestroyed) throw new CancelledError("Query was destroyed while loading data");

        const maybeAddVisibleTaskLoadPromise = this._loadMoreTasksSync(
            context,
            limit,
            afterCursor,
            tasks,
        );

        await maybeAddVisibleTaskLoadPromise;

        // NOTE(calebmer): It's possible that we get here and one or more tasks have
        // been moved outside of our loaded range because the task data in our store
        // was different. If that happens we don't have enough tasks to address `limit`
        // anymore. We could call `loadMore()` and keep looping until we have enough
        // tasks. Not implementing this for now since I believe it's a little better to
        // return what we have to the client and let the client choose to load more
        // instead of spending more time trying to load tasks.
        //
        // When we're missing only one or two tasks it's likely the client won't have
        // reached its "load more" threshold and we'll have delayed returning data to
        // the user unnecessarily.
    }

    // The synchronous part of `_loadMoreTasks()`. We update our query and store's
    // internal state. We force this part to be synchronous so we know there are no
    // concurrent code running.
    //
    // We do return a promise for some async followup work but this function should
    // not be marked as `async`!
    private _loadMoreTasksSync(
        context: TaskSystemActionContext,
        limit: number,
        afterCursor: TaskQuerySortCursor | null,
        loadedTasks: Array<OpensearchClientDocWithId<TaskId, TaskIndexActualDoc>>,
    ): Promise<unknown> {
        const addVisibleTask = (taskEntry: TaskRealtimeStoreTaskEntry) => {
            const cursor = getTaskQueryNormalizedSortCursorForIndexDoc(this.sorts, taskEntry.task);

            // If our fresh task wants to go into our already loaded range then ignore it!
            // We can't send realtime events to clients while loading more tasks. Adding a
            // new task to the query's loaded range requires a realtime event.
            //
            // We'll add the task to our query when our realtime server receives an action
            // that does this and we can send that action to clients.
            //
            // This usually happens when OpenSearch has applied an action before our
            // realtime server which should be rare.
            if (
                afterCursor !== null &&
                compareTaskQuerySortCursors(this.sorts, afterCursor, cursor) >= 0
            ) {
                return;
            }

            taskEntry.addQueryDependent(this);
            this._tree.insert(cursor);

            // Applying actions from our action history may have moved the task out of our
            // loaded range.
            if (
                this._loadedBeforeCursor !== "Unloaded" &&
                (this._loadedBeforeCursor === "FullyLoaded" ||
                    compareTaskQuerySortCursors(this.sorts, cursor, this._loadedBeforeCursor) <= 0)
            ) {
                this._loadedCount++;
            }

            // When testing, track that the task has been added to the query.
            if (process.env.NODE_ENV !== "production") {
                getOrSetDefaultMapValue(
                    assertExists(previousTaskByIdByQueryForTest),
                    this,
                    () => new Map(),
                ).set(taskEntry.task.id, taskEntry.task);
            }
        };

        const freshTaskEntryById = new Map<
            TaskId,
            {taskEntry: TaskRealtimeStoreTaskEntry; oldTask: TaskIndexDoc}
        >();

        const hasMoreLoadedTasks = loadedTasks.length > limit;

        // Throw away any extra tasks we loaded to check if there are more tasks in
        // the query.
        while (loadedTasks.length > limit) {
            loadedTasks.pop();
        }

        const lastLoadedTask = loadedTasks.length > 0 ? loadedTasks[loadedTasks.length - 1]! : null;

        // Extend our query's loaded range...
        if (lastLoadedTask === null) {
            this._loadedBeforeCursor = hasMoreLoadedTasks
                ? this._loadedBeforeCursor
                : "FullyLoaded";
        } else {
            const lastCursor = getTaskQueryNormalizedSortCursorForIndexDoc(
                this.sorts,
                lastLoadedTask,
            );
            this._loadedBeforeCursor = hasMoreLoadedTasks ? lastCursor : "FullyLoaded";
        }

        // Count up all the visible tasks in our query that are now loaded...
        if (this._loadedBeforeCursor !== "Unloaded") {
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

            while (true) {
                const cursor = afterCursorIterator.data();
                if (cursor === null) break;
                afterCursorIterator.next();

                if (
                    this._loadedBeforeCursor !== "FullyLoaded" &&
                    compareTaskQuerySortCursors(this.sorts, cursor, this._loadedBeforeCursor) > 0
                ) {
                    break;
                }

                this._loadedCount++;
            }
        }

        for (const {
            lastIndexSearchEntityJob,
            approximateActionCountByAccountId,
            ...loadedTask
        } of loadedTasks) {
            const {isFresh, taskEntry} = this.store.ensureTaskEntry(loadedTask);

            // Fresh task entries aren't up-to-date in realtime. We need to run our action
            // history against them to catch the tasks up. So put them in a set and add
            // them to the query later...
            if (isFresh) {
                freshTaskEntryById.set(taskEntry.task.id, {taskEntry, oldTask: taskEntry.task});
                continue;
            }

            // If the task is already in the store and already visible in our query we
            // don't need to add it to the query a second time.
            if (taskEntry.hasQueryDependent(this)) {
                continue;
            }

            // Re-evaluate our filters against the task from our store just in case it
            // doesn't pass the query's filters anymore. If the task doesn't pass our
            // query's filters then leave it out of the query.
            if (!evaluateTaskQueryNormalizedFiltersForIndexDoc(this.filters, taskEntry.task)) {
                continue;
            }

            addVisibleTask(taskEntry);
        }

        const maybeAddVisibleTaskIds = new Set<TaskId>();

        this.store.actionHistory.iterateActions(
            context.tracer.getTracer(),
            this.store.spaceId,
            (action, {getActionReferencedSortableAccount}) => {
                switch (action.type) {
                    case "UpdateTask": {
                        const freshTaskEntry = freshTaskEntryById.get(action.taskId)?.taskEntry;

                        // If an action in our history window updated a fresh task in our query then
                        // apply that update to the fresh task to catch it up.
                        if (freshTaskEntry !== undefined) {
                            const oldTask = freshTaskEntry.task;
                            const newTask = applyTaskActionToTaskIndexDoc(
                                oldTask,
                                action.time,
                                action.taskAction,
                                getActionReferencedSortableAccount,
                            );
                            freshTaskEntry.task = newTask;
                        }
                        // If an action in our history window might expose a task in our query that we
                        // haven't seen yet then we need to load the task so we can evaluate the query
                        // filter against it and if the task passes add the task to our query.
                        else if (
                            !this.store.isTaskVisibleInQuery(this, action.taskId) &&
                            this.mightActionAddTaskToLoadedRange(action.time, action.taskAction)
                        ) {
                            maybeAddVisibleTaskIds.add(action.taskId);
                        }
                        break;
                    }
                    case "UpdateCollection": {
                        switch (action.collectionAction.type) {
                            case "Create":
                            case "Delete":
                            case "Undelete":
                            case "UpdateName":
                            case "UpdateColor":
                            case "UpdateAccessPolicy": {
                                // Doesn't affect query
                                break;
                            }
                            default:
                                throw exhaustive(action.collectionAction);
                        }
                        break;
                    }
                    case "UpdateAccountName": {
                        for (const {taskEntry: freshTaskEntry} of freshTaskEntryById.values()) {
                            const oldTask = freshTaskEntry.task;
                            const newTask = applyTaskUpdateAccountNameToTaskIndexDoc(
                                oldTask,
                                action,
                            );

                            // If nothing changed in the task (probably because the account is not
                            // referenced by the task) then ignore and carry on.
                            if (oldTask === newTask) break;

                            freshTaskEntry.task = newTask;
                        }

                        // `UpdateAccountName` doesn't change whether a hidden task is now visible in
                        // our query. It can only change a task's position in a query. So we don't need
                        // to add anything to `maybeAddVisibleTaskIdsToLoad`.
                        break;
                    }
                    case "UpdateNotepadPage": {
                        break;
                    }
                    default:
                        throw exhaustive(action);
                }
            },
        );

        for (const {taskEntry, oldTask} of freshTaskEntryById.values()) {
            // Check that our fresh task is still visible after catching it up with
            // action history.
            if (
                taskEntry.task !== oldTask &&
                !evaluateTaskQueryNormalizedFiltersForIndexDoc(this.filters, taskEntry.task)
            ) {
                continue;
            }

            addVisibleTask(taskEntry);
        }

        const maybeAddVisibleTaskIdsToLoad: Array<TaskId> = [];

        for (const taskId of maybeAddVisibleTaskIds) {
            const taskEntry = this.store.getTaskEntryIfExists(taskId);

            // If we haven't loaded this task into our store yet, we need to first load it
            // and then we can try adding it to the query.
            if (taskEntry === undefined) {
                maybeAddVisibleTaskIdsToLoad.push(taskId);
                continue;
            }

            if (!evaluateTaskQueryNormalizedFiltersForIndexDoc(this.filters, taskEntry.task)) {
                continue;
            }

            addVisibleTask(taskEntry);
        }

        return runAllPromises(
            maybeAddVisibleTaskIdsToLoad.map(async taskId => {
                const taskEntry = await this.store.loadTaskEntry(context, taskId);

                // If the query was destroyed while we were loading, don't continue updating
                // the query's state.
                if (this._isDestroyed)
                    throw new CancelledError("Query was destroyed while loading data");

                // If some concurrent process added the task to our query we don't need to add
                // it again.
                if (taskEntry.hasQueryDependent(this)) return;

                // Make sure the task actually passes our query's filters. We only guessed that
                // it might pass before.
                if (!evaluateTaskQueryNormalizedFiltersForIndexDoc(this.filters, taskEntry.task)) {
                    return;
                }

                addVisibleTask(taskEntry);
            }),
        );
    }

    /**
     * When a task that's visible in our query changes `TaskRealtimeStore`
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
     * `oldTask` and `newTask` may be the same.
     *
     * If expectations fail then we throw an error in dev and test.
     */
    public onVisibleTaskUpdate(
        context: TaskSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ): {isStillVisible: boolean} {
        assert(!this._isDestroyed);

        // When testing, track that the query class observes every update to a task and
        // that no updates are skipped.
        if (process.env.NODE_ENV !== "production") {
            assert(previousTaskByIdByQueryForTest);

            const previousTaskById = getOrSetDefaultMapValue(
                previousTaskByIdByQueryForTest,
                this,
                () => new Map(),
            );

            const previousTask = previousTaskById.get(taskId);
            assert(
                previousTask,
                "Query can’t update hidden task that hasn’t been added with `maybeAddVisibleTask()`",
            );
            assert(
                previousTask === oldTask,
                "Query must observe all updates to a visible task through `onVisibleTaskUpdate()`",
            );
            previousTaskById.set(taskId, newTask);
        }

        const oldCursor = getTaskQueryNormalizedSortCursorForIndexDoc(this.sorts, oldTask);

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
                subscription.onVisibleTaskRemove(context, eventBuilder, oldTask, actions);
            }

            // When testing, track that the task has been removed from the query.
            if (process.env.NODE_ENV !== "production") {
                assertExists(previousTaskByIdByQueryForTest).get(this)?.delete(taskId);
            }

            return {isStillVisible: false};
        }

        const newCursor = getTaskQueryNormalizedSortCursorForIndexDoc(this.sorts, newTask);

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
            subscription.onVisibleTaskUpdate(
                context,
                eventBuilder,
                taskId,
                oldTask,
                newTask,
                actions,
            );
        }

        return {isStillVisible: true};
    }

    public mightActionAddTaskToLoadedRange(
        actionTime: HybridLogicalTime,
        action: TaskTaskAction,
    ): boolean {
        return mightTaskActionAddTaskToQueryLoadedRange(
            actionTime,
            action,
            this.filters,
            this.sorts,
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
        context: TaskSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        task: TaskIndexDoc,
    ): {isVisible: boolean} {
        assert(!this._isDestroyed);

        // When testing, track that the query class observes every update to a task and
        // that no updates are skipped.
        if (process.env.NODE_ENV !== "production") {
            assert(
                !assertExists(previousTaskByIdByQueryForTest).get(this)?.get(task.id),
                "Query can’t add task that’s already visible again with `maybeAddVisibleTask()`",
            );
        }

        const isVisible = evaluateTaskQueryNormalizedFiltersForIndexDoc(this.filters, task);
        if (!isVisible) return {isVisible: false};

        const cursor = getTaskQueryNormalizedSortCursorForIndexDoc(this.sorts, task);
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
            subscription.onVisibleTaskAdd(context, eventBuilder, task);
        }

        // When testing, track that the task has been added to the query.
        if (process.env.NODE_ENV !== "production") {
            assert(previousTaskByIdByQueryForTest);

            const previousTaskById = getOrSetDefaultMapValue(
                previousTaskByIdByQueryForTest,
                this,
                () => new Map(),
            );

            previousTaskById.set(task.id, task);
        }

        return {isVisible: true};
    }

    public onFatalError(context: ServerProcessContext, error: InternalError) {
        for (const subscription of this._subscriptions) {
            subscription.onFatalError(context, error);
        }
    }

    public *iterateVisibleTasksForTest(): IterableIterator<TaskIndexDoc> {
        // We run this validation in `development` and `test` since maintaining state
        // correctly across the store and query class is a little tricky to get right
        // but critical to the operation of the task realtime service.
        assert(process.env.NODE_ENV !== "production");

        const iterator = this._tree.iterator();
        let cursor: TaskQuerySortCursor | null;

        while ((cursor = iterator.next()) !== null) {
            const taskId = cursor[cursor.length - 1] as TaskId;
            yield this.store.getTaskForQuery(this, taskId);
        }
    }

    public getSubscriptionExpectedLoadedCountForTest(
        loadedBeforeCursor: TaskQuerySortCursor | "Unloaded" | "FullyLoaded",
    ): number {
        assert(process.env.NODE_ENV !== "production");

        if (this._loadedBeforeCursor === "Unloaded") {
            assert(
                loadedBeforeCursor === "Unloaded",
                "When query is unloaded, subscription should also be unloaded",
            );
        } else if (this._loadedBeforeCursor !== "FullyLoaded") {
            assert(
                loadedBeforeCursor === "Unloaded" ||
                    (loadedBeforeCursor !== "FullyLoaded" &&
                        compareTaskQuerySortCursors(
                            this.sorts,
                            loadedBeforeCursor,
                            this._loadedBeforeCursor,
                        ) <= 0),
                "When query is not fully loaded, subscription should have loaded either the same amount or less than query",
            );
        }

        const iterator = this._tree.iterator();
        let cursor: TaskQuerySortCursor | null;
        let expectedLoadedCount = 0;

        while ((cursor = iterator.next()) !== null) {
            if (
                loadedBeforeCursor !== "Unloaded" &&
                (loadedBeforeCursor === "FullyLoaded" ||
                    compareTaskQuerySortCursors(this.sorts, cursor, loadedBeforeCursor) <= 0)
            ) {
                expectedLoadedCount++;
            } else {
                break;
            }
        }

        return expectedLoadedCount;
    }
}
