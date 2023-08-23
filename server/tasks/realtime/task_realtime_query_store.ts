import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {applyTaskActionToTaskIndexDoc} from "~/server/tasks/data/apply_task_action_to_task_index_doc.js";
import {applyTaskCollectionActionToCollectionIndexDoc} from "~/server/tasks/data/apply_task_collection_action_to_collection_index_doc.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {
    getTaskCollectionIndexDocsIfExist,
    getTaskIndexDocsIfExist,
} from "~/server/tasks/data/task_index.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {ReadonlyTaskRealtimeActionHistory} from "~/server/tasks/realtime/task_realtime_action_history.js";
import {TaskRealtimeUpdateEventBuilder} from "~/server/tasks/realtime/task_realtime_event.js";
import {TaskRealtimeQuery} from "~/server/tasks/realtime/task_realtime_query.js";
import {
    TaskRealtimeQuerySubscription,
    TaskRealtimeQuerySubscriptionCallbacks,
    TaskRealtimeQuerySubscriptionInternal,
} from "~/server/tasks/realtime/task_realtime_query_subscription.js";
import {TaskRealtimeSystemActionContext} from "~/server/tasks/realtime/task_realtime_system_action_context.js";
import {InternalError} from "~/shared/error/error.js";
import {isNonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
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

    public subscribeToQuery(options: {
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        callbacks: TaskRealtimeQuerySubscriptionCallbacks;
    }) {
        return this._internal.subscribeToQuery(options);
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

    public async getTask(
        context: TaskRealtimeSystemActionContext,
        taskId: TaskId,
    ): Promise<TaskIndexDoc> {
        const taskEntry = await this._internal.loadTaskEntry(context, taskId);
        return taskEntry.task;
    }

    public async getCollection(
        context: TaskRealtimeSystemActionContext,
        collectionId: TaskCollectionId,
    ): Promise<TaskCollectionIndexDoc> {
        const collectionEntry = await this._internal.loadCollectionEntry(context, collectionId);
        return collectionEntry.collection;
    }

    public getTaskIfLoaded(taskId: TaskId) {
        return this._internal.getTaskIfLoaded(taskId);
    }

    public getCollectionIfLoaded(collectionId: TaskCollectionId) {
        return this._internal.getCollectionIfLoaded(collectionId);
    }
}

export const taskRealtimeQueryStoreLoadTaskTestCheckpoint = new TestCheckpoint<SpaceId>();

// Our store implementation has some public methods that `TaskRealtimeQuery` is
// allowed to call but external users of `TaskRealtimeQueryStore` should not
// (e.g. `onQueryTasksLoad`). These methods are public on this internal class
// and we have a wrapper `TaskRealtimeQueryStore` class with a public interface.
export class TaskRealtimeQueryStoreInternal {
    public readonly spaceId: SpaceId;
    public readonly actionHistory: ReadonlyTaskRealtimeActionHistory;

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
        this.actionHistory = actionHistory;
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
     * If a task is loaded in our store then this function will return it. The
     * task is up-to-date in realtime.
     */
    public getTaskIfLoaded(taskId: TaskId) {
        return this._taskEntryById.get(taskId)?.task;
    }

    /**
     * If a collection is loaded in our store then this function will return it.
     * The collection is up-to-date in realtime.
     */
    public getCollectionIfLoaded(collectionId: TaskCollectionId) {
        return this._collectionEntryById.get(collectionId)?.collection;
    }

    /**
     * Get the task entry for the provided `TaskId` if the task exists and is
     * loaded in our store.
     */
    public getTaskEntryIfExists(taskId: TaskId): TaskRealtimeQueryStoreTaskEntry | undefined {
        return this._taskEntryById.get(taskId);
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

        return taskEntry.task;
    }

    /**
     * Ensure an entry exists in our store for the provided task. If we create a
     * new entry we will return `isFresh: true`.
     */
    public ensureTaskEntry(task: TaskIndexDoc): {
        isFresh: boolean;
        taskEntry: TaskRealtimeQueryStoreTaskEntry;
    } {
        const taskEntry = this._taskEntryById.get(task.id);
        if (taskEntry !== undefined) return {isFresh: false, taskEntry};

        // If we haven't seen this task before it's "fresh". The task may be outdated
        // so we'll need to apply the actions from our action history to catch it up.
        const freshTaskEntry = new TaskRealtimeQueryStoreTaskEntry(this, task);
        this._taskEntryById.set(task.id, freshTaskEntry);

        return {isFresh: true, taskEntry: freshTaskEntry};
    }

    /**
     * Get a query for the provided filters and sorts. We will reuse queries with
     * identical filters and sorts. If a subscription is not promptly added then
     * the query will be evicted on the next eviction cycle.
     */
    private _getQuery({
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
        context: TaskRealtimeSystemActionContext,
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
        assert(Number.isInteger(limit));

        const query = this._getQuery({filters, sorts});

        // Load enough tasks to satisfy our `limit`.
        await query.loadMoreTasks(context, limit - query.getLoadedTaskCount());

        return query.getLoadedTasks({
            limit,
            afterCursor: null,
        });
    }

    /**
     * Subscribes to a query in our store. You need to call `loadMoreTasks()` on
     * the subscription and then you'll start receiving realtime events via
     * `onAction` for the loaded tasks.
     */
    public subscribeToQuery({
        filters,
        sorts,
        callbacks,
    }: {
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        callbacks: TaskRealtimeQuerySubscriptionCallbacks;
    }) {
        const query = this._getQuery({filters, sorts});
        return new TaskRealtimeQuerySubscription(query, callbacks);
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
        const eventBuilder = new TaskRealtimeUpdateEventBuilder();

        const queriesByMaybeAddVisibleTaskIdToLoad = this._applyActionTransactionSync(
            context,
            actions,
            eventBuilder,
        );

        return this._applyActionTransactionAsync(
            context,
            queriesByMaybeAddVisibleTaskIdToLoad,
            eventBuilder,
        );
    }

    // The synchronous part of `applyActionTransaction()`. Carefully updates our
    // data structures while assuming no concurrent code is running which would
    // observe a partial state.
    private _applyActionTransactionSync(
        context: TaskRealtimeSystemActionContext,
        actions: ReadonlyArray<TaskAction>,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
    ) {
        const updatedTaskEntriesById = new Map<
            TaskId,
            {
                taskEntry: TaskRealtimeQueryStoreTaskEntry;
                oldTask: TaskIndexDoc;
                actions: Array<TaskAction>;
            }
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

                        // Always treat task as updated even if `oldTask === newTask`.
                        //
                        // We may have loaded in data from OpenSearch that's ahead of the actions we
                        // received. If OpenSearch has already incorporated an action then
                        // `oldTask === newTask` but we still want to deliver the action to the client.
                        //
                        // This also means we deliver all actions to the client regardless of whether
                        // its a noop. This seems like good behavior.
                        getOrSetDefaultMapValue(updatedTaskEntriesById, action.taskId, () => ({
                            taskEntry,
                            oldTask,
                            actions: [],
                        })).actions.push(action);
                    }
                    // If we do not have an entry for this task, then check with all our queries to
                    // see if this action might result in a new visible task. We need to load these
                    // tasks to fully compare them against the query's filters.
                    else {
                        for (const query of this._queries.values()) {
                            if (
                                query.mightActionAddTaskToLoadedRange(
                                    action.time,
                                    action.taskAction,
                                )
                            ) {
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
                        const oldCollection = collectionEntry.collection;
                        const newCollection = applyTaskCollectionActionToCollectionIndexDoc(
                            oldCollection,
                            action.time,
                            action.collectionAction,
                        );
                        collectionEntry.collection = newCollection;
                    }

                    // NOCOMMIT: Accept action transaction code path here???
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

        for (const [taskId, {taskEntry, oldTask, actions}] of updatedTaskEntriesById) {
            assert(isNonEmptyReadonlyArray(actions));

            const addedQueryDependencies = new Set();

            // For queries this task is not currently visible in, see if it is now visible.
            for (const query of this._queries.values()) {
                if (taskEntry.hasQueryDependent(query)) continue;

                const {isVisible} = query.maybeAddVisibleTask(
                    context,
                    eventBuilder,
                    taskEntry.task,
                );
                if (isVisible) {
                    addedQueryDependencies.add(query);
                    taskEntry.addQueryDependent(query);
                }
            }

            // For queries this task is currently visible in, update the query and see if
            // the task is now hidden from the query.
            for (const query of taskEntry.iterateQueryDependents()) {
                if (addedQueryDependencies.has(query)) continue;

                const {isStillVisible} = query.onVisibleTaskUpdate(
                    context,
                    eventBuilder,
                    taskId,
                    oldTask,
                    taskEntry.task,
                    actions,
                );
                if (!isStillVisible) {
                    taskEntry.removeQueryDependent(query);
                }
            }

            for (const querySubscription of taskEntry.iterateQuerySubscriptionDependents()) {
                querySubscription.onReferencedTaskUpdate(
                    context,
                    eventBuilder,
                    taskId,
                    oldTask,
                    taskEntry.task,
                    actions,
                );
            }
        }

        return queriesByMaybeAddVisibleTaskIdToLoad;
    }

    private async _applyActionTransactionAsync(
        context: TaskRealtimeSystemActionContext,
        queriesByMaybeAddVisibleTaskIdToLoad: Map<TaskId, Set<TaskRealtimeQuery>>,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
    ) {
        await runAllPromises(
            Array.from(queriesByMaybeAddVisibleTaskIdToLoad, async ([taskId, queries]) => {
                const taskEntry = await this.loadTaskEntry(context, taskId);

                for (const query of queries) {
                    // If the task is still not visible in this query (some concurrent process may
                    // have made it visible) then attempt to add the task to the query given the
                    // task passes the query's filters.
                    if (!taskEntry.hasQueryDependent(query)) {
                        const {isVisible} = query.maybeAddVisibleTask(
                            context,
                            eventBuilder,
                            taskEntry.task,
                        );
                        if (isVisible) {
                            taskEntry.addQueryDependent(query);
                        }
                    }
                }
            }),
        );

        // Once we are done applying our action transaction, send the built events to
        // connected clients! In the process of updating we will have found out which
        // actions need to go to which clients while still preserving the atomicity of
        // a transaction.
        await eventBuilder.send(context);
    }

    /**
     * Load an entry for a task from OpenSearch and put it in `taskEntryById`.
     *
     * Batches and dedupes load requests behind the scenes.
     *
     * If we can't find a task then we'll retry for a bit and eventually throw an
     * error. It's expected when you call this method that the underlying task
     * exists. If it doesn't that must mean our index is stale so we retry for
     * a bit.
     */
    public loadTaskEntry(
        context: TaskRealtimeSystemActionContext,
        taskId: TaskId,
    ): Promise<TaskRealtimeQueryStoreTaskEntry> {
        return retryWithExponentialBackoff(async retry => {
            const taskEntry = await this._loadTaskEntryIfExists(context, taskId);

            if (!taskEntry) {
                throw retry(new InternalError("Task not found"));
            }

            return taskEntry;
        });
    }

    private _loadTaskEntryIfExists(
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

            this.actionHistory.iterateTaskActions(
                context.tracer.getTracer(),
                this.spaceId,
                taskId,
                (actionTime, action) => {
                    task = applyTaskActionToTaskIndexDoc(task, actionTime, action);
                },
            );

            const taskEntry = new TaskRealtimeQueryStoreTaskEntry(this, task);
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
    public loadCollectionEntry(
        context: TaskRealtimeSystemActionContext,
        collectionId: TaskCollectionId,
    ): Promise<TaskRealtimeQueryStoreCollectionEntry> {
        return retryWithExponentialBackoff(async retry => {
            const collectionEntry = await this._loadCollectionEntryIfExists(context, collectionId);

            if (!collectionEntry) {
                throw retry(new InternalError("Task not found"));
            }

            return collectionEntry;
        });
    }

    private _loadCollectionEntryIfExists(
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

            this.actionHistory.iterateCollectionActions(
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
    public task: TaskIndexDoc;

    /**
     * Queries that depend on this task. If a query is in this set then our task
     * must be visible in the query.
     */
    // NOCOMMIT: Mark for eviction if no dependencies...
    private readonly _queryDependents = new Set<TaskRealtimeQuery>();

    /**
     * Query subscriptions that depend on this task. Query subscriptions reference
     * all parents, recursively, of loaded tasks.
     */
    // NOCOMMIT: Mark for eviction if no dependencies...
    private readonly _querySubscriptionDependents =
        new Set<TaskRealtimeQuerySubscriptionInternal>();

    constructor(store: TaskRealtimeQueryStoreInternal, initialTask: TaskIndexDoc) {
        this._store = store;
        this.task = initialTask;

        // In test and development environments make sure `this.task = newTask` never
        // changes the `TaskId`. In production this is a simple property getter/setter.
        if (process.env.NODE_ENV !== "production") {
            let currentTask = initialTask;
            Object.defineProperty(this, "task", {
                get: () => currentTask,
                set: (newTask: TaskIndexDoc) => {
                    assert(newTask.id === currentTask.id);
                    currentTask = newTask;
                },
            });
        }
    }

    public iterateQueryDependents() {
        return this._queryDependents.values();
    }

    public hasQueryDependent(query: TaskRealtimeQuery) {
        return this._queryDependents.has(query);
    }

    public addQueryDependent(query: TaskRealtimeQuery) {
        // NOCOMMIT: Remove from if no dependencies...
        this._queryDependents.add(query);
    }

    public removeQueryDependent(query: TaskRealtimeQuery) {
        if (process.env.NODE_ENV !== "production") {
            assert(this._queryDependents.has(query), "Query was not added as a dependent to task");
        }

        // NOCOMMIT: Mark for eviction if no dependencies...
        this._queryDependents.delete(query);
    }

    public iterateQuerySubscriptionDependents() {
        return this._querySubscriptionDependents.values();
    }

    public addQuerySubscriptionDependent(querySubscription: TaskRealtimeQuerySubscriptionInternal) {
        // NOCOMMIT: Revive from eviction...
        this._querySubscriptionDependents.add(querySubscription);
    }

    public removeQuerySubscriptionDependent(
        querySubscription: TaskRealtimeQuerySubscriptionInternal,
    ) {
        // NOCOMMIT: Mark for eviction...
        this._querySubscriptionDependents.delete(querySubscription);
    }
}

export class TaskRealtimeQueryStoreCollectionEntry {
    public collection: TaskCollectionIndexDoc;

    constructor(initialCollection: TaskCollectionIndexDoc) {
        this.collection = initialCollection;

        // In test and development environments make sure
        // `this.collection = newCollection` never changes the `TaskCollectionId`. In
        // production this is a simple property getter/setter.
        if (process.env.NODE_ENV !== "production") {
            let currentCollection = initialCollection;
            Object.defineProperty(this, "collection", {
                get: () => currentCollection,
                set: (newCollection: TaskCollectionIndexDoc) => {
                    assert(newCollection.id === currentCollection.id);
                    currentCollection = newCollection;
                },
            });
        }
    }

    public addQuerySubscriptionDependent(querySubscription: TaskRealtimeQuerySubscriptionInternal) {
        // NOCOMMIT: Revive from eviction...
    }

    public removeQuerySubscriptionDependent(
        querySubscription: TaskRealtimeQuerySubscriptionInternal,
    ) {
        // NOCOMMIT: Mark for eviction...
    }
}
