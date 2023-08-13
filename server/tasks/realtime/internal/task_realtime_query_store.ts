import {applyTaskActionToTaskIndexDoc} from "~/server/tasks/index/apply_task_action_to_task_index_doc.js";
import {mergeTaskIndexDocs} from "~/server/tasks/index/merge_task_index_docs.js";
import {getTaskIndexDocsIfExist} from "~/server/tasks/index/task_index.js";
import {TaskIndexDoc} from "~/server/tasks/index/task_index_doc.js";
import {TaskRealtimeActionContext} from "~/server/tasks/realtime/internal/task_realtime_action_context.js";
import {ReadonlyTaskRealtimeActionHistory} from "~/server/tasks/realtime/internal/task_realtime_action_history.js";
import {TaskRealtimeQuery} from "~/server/tasks/realtime/internal/task_realtime_query.js";
import {InternalError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {stringifyForDeepEqualCheck} from "~/shared/helpers/control/stringify_for_deep_equal_check.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

/**
 * This class is the main component of our task realtime implementation. It
 * keeps track of queries and tasks that clients are subscribed to and keeps
 * them up-to-date in realtime for a space.
 *
 * The store itself has a map of `TaskId`s to task objects and a set of
 * subscribed queries. When you load a query we check to see if the exact query
 * already exists, if it doesn't then we load the query fresh and start
 * tracking it in our store.
 *
 * Whenever the task realtime server receives a new action transaction, it must
 * add it to the realtime action history and apply it to the relevant store.
 */
// NOCOMMIT: Figure out error handling...
export class TaskRealtimeQueryStore {
    private readonly _internal: TaskRealtimeQueryStoreInternal;

    constructor(options: {
        spaceId: SpaceId;
        actionHistory: ReadonlyTaskRealtimeActionHistory;
        ensureFullActionHistory: (context: TaskRealtimeActionContext) => Promise<void>;
    }) {
        this._internal = new TaskRealtimeQueryStoreInternal(options);

        if (process.env.NODE_ENV !== "production") {
            this._internal.assertCorrectForTest();
        }
    }

    public async loadQuery(
        context: TaskRealtimeActionContext,
        options: {
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            limit: number;
        },
    ): Promise<{
        tasks: Array<TaskIndexDoc>;
        hasMoreTasks: boolean;
    }> {
        let promise = this._internal.loadQuery(context, options);

        // Make sure our store's state is correct after loading a query...
        if (process.env.NODE_ENV !== "production") {
            promise = promise.then(result => {
                this._internal.assertCorrectForTest();
                return result;
            });
        }

        return promise;
    }

    public applyActionTransaction(
        context: TaskRealtimeActionContext,
        actions: ReadonlyArray<TaskAction>,
    ): Promise<void> {
        let promise = this._internal.applyActionTransaction(context, actions);

        // Make sure our store's state is correct after an action transaction...
        if (process.env.NODE_ENV !== "production") {
            promise = promise.then(() => {
                this._internal.assertCorrectForTest();
            });
        }

        return promise;
    }
}

type TaskRealtimeQueryStoreTaskEntry = {
    task: TaskIndexDoc;
    readonly visibleInQueries: Set<TaskRealtimeQuery>;
};

// Our store implementation has some public methods that `TaskRealtimeQuery` is
// allowed to call but external users of `TaskRealtimeQueryStore` should not
// (e.g. `onQueryTasksLoad`). These methods are public on this internal class
// and we have a wrapper `TaskRealtimeQueryStore` class with a public interface.
export class TaskRealtimeQueryStoreInternal {
    public readonly spaceId: SpaceId;
    private readonly _actionHistory: ReadonlyTaskRealtimeActionHistory;

    /**
     * Ensure that we have a full action history for this store's space when the
     * promise resolves. If our service was recently discovered that means we
     * haven't been receiving actions so we don't have a full view of history.
     */
    public readonly ensureFullActionHistory: (context: TaskRealtimeActionContext) => Promise<void>;

    /**
     * All the queries maintained by our query store. The queries are keyed by
     * `{filters, sorts}` stringified by `stringifyForDeepEqualCheck()`. This
     * allows us to efficiently reuse a query that shares normalized filters
     * and sorts.
     */
    // NOCOMMIT: Query eviction if there are no subscribers
    private readonly _queries = new Map<string, TaskRealtimeQuery>();

    /**
     * Multiple queries may refer to the same task so we store task objects here
     * instead of in `TaskRealtimeQuery`. We keep a reference to all the queries
     * which subscribe to the task and evict any tasks that have no subscribed
     * queries.
     */
    private readonly _taskEntryById = new Map<TaskId, TaskRealtimeQueryStoreTaskEntry>();

    /**
     * If we see an action that affects a task in a way that might make it visible
     * in one of our queries then we need to load the full task from OpenSearch so
     * we can add it to the query (after confirming the task matches our query's
     * filters).
     *
     * If we are currently loading a task it will show up in this map. That way we
     * can dedupe requests to load tasks.
     */
    private readonly _loadingTaskPromiseById = new Map<
        TaskId,
        Promise<TaskRealtimeQueryStoreTaskEntry | null>
    >();

    private _scheduledTaskLoadBatch: Array<{
        readonly taskId: TaskId;
        readonly promiseResolver: PromiseResolver<TaskRealtimeQueryStoreTaskEntry | null>;
    }> | null = null;

    constructor({
        spaceId,
        actionHistory,
        ensureFullActionHistory,
    }: {
        spaceId: SpaceId;
        actionHistory: ReadonlyTaskRealtimeActionHistory;
        ensureFullActionHistory: (context: TaskRealtimeActionContext) => Promise<void>;
    }) {
        this.spaceId = spaceId;
        this._actionHistory = actionHistory;
        this.ensureFullActionHistory = ensureFullActionHistory;
    }

    public assertCorrectForTest() {
        // We run this validation in `development` and `test` since maintaining state
        // correctly across the store and query class is a little tricky to get right
        // but critical to the operation of the task realtime service.
        assert(process.env.NODE_ENV !== "production");

        const visibleTaskIdsByQuery = new Map<TaskRealtimeQuery, Set<TaskId>>();

        for (const query of this._queries.values()) {
            const {visibleTaskIds} = query.assertCorrectForTest();
            visibleTaskIdsByQuery.set(query, visibleTaskIds);
        }

        for (const [taskId, taskEntry] of this._taskEntryById) {
            for (const query of taskEntry.visibleInQueries) {
                assert(
                    visibleTaskIdsByQuery.get(query)?.has(taskId),
                    "Store thinks task is visible in query but query disagrees",
                );
            }
        }
    }

    /**
     * Is the provided `TaskId` visible some query?
     */
    public isTaskVisibleInQuery(query: TaskRealtimeQuery, taskId: TaskId): boolean {
        return this._taskEntryById.get(taskId)?.visibleInQueries.has(query) ?? false;
    }

    /**
     * Gets a task on behalf of a query. The task must be visible in the query
     * or else we'll throw an error.
     */
    public getTaskForQuery(query: TaskRealtimeQuery, taskId: TaskId): TaskIndexDoc {
        const taskEntry = this._taskEntryById.get(taskId);
        assert(taskEntry?.visibleInQueries.has(query));
        return taskEntry!.task;
    }

    /**
     * Executes a query and keeps it up-to-date in realtime as long as there are
     * subscribers. If an equivalent query is already in our store then we reuse
     * the already loaded data from that query.
     *
     * May return fewer tasks than we requested with `limit`. This happens in
     * realtime edge cases where we start loading tasks before a realtime event
     * that moves tasks outside of the loaded range. Also remember that we start
     * loading tasks from OpenSearch which is ~60s behind. Up to the client to
     * check how many tasks were loaded and decide whether they need to load
     * more tasks.
     */
    public async loadQuery(
        context: TaskRealtimeActionContext,
        {
            filters,
            sorts,
            limit,
        }: {
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            limit: number;
        },
    ): Promise<{
        tasks: Array<TaskIndexDoc>;
        hasMoreTasks: boolean;
    }> {
        // NOCOMMIT: Evict if there are no subscribers?
        const query = getOrSetDefaultMapValue(
            this._queries,
            stringifyForDeepEqualCheck({filters, sorts}),
            () => new TaskRealtimeQuery(this, {filters, sorts}),
        );

        // Load enough tasks to satisfy our `limit`.
        await query.loadMoreTasks(context, limit - query.getLoadedTaskCount());

        return {
            tasks: query.getLoadedTasks(),
            hasMoreTasks: query.hasMoreUnloadedTasks(),
        };
    }

    /**
     * Called after we execute a query in OpenSearch with the tasks returned by
     * OpenSearch.
     *
     * You should make sure you've called `ensureFullActionHistory()` before
     * calling this function! It will iterate over our action history to catch
     * up tasks so we need to make sure we have the actions we need loaded.
     *
     * This function:
     *
     * - Adds tasks into to our store (or updates tasks already in the store).
     * - For tasks newly added to the store (we call these "fresh" tasks) iterate
     *   through our action history to catch them up.
     * - While iterating through our action history, if we see a task that might be
     *   visible in the query but was not in the stale search result then load the
     *   task (if it's not already loaded) and test it against the query's filters.
     * - Remove any tasks from the search result that are no longer visible.
     */
    public onQueryTasksLoad(
        context: TaskRealtimeActionContext,
        query: TaskRealtimeQuery,
        tasks: ReadonlyArray<TaskIndexDoc>,
    ): Promise<void> {
        const maybeAddVisibleTaskIdsToLoad = this._onQueryTasksLoadSync(context, query, tasks);
        return this._onQueryTasksLoadAsync(context, query, maybeAddVisibleTaskIdsToLoad);
    }

    // The synchronous part of `onQueryTasksLoad()`. Carefully
    // updates our data structures while assuming no concurrent code is running
    // which would observe a partial state.
    private _onQueryTasksLoadSync(
        context: TaskRealtimeActionContext,
        query: TaskRealtimeQuery,
        tasks: ReadonlyArray<TaskIndexDoc>,
    ) {
        const freshTaskIds = new Set<TaskId>();

        for (const searchedTask of tasks) {
            const taskId = searchedTask.id;
            const taskEntry = this._taskEntryById.get(taskId);

            // If we haven't seen this task before it's "fresh". The task may be outdated
            // so we'll need to apply the actions from our action history to catch it up.
            if (taskEntry === undefined) {
                freshTaskIds.add(taskId);

                this._taskEntryById.set(taskId, {
                    task: searchedTask,
                    visibleInQueries: new Set([query]),
                });
                continue;
            }

            const oldTask = taskEntry.task;
            const newTask = mergeTaskIndexDocs(oldTask, searchedTask);
            taskEntry.task = newTask;

            // If the task changed, notify queries where the task is visible. We may need
            // to remove the task from the query if it's no longer visible, we may need to
            // change the tasks's sort position, or we may need to notify subscribers about
            // the change.
            //
            // This should happen rarely but it's not impossible. It means OpenSearch is
            // ahead of the actions received by task realtime service. If OpenSearch just
            // refreshed and there's a delay in sending notifications to our service this
            // case could happen.
            if (oldTask !== newTask) {
                for (const otherQuery of taskEntry.visibleInQueries) {
                    const {isStillVisible} = otherQuery.onVisibleTaskUpdate(
                        taskId,
                        oldTask,
                        newTask,
                    );
                    if (!isStillVisible) {
                        taskEntry.visibleInQueries.delete(otherQuery);
                        if (taskEntry.visibleInQueries.size === 0) {
                            // NOCOMMIT: Evict the task after some time?
                        }
                    }
                }
            }

            const wasAlreadyVisibleInQuery = taskEntry.visibleInQueries.has(query);
            if (!wasAlreadyVisibleInQuery) taskEntry.visibleInQueries.add(query);

            // If the task is different from what we found in our search and the searched
            // task is currently stored in our query, then we need to tell the query which
            // made the search so it can update.
            //
            // If the task was already visible in our query then the query thinks the task
            // is `newTask` (thanks to the loop updating queries this task is visible in
            // above). Otherwise the query thinks the task is `searchedTask`.
            //
            // We use `mergeTaskIndexDocs()` as an equality test. Since it returns the
            // first parameter back if the first parameter didn't change.
            if (
                !wasAlreadyVisibleInQuery &&
                mergeTaskIndexDocs(searchedTask, newTask) !== searchedTask
            ) {
                const {isStillVisible} = query.onVisibleTaskUpdate(taskId, searchedTask, newTask);
                if (!isStillVisible) {
                    taskEntry.visibleInQueries.delete(query);
                    if (taskEntry.visibleInQueries.size === 0) {
                        // NOCOMMIT: Evict the task after some time?
                    }
                }
            }
        }

        const visibleTaskUpdateById = new Map<
            TaskId,
            {taskEntry: TaskRealtimeQueryStoreTaskEntry; oldTask: TaskIndexDoc}
        >();

        const maybeAddVisibleTaskIds = new Set<TaskId>();

        this._actionHistory.iterateActions(context.tracer.getTracer(), this.spaceId, action => {
            switch (action.type) {
                case "UpdateTask": {
                    const taskEntry = this._taskEntryById.get(action.taskId);

                    // If an action in our history window updated a fresh task in our query then
                    // apply that update to the fresh task to catch it up.
                    if (freshTaskIds.has(action.taskId)) {
                        assert(taskEntry);

                        const oldTask = taskEntry.task;
                        const newTask = applyTaskActionToTaskIndexDoc(
                            oldTask,
                            action.time,
                            action.taskAction,
                        );
                        taskEntry.task = newTask;

                        // We will call `query.onVisibleTaskUpdate()` once per task after our history
                        // iteration instead of once for each time a task is changed.
                        if (oldTask !== newTask && !visibleTaskUpdateById.has(action.taskId)) {
                            visibleTaskUpdateById.set(action.taskId, {taskEntry, oldTask});
                        }
                    }
                    // If an action in our history window might expose a task in our query that we
                    // haven't seen yet then we need to load the task so we can evaluate the query
                    // filter against it and if the task passes add the task to our query.
                    else if (
                        (!taskEntry || !taskEntry.visibleInQueries.has(query)) &&
                        query.mightActionAddVisibleTask(action.time, action.taskAction)
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
                        case "UpdateAccessPolicy": {
                            // Doesn't affect query
                            break;
                        }
                        default:
                            throw exhaustive(action.collectionAction);
                    }
                    break;
                }
                case "UpdateNotepadPage": {
                    cast<"Create">(action.notepadPageAction.type);
                    // Doesn't affect query
                    break;
                }
                default:
                    throw exhaustive(action);
            }
        });

        for (const [taskId, {taskEntry, oldTask}] of visibleTaskUpdateById) {
            const {isStillVisible} = query.onVisibleTaskUpdate(taskId, oldTask, taskEntry.task);
            if (!isStillVisible) {
                taskEntry.visibleInQueries.delete(query);
                if (taskEntry.visibleInQueries.size === 0) {
                    // NOCOMMIT: Evict the task after some time?
                }
            }
        }

        const maybeAddVisibleTaskIdsToLoad: Array<TaskId> = [];

        for (const taskId of maybeAddVisibleTaskIds) {
            const taskEntry = this._taskEntryById.get(taskId);
            // If we haven't loaded this task into our store yet, we need to first load it
            // and then we can try adding it to the query.
            if (taskEntry === undefined) {
                maybeAddVisibleTaskIdsToLoad.push(taskId);
                continue;
            }

            const {isVisible} = query.maybeAddVisibleTask(taskId, taskEntry.task);
            if (isVisible) {
                taskEntry.visibleInQueries.add(query);
            }
        }

        return maybeAddVisibleTaskIdsToLoad;
    }

    private async _onQueryTasksLoadAsync(
        context: TaskRealtimeActionContext,
        query: TaskRealtimeQuery,
        maybeAddVisibleTaskIdsToLoad: Array<TaskId>,
    ) {
        await runAllPromises(
            maybeAddVisibleTaskIdsToLoad.map(taskId =>
                retryWithExponentialBackoff(async retry => {
                    const taskEntry = await this._loadTaskIfExists(context, taskId);

                    if (!taskEntry) {
                        throw retry(
                            new InternalError(
                                "Task not found in index, we saw an update action which means the task should eventually exist",
                            ),
                        );
                    }

                    // If the task is still not visible in this query (some concurrent process may
                    // have made it visible) then attempt to add the task to the query given the
                    // task passes the query's filters.
                    if (!taskEntry.visibleInQueries.has(query)) {
                        const {isVisible} = query.maybeAddVisibleTask(taskId, taskEntry.task);
                        if (isVisible) {
                            taskEntry.visibleInQueries.add(query);
                        }
                    }
                }),
            ),
        );
    }

    /**
     * Apply a committed action transaction to our store after we've added the
     * transaction to our action history. Does the following:
     *
     * - Reports any updates to subscribed queries
     * - If the transaction hides a task in a query then we remove the task from
     *   the query
     * - We iterate through all queries to see if an updated task that was hidden
     *   in the query will now be visible
     * - If the transaction updates a task that's not in our store then we ignore
     *   it unless we suspect the updated task will be visible in a query, then we
     *   load the task from OpenSearch and check
     */
    public applyActionTransaction(
        context: TaskRealtimeActionContext,
        actions: ReadonlyArray<TaskAction>,
    ): Promise<void> {
        const queriesByMaybeAddVisibleTaskIdToLoad = this._applyActionTransactionSync(actions);
        return this._applyActionTransactionAsync(context, queriesByMaybeAddVisibleTaskIdToLoad);
    }

    // The synchronous part of `applyActionTransaction()`. Carefully updates our
    // data structures while assuming no concurrent code is running which would
    // observe a partial state.
    private _applyActionTransactionSync(actions: ReadonlyArray<TaskAction>) {
        const updatedTaskEntriesById = new Map<
            TaskId,
            {taskEntry: TaskRealtimeQueryStoreTaskEntry; oldTask: TaskIndexDoc}
        >();

        const queriesByMaybeAddVisibleTaskIdToLoad = new Map<TaskId, Set<TaskRealtimeQuery>>();

        for (const action of actions) {
            switch (action.type) {
                case "UpdateTask": {
                    const taskEntry = this._taskEntryById.get(action.taskId);

                    if (taskEntry !== undefined) {
                        const oldTask = taskEntry.task;
                        const newTask = applyTaskActionToTaskIndexDoc(
                            oldTask,
                            action.time,
                            action.taskAction,
                        );
                        taskEntry.task = newTask;

                        // We will call `query.onVisibleTaskUpdate()` once per task after our history
                        // iteration instead of once for each time a task is changed.
                        //
                        // We will also call `query.maybeAddVisibleTask()` on all our other queries in
                        // case this task should appear there.
                        if (oldTask !== newTask && !updatedTaskEntriesById.has(action.taskId)) {
                            updatedTaskEntriesById.set(action.taskId, {taskEntry, oldTask});
                        }
                    }
                    // If we do not have an entry for this task, then check with all our queries to
                    // see if this action might result in a new visible task. We need to load these
                    // tasks to fully compare them against the query's filters.
                    else {
                        for (const query of this._queries.values()) {
                            if (query.mightActionAddVisibleTask(action.time, action.taskAction)) {
                                getOrSetDefaultMapValue(
                                    queriesByMaybeAddVisibleTaskIdToLoad,
                                    action.taskId,
                                    () => new Set(),
                                ).add(query);
                            }
                        }
                    }
                    break;
                }
                case "UpdateCollection": {
                    switch (action.collectionAction.type) {
                        case "Create":
                        case "Delete":
                        case "Undelete":
                        case "UpdateName":
                        case "UpdateAccessPolicy": {
                            // Doesn't affect query
                            break;
                        }
                        default:
                            throw exhaustive(action.collectionAction);
                    }
                    break;
                }
                case "UpdateNotepadPage": {
                    cast<"Create">(action.notepadPageAction.type);
                    // Doesn't affect query
                    break;
                }
                default:
                    throw exhaustive(action);
            }
        }

        for (const [taskId, {taskEntry, oldTask}] of updatedTaskEntriesById) {
            const newlyVisibleInQueries = new Set();

            // For queries this task is not currently visible in, see if it is now visible.
            for (const query of this._queries.values()) {
                if (taskEntry.visibleInQueries.has(query)) continue;

                const {isVisible} = query.maybeAddVisibleTask(taskId, taskEntry.task);
                if (isVisible) {
                    newlyVisibleInQueries.add(query);
                    taskEntry.visibleInQueries.add(query);
                }
            }

            // For queries this task is currently visible in, update the query and see if
            // the task is now hidden from the query.
            for (const query of taskEntry.visibleInQueries) {
                if (newlyVisibleInQueries.has(query)) continue;

                const {isStillVisible} = query.onVisibleTaskUpdate(taskId, oldTask, taskEntry.task);
                if (!isStillVisible) {
                    taskEntry.visibleInQueries.delete(query);
                    if (taskEntry.visibleInQueries.size === 0) {
                        // NOCOMMIT: Evict the task after some time?
                    }
                }
            }
        }

        return queriesByMaybeAddVisibleTaskIdToLoad;
    }

    private async _applyActionTransactionAsync(
        context: TaskRealtimeActionContext,
        queriesByMaybeAddVisibleTaskIdToLoad: Map<TaskId, Set<TaskRealtimeQuery>>,
    ) {
        await runAllPromises(
            Array.from(queriesByMaybeAddVisibleTaskIdToLoad, ([taskId, queries]) =>
                retryWithExponentialBackoff(async retry => {
                    const taskEntry = await this._loadTaskIfExists(context, taskId);

                    if (!taskEntry) {
                        throw retry(
                            new InternalError(
                                "Task not found in index, we saw an update action which means the task should eventually exist",
                            ),
                        );
                    }

                    for (const query of queries) {
                        // If the task is still not visible in this query (some concurrent process may
                        // have made it visible) then attempt to add the task to the query given the
                        // task passes the query's filters.
                        if (!taskEntry.visibleInQueries.has(query)) {
                            const {isVisible} = query.maybeAddVisibleTask(taskId, taskEntry.task);
                            if (isVisible) {
                                taskEntry.visibleInQueries.add(query);
                            }
                        }
                    }
                }),
            ),
        );
    }

    /**
     * Load an entry for a task from OpenSearch and put it in `taskEntryById`.
     *
     * Batches and dedupes load requests behind the scenes.
     */
    private _loadTaskIfExists(
        context: TaskRealtimeActionContext,
        taskId: TaskId,
    ): Promise<TaskRealtimeQueryStoreTaskEntry | null> {
        const taskEntry = this._taskEntryById.get(taskId);

        // If we've already loaded the task, great! No need to load it now.
        if (taskEntry !== undefined) return Promise.resolve(taskEntry);

        return getOrSetDefaultMapValue(this._loadingTaskPromiseById, taskId, () => {
            if (!this._scheduledTaskLoadBatch) {
                this._scheduledTaskLoadBatch = [];

                scheduleMicrotask(() => {
                    assert(this._scheduledTaskLoadBatch);
                    const taskLoadBatch = this._scheduledTaskLoadBatch;
                    this._scheduledTaskLoadBatch = null;

                    this._executeLoadTaskBatch(context, taskLoadBatch).catch(error => {
                        for (const {promiseResolver} of taskLoadBatch) {
                            promiseResolver.reject(error);
                        }
                    });
                });
            }

            const promiseResolver = createPromiseResolver<TaskRealtimeQueryStoreTaskEntry | null>();
            this._scheduledTaskLoadBatch.push({taskId, promiseResolver});

            // Once the promise has settled, delete it from `loadingTaskPromiseById`. You
            // can now get the task from `taskEntryById`.
            //
            // If the task entry is evicted then we should create a new loading promise.
            promiseResolver.promise.finally(() => {
                this._loadingTaskPromiseById.delete(taskId);
            });

            return promiseResolver.promise;
        });
    }

    private async _executeLoadTaskBatch(
        context: TaskRealtimeActionContext,
        taskLoadBatch: Array<{
            taskId: TaskId;
            promiseResolver: PromiseResolver<TaskRealtimeQueryStoreTaskEntry | null>;
        }>,
    ): Promise<void> {
        const tasks = await getTaskIndexDocsIfExist(
            context,
            this.spaceId,
            taskLoadBatch.map(({taskId}) => taskId),
        );

        this._executeLoadTaskBatchSync(context, taskLoadBatch, tasks);
    }

    // The synchronous part of `_loadTaskBatch()` to be run after the network
    // request. It's useful to make this synchronous since we'll be updating our
    // internal store state and we don't want to think about concurrent
    // readers/writers.
    private _executeLoadTaskBatchSync(
        context: TaskRealtimeActionContext,
        taskLoadBatch: Array<{
            taskId: TaskId;
            promiseResolver: PromiseResolver<TaskRealtimeQueryStoreTaskEntry | null>;
        }>,
        tasks: Array<TaskIndexDoc | null>,
    ): void {
        const freshTaskById = new Map<
            TaskId,
            {
                freshTask: TaskIndexDoc;
                promiseResolver: PromiseResolver<TaskRealtimeQueryStoreTaskEntry | null>;
            }
        >();

        // Check if any of the tasks were loaded concurrently while we were waiting on
        // our network request. We can immediately resolve any that were.
        for (let i = 0; i < taskLoadBatch.length; i++) {
            const {taskId, promiseResolver} = taskLoadBatch[i]!;
            const taskEntry = this._taskEntryById.get(taskId);

            if (taskEntry !== undefined) {
                promiseResolver.resolve(taskEntry);
            } else {
                const task = tasks[i];
                if (!task) {
                    promiseResolver.resolve(null);
                } else {
                    freshTaskById.set(taskId, {freshTask: task, promiseResolver});
                }
            }
        }

        // Catch up our tasks are freshly loaded from OpenSearch with any actions
        // in our history so they're up-to-date in realtime.
        for (const [taskId, {freshTask, promiseResolver}] of freshTaskById) {
            let task = freshTask;

            this._actionHistory.iterateTaskActions(
                context.tracer.getTracer(),
                this.spaceId,
                taskId,
                (actionTime, action) => {
                    task = applyTaskActionToTaskIndexDoc(task, actionTime, action);
                },
            );

            const taskEntry: TaskRealtimeQueryStoreTaskEntry = {
                task,
                // NOCOMMIT: Evict if we don't get a query
                visibleInQueries: new Set([]),
            };

            this._taskEntryById.set(taskId, taskEntry);

            promiseResolver.resolve(taskEntry);
        }
    }
}
