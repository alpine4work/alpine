import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {applyTaskActionToTaskIndexDoc} from "~/server/tasks/data/apply_task_action_to_task_index_doc.js";
import {applyTaskCollectionActionToCollectionIndexDoc} from "~/server/tasks/data/apply_task_collection_action_to_collection_index_doc.js";
import {mergeTaskIndexDocs} from "~/server/tasks/data/merge_task_index_docs.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {
    getTaskCollectionIndexDocsIfExist,
    getTaskIndexDocsIfExist,
} from "~/server/tasks/data/task_index.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {ReadonlyTaskRealtimeActionHistory} from "~/server/tasks/realtime/task_realtime_action_history.js";
import {TaskRealtimeQuery} from "~/server/tasks/realtime/task_realtime_query.js";
import {TaskRealtimeQuerySubscription} from "~/server/tasks/realtime/task_realtime_query_subscription.js";
import {TaskRealtimeSystemActionContext} from "~/server/tasks/realtime/task_realtime_system_action_context.js";
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
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
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
        ensureFullActionHistory: (context: TaskRealtimeSystemActionContext) => Promise<void>;
    }) {
        this._internal = new TaskRealtimeQueryStoreInternal(options);

        if (process.env.NODE_ENV !== "production") {
            this._internal.assertCorrectForTest();
        }
    }

    public async loadQuery(
        context: TaskRealtimeSystemActionContext,
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
        context: TaskRealtimeSystemActionContext,
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

export const taskRealtimeQueryStoreLoadTaskTestCheckpoint = new TestCheckpoint<SpaceId>();

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
    public readonly ensureFullActionHistory: (
        context: TaskRealtimeSystemActionContext,
    ) => Promise<void>;

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
     *
     * Queries a task is visible in are accessible in the `queryDependencies` set.
     * A task may not be visible in every query whose filters pass for the task.
     * That's because when we load 100 tasks for a new query, we don't want to
     * spend the time checking whether those tasks are part of unrelated queries.
     * Queries discover new visible tasks in two ways:
     *
     * 1. When loading more tasks a query consults OpenSearch and the action
     *    history to find new visible tasks in its new loaded range
     * 2. When actions are applied a hidden task may become visible
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

    /**
     * Collections we've loaded from OpenSearch and keep up-to-date in realtime in
     * our store.
     *
     * Similar to `taskEntryById`.
     */
    private readonly _collectionEntryById = new Map<
        TaskCollectionId,
        TaskRealtimeQueryStoreCollectionEntry
    >();

    /**
     * Similar to `loadingTaskPromiseById` but for collections.
     */
    private readonly _loadingCollectionPromiseById = new Map<
        TaskCollectionId,
        Promise<TaskRealtimeQueryStoreCollectionEntry | null>
    >();

    private _scheduledCollectionLoadBatch: Array<{
        readonly collectionId: TaskCollectionId;
        readonly promiseResolver: PromiseResolver<TaskRealtimeQueryStoreCollectionEntry | null>;
    }> | null = null;

    constructor({
        spaceId,
        actionHistory,
        ensureFullActionHistory,
    }: {
        spaceId: SpaceId;
        actionHistory: ReadonlyTaskRealtimeActionHistory;
        ensureFullActionHistory: (context: TaskRealtimeSystemActionContext) => Promise<void>;
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
            for (const query of taskEntry.iterateQueryDependents()) {
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
        return this._taskEntryById.get(taskId)?.hasQueryDependent(query) ?? false;
    }

    /**
     * Get a task on behalf of a query. The task must be visible in the query.
     */
    public getTaskForQuery(query: TaskRealtimeQuery, taskId: TaskId): TaskIndexDoc {
        const taskEntry = this._taskEntryById.get(taskId);
        if (!taskEntry) throw new InternalError("Task not found in store");

        if (process.env.NODE_ENV !== "production") {
            assert(taskEntry.hasQueryDependent(query), "Task must be visible in query");
        }

        return taskEntry.getTask();
    }

    /**
     * Get a query for the provided filters and sorts. We will reuse queries with
     * identical filters and sorts. If a subscription is not promptly added then
     * the query will be evicted on the next eviction cycle.
     */
    public getQuery({
        filters,
        sorts,
    }: {
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    }) {
        // NOCOMMIT: Evict if there are no subscribers?
        return getOrSetDefaultMapValue(
            this._queries,
            stringifyForDeepEqualCheck({filters, sorts}),
            () => new TaskRealtimeQuery(this, {filters, sorts}),
        );
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
        context: TaskRealtimeSystemActionContext,
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
        context: TaskRealtimeSystemActionContext,
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

                const freshTaskEntry = new TaskRealtimeQueryStoreTaskEntry(this, searchedTask);

                freshTaskEntry.addQueryDependent(query);

                // The next time an action is applied to this task we need to loop over
                // `queries` and call `query.maybeAddVisibleTask()`. The action will not change
                // the task if OpenSearch has applied the action before us so our
                // `oldTask !== newTask` check will fail and we may miss an action that made
                // this task visible in a query where it was hidden before. This flag makes sure
                // we always test visibility in other queries for the next action in case
                // OpenSearch is ahead.
                //
                // We could loop over `queries` here but we choose to defer until the next time
                // `applyActionTransaction()` is called for this task. If the task never updates
                // then we never need to run this loop. We also don't need to pay the
                // O(freshTasks * queries) price which is unrelated the load we're performing
                // which needs fast latency.
                freshTaskEntry.shouldTryAddingToAllQueriesNextAction = true;

                this._taskEntryById.set(taskId, freshTaskEntry);
                continue;
            }

            const oldTask = taskEntry.getTask();
            const newTask = mergeTaskIndexDocs(oldTask, searchedTask);
            taskEntry.setTask(newTask);

            // If the task changed, notify our queries. We may need to remove the task from
            // the query if it's no longer visible, we may need to change the tasks's sort
            // position, we may need to notify subscribers about the change, or we may need
            // to add the task to another query.
            //
            // This should happen rarely but it's not impossible. It means OpenSearch is
            // ahead of the actions received by task realtime service. If OpenSearch just
            // refreshed and there's a delay in sending notifications to our service this
            // case could happen.
            if (oldTask !== newTask) {
                const addedQueryDependencies = new Set();

                // For queries this task is not currently visible in, see if it is now visible.
                for (const otherQuery of this._queries.values()) {
                    if (otherQuery === query) continue;
                    if (taskEntry.hasQueryDependent(otherQuery)) continue;

                    const {isVisible} = otherQuery.maybeAddVisibleTask(
                        context,
                        taskId,
                        taskEntry.getTask(),
                    );
                    if (isVisible) {
                        addedQueryDependencies.add(otherQuery);
                        taskEntry.addQueryDependent(otherQuery);
                    }
                }

                // For queries this task is currently visible in, update the query and see if
                // the task is now hidden from the query.
                for (const otherQuery of taskEntry.iterateQueryDependents()) {
                    if (addedQueryDependencies.has(otherQuery)) continue;

                    const {isStillVisible} = otherQuery.onVisibleTaskUpdate(
                        context,
                        taskId,
                        oldTask,
                        newTask,
                    );
                    if (!isStillVisible) {
                        taskEntry.removeQueryDependent(otherQuery);
                    }
                }
            }

            const wasAlreadyVisibleInQuery = taskEntry.hasQueryDependent(query);
            if (!wasAlreadyVisibleInQuery) taskEntry.addQueryDependent(query);

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
                const {isStillVisible} = query.onVisibleTaskUpdate(
                    context,
                    taskId,
                    searchedTask,
                    newTask,
                );
                if (!isStillVisible) {
                    taskEntry.removeQueryDependent(query);
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

                        const oldTask = taskEntry.getTask();
                        const newTask = applyTaskActionToTaskIndexDoc(
                            oldTask,
                            action.time,
                            action.taskAction,
                        );
                        taskEntry.setTask(newTask);

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
                        (!taskEntry || !taskEntry.hasQueryDependent(query)) &&
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
            const {isStillVisible} = query.onVisibleTaskUpdate(
                context,
                taskId,
                oldTask,
                taskEntry.getTask(),
            );
            if (!isStillVisible) {
                taskEntry.removeQueryDependent(query);
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

            const {isVisible} = query.maybeAddVisibleTask(context, taskId, taskEntry.getTask());
            if (isVisible) {
                taskEntry.addQueryDependent(query);
            }
        }

        return maybeAddVisibleTaskIdsToLoad;
    }

    private async _onQueryTasksLoadAsync(
        context: TaskRealtimeSystemActionContext,
        query: TaskRealtimeQuery,
        maybeAddVisibleTaskIdsToLoad: Array<TaskId>,
    ) {
        await runAllPromises(
            maybeAddVisibleTaskIdsToLoad.map(taskId =>
                retryWithExponentialBackoff(async retry => {
                    const taskEntry = await this.loadTaskIfExists(context, taskId);

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
                    if (!taskEntry.hasQueryDependent(query)) {
                        const {isVisible} = query.maybeAddVisibleTask(
                            context,
                            taskId,
                            taskEntry.getTask(),
                        );
                        if (isVisible) {
                            taskEntry.addQueryDependent(query);
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
        context: TaskRealtimeSystemActionContext,
        actions: ReadonlyArray<TaskAction>,
    ): Promise<void> {
        const queriesByMaybeAddVisibleTaskIdToLoad = this._applyActionTransactionSync(
            context,
            actions,
        );
        return this._applyActionTransactionAsync(context, queriesByMaybeAddVisibleTaskIdToLoad);
    }

    // The synchronous part of `applyActionTransaction()`. Carefully updates our
    // data structures while assuming no concurrent code is running which would
    // observe a partial state.
    private _applyActionTransactionSync(
        context: TaskRealtimeSystemActionContext,
        actions: ReadonlyArray<TaskAction>,
    ) {
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
                        const oldTask = taskEntry.getTask();
                        const newTask = applyTaskActionToTaskIndexDoc(
                            oldTask,
                            action.time,
                            action.taskAction,
                        );
                        taskEntry.setTask(newTask);

                        const {shouldTryAddingToAllQueriesNextAction} = taskEntry;
                        if (shouldTryAddingToAllQueriesNextAction)
                            taskEntry.shouldTryAddingToAllQueriesNextAction = false;

                        // If the task changed then we need to call `query.onVisibleTaskUpdate()` so
                        // that queries see the new task object and we need to call
                        // `query.maybeAddVisibleTask()` in case queries this task object is visible in
                        // queries it used to be hidden in.
                        //
                        // We may be instructed to call `query.maybeAddVisibleTask()` regardless of
                        // whether the task changed with the `shouldTryAddingToAllQueriesNextAction`
                        // flag. Code which loads possibly ahead tasks from OpenSearch will set this
                        // to true.
                        if (
                            (shouldTryAddingToAllQueriesNextAction || oldTask !== newTask) &&
                            !updatedTaskEntriesById.has(action.taskId)
                        ) {
                            updatedTaskEntriesById.set(action.taskId, {taskEntry, oldTask});
                        }

                        // NOCOMMIT: Reauthorize...
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
                    const collectionEntry = this._collectionEntryById.get(action.collectionId);

                    if (collectionEntry !== undefined) {
                        const oldCollection = collectionEntry.getCollection();
                        const newCollection = applyTaskCollectionActionToCollectionIndexDoc(
                            oldCollection,
                            action.time,
                            action.collectionAction,
                        );
                        collectionEntry.setCollection(newCollection);
                    }

                    // NOCOMMIT: Reauthorize...
                    break;
                }
                case "UpdateNotepadPage": {
                    cast<"Create">(action.notepadPageAction.type);
                    // Doesn't affect store data
                    break;
                }
                default:
                    throw exhaustive(action);
            }
        }

        for (const [taskId, {taskEntry, oldTask}] of updatedTaskEntriesById) {
            const addedQueryDependencies = new Set();

            // For queries this task is not currently visible in, see if it is now visible.
            for (const query of this._queries.values()) {
                if (taskEntry.hasQueryDependent(query)) continue;

                const {isVisible} = query.maybeAddVisibleTask(context, taskId, taskEntry.getTask());
                if (isVisible) {
                    addedQueryDependencies.add(query);
                    taskEntry.addQueryDependent(query);
                }
            }

            // For queries this task is currently visible in, update the query and see if
            // the task is now hidden from the query.
            if (oldTask !== taskEntry.getTask()) {
                for (const query of taskEntry.iterateQueryDependents()) {
                    if (addedQueryDependencies.has(query)) continue;

                    const {isStillVisible} = query.onVisibleTaskUpdate(
                        context,
                        taskId,
                        oldTask,
                        taskEntry.getTask(),
                    );
                    if (!isStillVisible) {
                        taskEntry.removeQueryDependent(query);
                    }
                }
            }
        }

        return queriesByMaybeAddVisibleTaskIdToLoad;
    }

    private async _applyActionTransactionAsync(
        context: TaskRealtimeSystemActionContext,
        queriesByMaybeAddVisibleTaskIdToLoad: Map<TaskId, Set<TaskRealtimeQuery>>,
    ) {
        await runAllPromises(
            Array.from(queriesByMaybeAddVisibleTaskIdToLoad, ([taskId, queries]) =>
                retryWithExponentialBackoff(async retry => {
                    const taskEntry = await this.loadTaskIfExists(context, taskId);

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
                        if (!taskEntry.hasQueryDependent(query)) {
                            const {isVisible} = query.maybeAddVisibleTask(
                                context,
                                taskId,
                                taskEntry.getTask(),
                            );
                            if (isVisible) {
                                taskEntry.addQueryDependent(query);
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
    public loadTaskIfExists(
        context: TaskRealtimeSystemActionContext,
        taskId: TaskId,
    ): Promise<TaskRealtimeQueryStoreTaskEntry | null> {
        // If we've already loaded the task, great! No need to load it now.
        {
            const taskEntry = this._taskEntryById.get(taskId);
            if (taskEntry !== undefined) return Promise.resolve(taskEntry);
        }

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
            promiseResolver.promise.then(
                () => this._loadingTaskPromiseById.delete(taskId),
                () => this._loadingTaskPromiseById.delete(taskId),
            );

            return promiseResolver.promise;
        });
    }

    private async _executeLoadTaskBatch(
        context: TaskRealtimeSystemActionContext,
        taskLoadBatch: Array<{
            taskId: TaskId;
            promiseResolver: PromiseResolver<TaskRealtimeQueryStoreTaskEntry | null>;
        }>,
    ): Promise<void> {
        await taskRealtimeQueryStoreLoadTaskTestCheckpoint.waitForTest(this.spaceId);

        const tasks = await getTaskIndexDocsIfExist(
            context,
            this.spaceId,
            taskLoadBatch.map(({taskId}) => taskId),
        );

        // Remove the `version` property from loaded tasks. The tasks we keep track of
        // in our store don't have the OpenSearch version since we update the tasks
        // independently.
        for (const task of tasks) {
            if (task !== null && "version" in task) {
                delete (task as any).version;
            }
        }

        this._executeLoadTaskBatchSync(context, taskLoadBatch, tasks);
    }

    // The synchronous part of `_executeLoadTaskBatch()` to be run after the
    // network request. It's useful to make this synchronous since we'll be
    // updating our internal store state and we don't want to think about
    // concurrent readers/writers.
    private _executeLoadTaskBatchSync(
        context: TaskRealtimeSystemActionContext,
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

        // Catch up our tasks which are freshly loaded from OpenSearch with any actions
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

            const taskEntry = new TaskRealtimeQueryStoreTaskEntry(this, task);
            taskEntry.shouldTryAddingToAllQueriesNextAction = true;

            this._taskEntryById.set(taskId, taskEntry);

            promiseResolver.resolve(taskEntry);
        }
    }

    /**
     * Load an entry for a collection from OpenSearch and put it in
     * `collectionEntryById`.
     *
     * Batches and dedupes load requests behind the scenes.
     */
    public loadCollectionIfExists(
        context: TaskRealtimeSystemActionContext,
        collectionId: TaskCollectionId,
    ): Promise<TaskRealtimeQueryStoreCollectionEntry | null> {
        // If we've already loaded the collection, great! No need to load it now.
        {
            const collectionEntry = this._collectionEntryById.get(collectionId);
            if (collectionEntry !== undefined) return Promise.resolve(collectionEntry);
        }

        return getOrSetDefaultMapValue(this._loadingCollectionPromiseById, collectionId, () => {
            if (!this._scheduledCollectionLoadBatch) {
                this._scheduledCollectionLoadBatch = [];

                scheduleMicrotask(() => {
                    assert(this._scheduledCollectionLoadBatch);
                    const collectionLoadBatch = this._scheduledCollectionLoadBatch;
                    this._scheduledCollectionLoadBatch = null;

                    this._executeLoadCollectionBatch(context, collectionLoadBatch).catch(error => {
                        for (const {promiseResolver} of collectionLoadBatch) {
                            promiseResolver.reject(error);
                        }
                    });
                });
            }

            const promiseResolver =
                createPromiseResolver<TaskRealtimeQueryStoreCollectionEntry | null>();
            this._scheduledCollectionLoadBatch.push({collectionId, promiseResolver});

            // Once the promise has settled, delete it from `loadingCollectionPromiseById`.
            // You can now get the task from `collectionEntryById`.
            //
            // If the task entry is evicted then we should create a new loading promise.
            promiseResolver.promise.then(
                () => this._loadingCollectionPromiseById.delete(collectionId),
                () => this._loadingCollectionPromiseById.delete(collectionId),
            );

            return promiseResolver.promise;
        });
    }

    private async _executeLoadCollectionBatch(
        context: TaskRealtimeSystemActionContext,
        collectionLoadBatch: Array<{
            collectionId: TaskCollectionId;
            promiseResolver: PromiseResolver<TaskRealtimeQueryStoreCollectionEntry | null>;
        }>,
    ): Promise<void> {
        const collections = await getTaskCollectionIndexDocsIfExist(
            context,
            this.spaceId,
            collectionLoadBatch.map(({collectionId}) => collectionId),
        );

        // Remove the `version` property from loaded collections. The collections we
        // keep track of in our store don't have the OpenSearch version since we update
        // the collections independently.
        for (const collection of collections) {
            if (collection !== null && "version" in collection) {
                delete (collection as any).version;
            }
        }

        this._executeLoadCollectionBatchSync(context, collectionLoadBatch, collections);
    }

    // The synchronous part of `_executeLoadCollectionBatch()` to be run after the
    // network request. It's useful to make this synchronous since we'll be
    // updating our internal store state and we don't want to think about
    // concurrent readers/writers.
    private _executeLoadCollectionBatchSync(
        context: TaskRealtimeSystemActionContext,
        collectionLoadBatch: Array<{
            collectionId: TaskCollectionId;
            promiseResolver: PromiseResolver<TaskRealtimeQueryStoreCollectionEntry | null>;
        }>,
        collections: Array<TaskCollectionIndexDoc | null>,
    ): void {
        const freshCollectionById = new Map<
            TaskCollectionId,
            {
                freshCollection: TaskCollectionIndexDoc;
                promiseResolver: PromiseResolver<TaskRealtimeQueryStoreCollectionEntry | null>;
            }
        >();

        // Check if any of the collections were loaded concurrently while we were
        // waiting on our network request. We can immediately resolve any that were.
        for (let i = 0; i < collectionLoadBatch.length; i++) {
            const {collectionId, promiseResolver} = collectionLoadBatch[i]!;
            const collectionEntry = this._collectionEntryById.get(collectionId);

            if (collectionEntry !== undefined) {
                promiseResolver.resolve(collectionEntry);
            } else {
                const collection = collections[i];
                if (!collection) {
                    promiseResolver.resolve(null);
                } else {
                    freshCollectionById.set(collectionId, {
                        freshCollection: collection,
                        promiseResolver,
                    });
                }
            }
        }

        // Catch up our collections which are freshly loaded from OpenSearch with any
        // actions in our history so they're up-to-date in realtime.
        for (const [collectionId, {freshCollection, promiseResolver}] of freshCollectionById) {
            let collection = freshCollection;

            this._actionHistory.iterateCollectionActions(
                context.tracer.getTracer(),
                this.spaceId,
                collectionId,
                (actionTime, action) => {
                    collection = applyTaskCollectionActionToCollectionIndexDoc(
                        collection,
                        actionTime,
                        action,
                    );
                },
            );

            const collectionEntry = new TaskRealtimeQueryStoreCollectionEntry(collection);

            this._collectionEntryById.set(collectionId, collectionEntry);

            promiseResolver.resolve(collectionEntry);
        }
    }
}

/**
 * The representation of a task in our store.
 */
export class TaskRealtimeQueryStoreTaskEntry {
    private readonly _store: TaskRealtimeQueryStoreInternal;

    /** The current task object. */
    private _task: TaskIndexDoc;

    /**
     * If true then the next time we see an action for this task we will call
     * `query.maybeAddVisibleTask()` on all queries this task is not already in.
     *
     * Set this to true when you are updating a task outside of
     * `applyActionTransaction()` and want to add the task to queries in
     * `applyActionTransaction()` as if the update was received from an action.
     *
     * This is important for correctness since we may skip propagating updates to
     * queries otherwise when we later see the related action in
     * `applyActionTransaction()` if you update the task outside of
     * `applyActionTransaction()`.
     */
    public shouldTryAddingToAllQueriesNextAction = false;

    /**
     * A reference to our task's parent task.
     *
     * This reference is lazily initialized so even if the underlying task object
     * has a parent task this may be null until `getParentTask()` is called.
     */
    private _parentTaskEntry: Promise<TaskRealtimeQueryStoreTaskEntry> | null = null;

    /**
     * A reference to the collections our task is in.
     *
     * This map is lazily initialized so it may not include some collections our
     * task object says it's in until `getCollections()` has been called.
     */
    private readonly _collectionEntryById = new Map<
        TaskCollectionId,
        Promise<TaskRealtimeQueryStoreCollectionEntry>
    >();

    /**
     * The child tasks of this task which hold a reference to us in `parentTaskEntry`.
     *
     * This is not the full list of children of this task. Only the children that
     * have been loaded by some query. Additionally, a task's collections are
     * lazily initialized so this is not populated until `getCollections()` is
     * called.
     */
    // NOCOMMIT: Mark for eviction if no dependencies...
    private readonly _childTaskEntryDependentById = new Map<
        TaskId,
        TaskRealtimeQueryStoreTaskEntry
    >();

    /**
     * Queries that depend on this task. If a query is in this set then our task
     * must be visible in the query.
     */
    // NOCOMMIT: Mark for eviction if no dependencies...
    private readonly _queryDependents = new Set<TaskRealtimeQuery>();

    constructor(store: TaskRealtimeQueryStoreInternal, task: TaskIndexDoc) {
        this._store = store;
        this._task = task;
    }

    /**
     * Get the current task object in our entry.
     */
    public getTask() {
        return this._task;
    }

    /**
     * Set the task object in our entry to a new value. Invalidates any
     * dependencies of this entry.
     */
    public setTask(task: TaskIndexDoc) {
        assert(this._task.id === task.id);
        this._task = task;

        // If the task parent changed then remove our reference to the loaded parent
        // task entry and remove the back reference which points back to us.
        if (this._task.parent.taskId.value !== task.parent.taskId.value) {
            void this._parentTaskEntry?.then(parentTaskEntry => {
                parentTaskEntry.removeChildTaskDependent(this);
            });
            this._parentTaskEntry = null;
        }

        // If the task's collections change then for any collections that were removed,
        // remove our reference to the collection entry and remove the back reference
        // which points back to us.
        if (this._task.collections.raw.collections !== task.collections.raw.collections) {
            const removedCollectionIds = new Set(
                this._task.collections.raw.collections
                    .getArray()
                    .map(({collectionId}) => collectionId),
            );

            for (const {collectionId} of task.collections.raw.collections.getArray()) {
                removedCollectionIds.delete(collectionId);
            }

            for (const collectionId of removedCollectionIds) {
                void this._collectionEntryById.get(collectionId)?.then(collectionEntry => {
                    collectionEntry.removeTaskDependent(this);

                    for (const query of this.iterateQueryDependents()) {
                        collectionEntry.removeIndirectQueryDependent(query);
                    }
                });
                this._collectionEntryById.delete(collectionId);
            }
        }
    }

    /**
     * Get a reference to our task's parent task. If we haven't loaded the parent
     * task yet then calling this function will kick off that process.
     */
    public getParentTask(
        context: TaskRealtimeSystemActionContext,
    ): Promise<TaskRealtimeQueryStoreTaskEntry | null> {
        if (this._task.parent.taskId.value === null) {
            assert(this._parentTaskEntry === null);
            return Promise.resolve(null);
        }

        if (this._parentTaskEntry === null) {
            this._parentTaskEntry = this._store
                .loadTaskIfExists(context, this._task.parent.taskId.value)
                .then(parentTaskEntry => {
                    if (!parentTaskEntry) throw new InternalError("Task not found");

                    parentTaskEntry.addChildTaskDependent(this);

                    return parentTaskEntry;
                });
        }

        return this._parentTaskEntry;
    }

    /**
     * Get a reference to our task's collections. If we haven't loaded this task's
     * collections yet then calling this function will kick off that process.
     */
    public getCollections(
        context: TaskRealtimeSystemActionContext,
    ): Promise<Array<TaskRealtimeQueryStoreCollectionEntry>> {
        return runAllPromises(
            this._task.collections.raw.collections.getArray().map(({collectionId}) => {
                return getOrSetDefaultMapValue(this._collectionEntryById, collectionId, () => {
                    // It's important that we capture query dependents before we start loading. If
                    // `addQueryDependent()` is called while we're loading then it will cue an
                    // `addIndirectQueryDependent()` call.
                    //
                    // NOCOMMIT: Test this!!
                    const indirectQueryDependents = Array.from(this.iterateQueryDependents());

                    return this._store
                        .loadCollectionIfExists(context, collectionId)
                        .then(collectionEntry => {
                            if (!collectionEntry)
                                throw new InternalError("Task collection not found");

                            collectionEntry.addTaskDependent(this);

                            for (const query of indirectQueryDependents) {
                                collectionEntry.addIndirectQueryDependent(query);
                            }

                            return collectionEntry;
                        });
                });
            }),
        );
    }

    public iterateQueryDependents(): IterableIterator<TaskRealtimeQuery> {
        return this._queryDependents.values();
    }

    public hasQueryDependent(query: TaskRealtimeQuery) {
        return this._queryDependents.has(query);
    }

    public addQueryDependent(query: TaskRealtimeQuery) {
        // NOCOMMIT: Remove from if no dependencies...
        this._queryDependents.add(query);

        for (const collectionEntry of this._collectionEntryById.values()) {
            void collectionEntry.then(collectionEntry =>
                collectionEntry.addIndirectQueryDependent(query),
            );
        }
    }

    public removeQueryDependent(query: TaskRealtimeQuery) {
        if (process.env.NODE_ENV !== "production") {
            assert(this._queryDependents.has(query), "Query was not added as a dependent to task");
        }

        // NOCOMMIT: Mark for eviction if no dependencies...
        this._queryDependents.delete(query);

        for (const collectionEntry of this._collectionEntryById.values()) {
            void collectionEntry.then(collectionEntry =>
                collectionEntry.removeIndirectQueryDependent(query),
            );
        }
    }

    public addChildTaskDependent(task: TaskRealtimeQueryStoreTaskEntry) {
        // NOCOMMIT: Revive from eviction if dependencies...
        this._childTaskEntryDependentById.set(task._task.id, task);
    }

    public removeChildTaskDependent(task: TaskRealtimeQueryStoreTaskEntry) {
        if (process.env.NODE_ENV !== "production") {
            assert(
                this._childTaskEntryDependentById.get(task._task.id) === task,
                "Child task was not added as a dependent to task",
            );
        }

        // NOCOMMIT: Mark for eviction if no dependencies...
        this._childTaskEntryDependentById.delete(task._task.id);
    }

    public addQuerySubscriptionDependent(querySubscription: TaskRealtimeQuerySubscription) {
        // NOCOMMIT: Revive from eviction...
    }

    public removeQuerySubscriptionDependent(querySubscription: TaskRealtimeQuerySubscription) {
        // NOCOMMIT: Mark for eviction...
    }
}

export class TaskRealtimeQueryStoreCollectionEntry {
    private _collection: TaskCollectionIndexDoc;

    // NOCOMMIT: Mark for eviction if no dependencies...
    private readonly _taskDependentById = new Map<TaskId, TaskRealtimeQueryStoreTaskEntry>();

    private readonly _indirectQueryDependents = new Map<TaskRealtimeQuery, number>();

    constructor(collection: TaskCollectionIndexDoc) {
        this._collection = collection;
    }

    public getCollection() {
        return this._collection;
    }

    public setCollection(collection: TaskCollectionIndexDoc) {
        assert(this._collection.id === collection.id);
        this._collection = collection;
    }

    public addTaskDependent(task: TaskRealtimeQueryStoreTaskEntry) {
        // NOCOMMIT: Revive from eviction
        this._taskDependentById.set(task.getTask().id, task);
    }

    public removeTaskDependent(task: TaskRealtimeQueryStoreTaskEntry) {
        if (process.env.NODE_ENV !== "production") {
            assert(
                this._taskDependentById.get(task.getTask().id) === task,
                "Task was not added as a dependent to collection",
            );
        }

        // NOCOMMIT: Schedule for eviction
        this._taskDependentById.delete(task.getTask().id);
    }

    public addIndirectQueryDependent(query: TaskRealtimeQuery) {
        const count = (this._indirectQueryDependents.get(query) ?? 0) + 1;
        this._indirectQueryDependents.set(query, count);
    }

    public removeIndirectQueryDependent(query: TaskRealtimeQuery) {
        const count = (this._indirectQueryDependents.get(query) ?? 0) - 1;
        if (count <= 0) {
            if (process.env.NODE_ENV !== "production") {
                assert(
                    count === 0,
                    "`removeIndirectQueryDependent()` called without matching `addIndirectQueryDependent()`",
                );
            }

            this._indirectQueryDependents.delete(query);
        } else {
            this._indirectQueryDependents.set(query, count);
        }
    }

    public addQuerySubscriptionDependent(querySubscription: TaskRealtimeQuerySubscription) {
        // NOCOMMIT: Revive from eviction...
    }

    public removeQuerySubscriptionDependent(querySubscription: TaskRealtimeQuerySubscription) {
        // NOCOMMIT: Mark for eviction...
    }
}
