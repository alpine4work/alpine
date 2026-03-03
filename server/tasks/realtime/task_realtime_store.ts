import {CalendarDate} from "@internationalized/date";
import {OpensearchClientDocWithIdAndVersion} from "~/server/opensearch/opensearch_client.js";
import {applyTaskActionToTaskIndexDoc} from "~/server/tasks/data/apply_task_action_to_task_index_doc.js";
import {applyTaskCollectionActionToCollectionIndexDoc} from "~/server/tasks/data/apply_task_collection_action_to_collection_index_doc.js";
import {applyTaskUpdateAccountNameToTaskIndexDoc} from "~/server/tasks/data/apply_task_update_account_name_to_task_index_doc.js";
import {createEmptyTaskCollectionIndexDoc} from "~/server/tasks/data/create_empty_task_collection_index_doc.js";
import {createEmptyTaskIndexDoc} from "~/server/tasks/data/create_empty_task_index_doc.js";
import {
    TaskCollectionIndexActualDoc,
    TaskCollectionIndexDoc,
} from "~/server/tasks/data/task_collection_index_doc.js";
import {
    getTaskCollectionIndexDocsIfExist,
    getTaskIndexDocsIfExist,
} from "~/server/tasks/data/task_index.js";
import {TaskIndexActualDoc, TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    TaskRealtimeProcessContext,
    TaskRealtimeSystemActionContext,
} from "~/server/tasks/data/task_realtime_context.js";
import {ReadonlyTaskRealtimeActionHistory} from "~/server/tasks/realtime/task_realtime_action_history.js";
import {
    TaskRealtimeCollectionSubscription,
    TaskRealtimeCollectionSubscriptionCallbacks,
    TaskRealtimeCollectionSubscriptionInternal,
} from "~/server/tasks/realtime/task_realtime_collection_subscription.js";
import {TaskRealtimeQuery} from "~/server/tasks/realtime/task_realtime_query.js";
import {
    TaskRealtimeQuerySubscription,
    TaskRealtimeQuerySubscriptionCallbacks,
} from "~/server/tasks/realtime/task_realtime_query_subscription.js";
import {TaskRealtimeTaskReferencesSubscriptionBase} from "~/server/tasks/realtime/task_realtime_task_references_subscription_base.js";
import {
    TaskRealtimeTaskSubscription,
    TaskRealtimeTaskSubscriptionCallbacks,
    TaskRealtimeTaskSubscriptionInternal,
} from "~/server/tasks/realtime/task_realtime_task_subscription.js";
import {
    TaskRealtimeActionTransactionUpdateEventBuilder,
    TaskRealtimeUpdateEventBuilderBase,
} from "~/server/tasks/realtime/task_realtime_update_event_builder.js";
import {InternalError} from "~/shared/error/error.js";
import {isNonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {stringifyForDeepEqualCheck} from "~/shared/helpers/control/stringify_for_deep_equal_check.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {
    AccountId,
    SpaceId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskRealtimeQueryLoadedState} from "~/shared/tasks/task_realtime_protocol.js";

/**
 * This class is the main component of our task realtime implementation. It keeps
 * track of queries and tasks that clients are subscribed to and keeps them
 * up-to-date in realtime for a space.
 *
 * The store itself has a map of `TaskId`s to task objects and a set of subscribed
 * queries. When you load a query we check to see if the exact query already
 * exists, if it doesn't then we load the query fresh and start tracking it in our
 * store.
 *
 * Whenever the task realtime server receives a new action transaction, it must add
 * it to the realtime action history and apply it to the relevant store.
 */
// TODO(calebmer, #tracer): I'd like to add some task realtime query store metrics
// using whatever metrics system we setup. Metrics like query count, task count,
// collection count, and query subscription count would be useful.
export class TaskRealtimeStore {
    public readonly spaceId: SpaceId;
    private readonly _internal: TaskRealtimeStoreInternal;
    private readonly _onFatalError: () => void;

    private _isDestroyed = false;

    constructor(options: {
        spaceId: SpaceId;
        actionHistory: ReadonlyTaskRealtimeActionHistory;
        ensureFullActionHistory: (context: TaskRealtimeSystemActionContext) => Promise<void>;
        scheduleEviction: () => void;
        onFatalError: () => void;
    }) {
        this.spaceId = options.spaceId;
        this._internal = new TaskRealtimeStoreInternal(options);
        this._onFatalError = options.onFatalError;

        if (process.env.NODE_ENV !== "production") {
            this._internal.assertCorrectForTest();
        }
    }

    public assertEmptyForTest(): void {
        this._internal.assertEmptyForTest();
    }

    private _handleFatalError(context: TaskRealtimeProcessContext, error: unknown) {
        if (this._isDestroyed) return;

        context.tracer.withSpanSync("Destroying task realtime query store", context => {
            this._isDestroyed = true;

            // Calling this should have the server delete its reference to this store. That way
            // the next request will create a fresh store.
            this._onFatalError();

            this._internal.onFatalError(
                context,
                InternalError.from(
                    error,
                    "Destroying task realtime query store after unexpected error",
                ),
            );
        });
    }

    /**
     * Any error from our task realtime query store destroys the store and prevents
     * anyone from interacting with the store. Connections which were subscribed to the
     * store are closed with an `InternalError` so may try to reconnect.
     *
     * It's an arrow function so we can pass it around as a value without calling
     * `this._withErrorHandling.bind(this)`.
     */
    private readonly _withFatalErrorHandling = <Value>(
        context: TaskRealtimeProcessContext,
        action: () => Promise<Value>,
    ): Promise<Value> => {
        assert(!this._isDestroyed);

        return action().then(
            value => {
                // If our query store was destroyed while the action was running then we don't want
                // to return a result which may have corrupt results. Instead throw an error.
                if (this._isDestroyed) {
                    throw new InternalError(
                        "Can\u2019t return result because task realtime query store was destroyed",
                    );
                }

                // Make sure our store's state is correct after any action on our store...
                if (process.env.NODE_ENV !== "production") {
                    this._internal.assertCorrectForTest();
                }

                return value;
            },
            error => {
                this._handleFatalError(context, error);
                throw error;
            },
        );
    };

    public async loadQuery(
        context: TaskRealtimeSystemActionContext,
        options: {
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            limit: number;
        },
    ): Promise<{
        loadedState: TaskRealtimeQueryLoadedState;
        tasks: Array<TaskIndexDoc>;
    }> {
        return this._withFatalErrorHandling(context, () =>
            this._internal.loadQuery(context, options),
        );
    }

    public subscribeToQuery({
        filters,
        sorts,
        callbacks,
    }: {
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        callbacks: TaskRealtimeQuerySubscriptionCallbacks;
    }): TaskRealtimeQuerySubscription {
        assert(!this._isDestroyed);
        const query = this._internal.getQuery({filters, sorts});
        return new TaskRealtimeQuerySubscription(query, callbacks, this._withFatalErrorHandling);
    }

    public subscribeToTask(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        {taskId, callbacks}: {taskId: TaskId; callbacks: TaskRealtimeTaskSubscriptionCallbacks},
    ): Promise<TaskRealtimeTaskSubscription> {
        return this._withFatalErrorHandling(context, async () => {
            const taskEntry = await this._internal.loadTaskEntry(context, taskId);

            return new TaskRealtimeTaskSubscription(context, eventBuilder, taskEntry, callbacks);
        });
    }

    public subscribeToCollection(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        {
            collectionId,
            callbacks,
        }: {
            collectionId: TaskCollectionId;
            callbacks: TaskRealtimeCollectionSubscriptionCallbacks;
        },
    ): Promise<TaskRealtimeCollectionSubscription> {
        return this._withFatalErrorHandling(context, async () => {
            const collectionEntry = await this._internal.loadCollectionEntry(context, collectionId);

            return new TaskRealtimeCollectionSubscription(
                context,
                eventBuilder,
                collectionEntry,
                callbacks,
            );
        });
    }

    public applyActionTransaction(
        context: TaskRealtimeSystemActionContext,
        actionTransaction: {
            actions: ReadonlyArray<TaskAction>;
            clientId: TaskRealtimeClientId | null;
        },
        actionReferencedAccountById: ReadonlyMap<AccountId, AccountModel>,
    ): Promise<void> {
        return this._withFatalErrorHandling(context, () =>
            this._internal.applyActionTransaction(
                context,
                actionTransaction,
                actionReferencedAccountById,
            ),
        );
    }

    public async getTask(
        context: TaskRealtimeSystemActionContext,
        taskId: TaskId,
    ): Promise<TaskIndexDoc> {
        assert(!this._isDestroyed);

        // No error handling since this method is relatively self contained and should
        // handle errors gracefully on its own without putting the store class in partially
        // failed state.
        const taskEntry = await this._internal.loadTaskEntry(context, taskId);

        return taskEntry.task;
    }

    public async getCollection(
        context: TaskRealtimeSystemActionContext,
        collectionId: TaskCollectionId,
    ): Promise<TaskCollectionIndexDoc> {
        assert(!this._isDestroyed);

        // No error handling since this method is relatively self contained and should
        // handle errors gracefully on its own without putting the store class in partially
        // failed state.
        const collectionEntry = await this._internal.loadCollectionEntry(context, collectionId);

        return collectionEntry.collection;
    }

    public getTaskIfLoaded(taskId: TaskId): TaskIndexDoc | undefined {
        assert(!this._isDestroyed);
        return this._internal.getTaskIfLoaded(taskId);
    }

    public getCollectionIfLoaded(
        collectionId: TaskCollectionId,
    ): TaskCollectionIndexDoc | undefined {
        assert(!this._isDestroyed);
        return this._internal.getCollectionIfLoaded(collectionId);
    }

    public evict(context: TaskRealtimeProcessContext): void {
        assert(!this._isDestroyed);

        try {
            this._internal.evict();
        } catch (error) {
            this._handleFatalError(context, error);
            throw error;
        }
    }
}

export const taskRealtimeStoreBeforeLoadTaskTestCheckpoint = new TestCheckpoint<SpaceId>();
export const taskRealtimeStoreBeforeLoadCollectionTestCheckpoint = new TestCheckpoint<SpaceId>();

// Our store implementation has some public methods that `TaskRealtimeQuery` is
// allowed to call but external users of `TaskRealtimeStore` should not (e.g.
// `onQueryTasksLoad`). These methods are public on this internal class and we have
// a wrapper `TaskRealtimeStore` class with a public interface.
export class TaskRealtimeStoreInternal {
    public readonly spaceId: SpaceId;
    public readonly actionHistory: ReadonlyTaskRealtimeActionHistory;

    /**
     * Ensure that we have a full action history for this store's space when the
     * promise resolves. If our service was recently discovered that means we haven't
     * been receiving actions so we don't have a full view of history.
     */
    public readonly ensureFullActionHistory: (
        context: TaskRealtimeSystemActionContext,
    ) => Promise<void>;

    /**
     * Tell our realtime server that we should schedule an eviction for this store. The
     * server has an eviction timer and will call the evict procedure on any stores
     * which need an eviction.
     *
     * If this function is called multiple times before our eviction procedure is
     * called it will only register our store once.
     *
     * Calling this function is an optimization to avoid needing to call the eviction
     * procedure on every store whenever the server eviction timer fires. So it's ok to
     * occasionally run an eviction procedure on our store when the store has no
     * evictable items.
     */
    private readonly _scheduleEviction: () => void;

    /**
     * All the queries maintained by our query store. The queries are keyed by
     * `{filters, sorts}` stringified by `stringifyForDeepEqualCheck()`. This allows us
     * to efficiently reuse a query that shares normalized filters and sorts.
     */
    private readonly _queries = new Map<string, TaskRealtimeQuery>();

    /**
     * Multiple queries may refer to the same task so we store task objects here
     * instead of in `TaskRealtimeQuery`. We keep a reference to all the queries which
     * subscribe to the task and evict any tasks that have no subscribed queries.
     *
     * Queries a task is visible in are accessible in the `queryDependencies` set. A
     * task may not be visible in every query whose filters pass for the task. That's
     * because when we load 100 tasks for a new query, we don't want to spend the time
     * checking whether those tasks are part of unrelated queries. Queries discover new
     * visible tasks in two ways:
     *
     * 1. When loading more tasks a query consults OpenSearch and the action history to
     *    find new visible tasks in its new loaded range
     * 2. When actions are applied a hidden task may become visible
     */
    private readonly _taskEntryById = new Map<TaskId, TaskRealtimeStoreTaskEntry>();

    /**
     * If we see an action that affects a task in a way that might make it visible in
     * one of our queries then we need to load the full task from OpenSearch so we can
     * add it to the query (after confirming the task matches our query's filters).
     *
     * If we are currently loading a task it will show up in this map. That way we can
     * dedupe requests to load tasks.
     */
    private readonly _loadingTaskPromiseById = new Map<
        TaskId,
        PromiseImmediate<TaskRealtimeStoreTaskEntry>
    >();

    private _scheduledTaskLoadBatch: Array<{
        readonly taskId: TaskId;
        readonly promiseResolver: PromiseResolver<TaskRealtimeStoreTaskEntry | null>;
    }> | null = null;

    /**
     * Collections we've loaded from OpenSearch and keep up-to-date in realtime in our
     * store.
     *
     * Similar to `taskEntryById`.
     */
    private readonly _collectionEntryById = new Map<
        TaskCollectionId,
        TaskRealtimeStoreCollectionEntry
    >();

    /**
     * Similar to `loadingTaskPromiseById` but for collections.
     */
    private readonly _loadingCollectionPromiseById = new Map<
        TaskCollectionId,
        PromiseImmediate<TaskRealtimeStoreCollectionEntry>
    >();

    private _scheduledCollectionLoadBatch: Array<{
        readonly collectionId: TaskCollectionId;
        readonly promiseResolver: PromiseResolver<TaskRealtimeStoreCollectionEntry | null>;
    }> | null = null;

    // The set of items to evict from our query store the next time our server's
    // eviction timeout is called. It's essential we evict items from the store in a
    // timely manner when they're no longer referenced or else we'll have a memory leak
    // and eventually our server will fail with an out-of-memory exception.
    //
    // Each item type has two sets. The "open" set and the "next" set.
    //
    // - The open set is where we add newly evictable items. When the last reference
    //   to, say, a task is removed then we add it to the `TaskId` open evictable set
    //   and schedule an eviction.
    //
    // - The next set is the set of items we'll actually evict when the eviction timer
    //   runs. When the eviction timer runs we evict everything in the next set and
    //   move the open set to the next set.
    //
    // We use this two-set setup so that once an item is made evictable it has a
    // guaranteed minimum duration it will stay alive in case some other client wants
    // to rescue it from eviction. When an item is made evictable it will stay alive
    // for at least one eviction timeout duration (configured at the server level).
    private _isEvicting = false;
    private _openEvictableQueries = new Set<TaskRealtimeQuery>();
    private _nextEvictableQueries = new Set<TaskRealtimeQuery>();
    private _openEvictableTaskIds = new Set<TaskId>();
    private _nextEvictableTaskIds = new Set<TaskId>();
    private _openEvictableCollectionIds = new Set<TaskCollectionId>();
    private _nextEvictableCollectionIds = new Set<TaskCollectionId>();

    constructor({
        spaceId,
        actionHistory,
        ensureFullActionHistory,
        scheduleEviction,
    }: {
        spaceId: SpaceId;
        actionHistory: ReadonlyTaskRealtimeActionHistory;
        ensureFullActionHistory: (context: TaskRealtimeSystemActionContext) => Promise<void>;
        scheduleEviction: () => void;
    }) {
        this.spaceId = spaceId;
        this.actionHistory = actionHistory;
        this.ensureFullActionHistory = ensureFullActionHistory;
        this._scheduleEviction = scheduleEviction;
    }

    public assertCorrectForTest() {
        // We run this validation in `development` and `test` since maintaining state
        // correctly across the store and query class is a little tricky to get right but
        // critical to the operation of the task realtime service.
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

    public assertEmptyForTest() {
        assert(process.env.NODE_ENV === "test");

        assert(
            this._queries.size === 0,
            `Expected store to have 0 queries but instead it has ${this._queries.size}`,
        );

        assert(
            this._taskEntryById.size === 0,
            `Expected store to have 0 tasks but instead it has ${this._taskEntryById.size}`,
        );

        assert(
            this._collectionEntryById.size === 0,
            `Expected store to have 0 collections but instead it has ${this._collectionEntryById.size}`,
        );
    }

    /**
     * If a task is loaded in our store then this function will return it. The task is
     * up-to-date in realtime.
     */
    public getTaskIfLoaded(taskId: TaskId) {
        return this._taskEntryById.get(taskId)?.task;
    }

    /**
     * If a collection is loaded in our store then this function will return it. The
     * collection is up-to-date in realtime.
     */
    public getCollectionIfLoaded(collectionId: TaskCollectionId) {
        return this._collectionEntryById.get(collectionId)?.collection;
    }

    /**
     * Get the task entry for the provided `TaskId` if the task exists and is loaded in
     * our store.
     */
    public getTaskEntryIfExists(taskId: TaskId): TaskRealtimeStoreTaskEntry | undefined {
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
     * Ensure an entry exists in our store for the provided task. If we create a new
     * entry we will return `isFresh: true`.
     */
    public ensureTaskEntry(task: TaskIndexDoc): {
        isFresh: boolean;
        taskEntry: TaskRealtimeStoreTaskEntry;
    } {
        const taskEntry = this._taskEntryById.get(task.id);
        if (taskEntry !== undefined) return {isFresh: false, taskEntry};

        // If we haven't seen this task before it's "fresh". The task may be outdated so
        // we'll need to apply the actions from our action history to catch it up.
        const freshTaskEntry = new TaskRealtimeStoreTaskEntry(this, task);
        this._taskEntryById.set(task.id, freshTaskEntry);

        return {isFresh: true, taskEntry: freshTaskEntry};
    }

    /**
     * Get a query for the provided filters and sorts. We will reuse queries with
     * identical filters and sorts. If a subscription is not promptly added then the
     * query will be evicted on the next eviction cycle.
     */
    public getQuery({
        filters,
        sorts,
    }: {
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    }) {
        return getOrSetDefaultMapValue(
            this._queries,
            stringifyForDeepEqualCheck<CalendarDate>({filters, sorts}, date => date.toString()),
            () => new TaskRealtimeQuery(this, {filters, sorts}),
        );
    }

    /**
     * Executes a query and keeps it up-to-date in realtime as long as there are
     * subscribers. If an equivalent query is already in our store then we reuse the
     * already loaded data from that query.
     *
     * May return fewer tasks than we requested with `limit`. This happens in realtime
     * edge cases where we start loading tasks before a realtime event that moves tasks
     * outside of the loaded range. Also remember that we start loading tasks from
     * OpenSearch which is ~60s behind. Up to the client to check how many tasks were
     * loaded and decide whether they need to load more tasks.
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
        loadedState: TaskRealtimeQueryLoadedState;
        tasks: Array<TaskIndexDoc>;
    }> {
        assert(Number.isInteger(limit));

        const query = this.getQuery({filters, sorts});

        // Load enough tasks to satisfy our `limit`.
        await query.loadMoreTasks(context, limit - query.getLoadedTaskCount());

        return query.getLoadedTasks({
            limit,
            afterCursor: null,
        });
    }

    /**
     * Apply a committed action transaction to our store after we've added the
     * transaction to our action history. Does the following:
     *
     * - Reports any updates to subscribed queries
     * - If the transaction hides a task in a query then we remove the task from the
     *   query
     * - We iterate through all queries to see if an updated task that was hidden in
     *   the query will now be visible
     * - If the transaction updates a task that's not in our store then we ignore it
     *   unless we suspect the updated task will be visible in a query, then we load
     *   the task from OpenSearch and check
     */
    public applyActionTransaction(
        context: TaskRealtimeSystemActionContext,
        actionTransaction: {
            actions: ReadonlyArray<TaskAction>;
            clientId: TaskRealtimeClientId | null;
        },
        actionReferencedAccountById: ReadonlyMap<AccountId, AccountModel>,
    ): Promise<void> {
        const eventBuilder = new TaskRealtimeActionTransactionUpdateEventBuilder({
            spaceId: this.spaceId,
            originClientId: actionTransaction.clientId,
            actionReferencedAccountById,
        });

        const queriesByMaybeAddVisibleTaskIdToLoad = this._applyActionTransactionSync(
            context,
            actionTransaction.actions,
            actionReferencedAccountById,
            eventBuilder,
        );

        return this._applyActionTransactionAsync(
            context,
            queriesByMaybeAddVisibleTaskIdToLoad,
            eventBuilder,
        );
    }

    // The synchronous part of `applyActionTransaction()`. Carefully updates our data
    // structures while assuming no concurrent code is running which would observe a
    // partial state.
    private _applyActionTransactionSync(
        context: TaskRealtimeSystemActionContext,
        actions: ReadonlyArray<TaskAction>,
        actionReferencedAccountById: ReadonlyMap<AccountId, AccountModel>,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
    ) {
        const taskEntryUpdateById = new Map<
            TaskId,
            {
                taskEntry: TaskRealtimeStoreTaskEntry;
                oldTask: TaskIndexDoc | null;
                actions: Array<TaskAction>;
                // We capture query subscriptions when we create an entry in this map since the
                // query subscription set may change when we call into our event handlers like
                // `query.onVisibleTaskUpdate()`.
                //
                // We only want to update subscriptions that were subscribed at the start of this
                // function call.
                taskReferencesSubscriptions: Array<TaskRealtimeTaskReferencesSubscriptionBase>;
            }
        >();

        const collectionEntryUpdateById = new Map<
            TaskCollectionId,
            {
                collectionEntry: TaskRealtimeStoreCollectionEntry;
                oldCollection: TaskCollectionIndexDoc | null;
                actions: Array<TaskAction>;
                taskReferencesSubscriptions: Array<TaskRealtimeTaskReferencesSubscriptionBase>;
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
                            accountId => {
                                const account = assertExists(
                                    actionReferencedAccountById.get(accountId),
                                );
                                return {
                                    accountId,
                                    workingAccountName: account.initialData.name,
                                    workingAccountNameVersion: account.initialData.nameVersion,
                                };
                            },
                        );
                        taskEntry.task = newTask;

                        // Always treat task as updated even if `oldTask === newTask`.
                        //
                        // We may have loaded in data from OpenSearch that's ahead of the actions we
                        // received. If OpenSearch has already incorporated an action then
                        // `oldTask === newTask` but we still want to deliver the action to the client.
                        //
                        // This also means we deliver all actions to the client regardless of whether its a
                        // noop. This seems like good behavior.
                        getOrSetDefaultMapValue(taskEntryUpdateById, action.taskId, () => ({
                            taskEntry,
                            oldTask,
                            actions: [],
                            taskReferencesSubscriptions: Array.from(
                                taskEntry.iterateTaskReferencesSubscriptionDependents(),
                            ),
                        })).actions.push(action);
                    }
                    // If this action creates a task then create a new task entry in our store. We
                    // assume some user will actively care about subscribing to this task. Otherwise
                    // the task will be eventually evicted.
                    else if (action.taskAction.type === "Create") {
                        const task = createEmptyTaskIndexDoc(action.time, action.taskAction);

                        const account = assertExists(
                            actionReferencedAccountById.get(action.taskAction.creatorId),
                        );

                        const taskEntry = new TaskRealtimeStoreTaskEntry(this, {
                            id: action.taskId,
                            spaceId: this.spaceId,
                            ...task,
                            creator: {
                                accountId: action.taskAction.creatorId,
                                workingAccountName: account.initialData.name,
                                workingAccountNameVersion: account.initialData.nameVersion,
                            },
                        });
                        this._taskEntryById.set(action.taskId, taskEntry);

                        getOrSetDefaultMapValue(taskEntryUpdateById, action.taskId, () => ({
                            taskEntry,
                            oldTask: null,
                            actions: [],
                            taskReferencesSubscriptions: Array.from(
                                taskEntry.iterateTaskReferencesSubscriptionDependents(),
                            ),
                        })).actions.push(action);
                    }
                    // If we do not have an entry for this task, then check with all our queries to see
                    // if this action might result in a new visible task. We need to load these tasks
                    // to fully compare them against the query's filters.
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

                        getOrSetDefaultMapValue(
                            collectionEntryUpdateById,
                            action.collectionId,
                            () => ({
                                collectionEntry,
                                oldCollection,
                                actions: [],
                                taskReferencesSubscriptions: Array.from(
                                    collectionEntry.iterateTaskReferencesSubscriptionDependents(),
                                ),
                            }),
                        ).actions.push(action);
                    } else if (action.collectionAction.type === "Create") {
                        const collection = createEmptyTaskCollectionIndexDoc(
                            action.time,
                            action.collectionAction,
                        );

                        const collectionEntry = new TaskRealtimeStoreCollectionEntry(this, {
                            id: action.collectionId,
                            spaceId: this.spaceId,
                            ...collection,
                        });
                        this._collectionEntryById.set(action.collectionId, collectionEntry);

                        getOrSetDefaultMapValue(
                            collectionEntryUpdateById,
                            action.collectionId,
                            () => ({
                                collectionEntry,
                                oldCollection: null,
                                actions: [],
                                taskReferencesSubscriptions: Array.from(
                                    collectionEntry.iterateTaskReferencesSubscriptionDependents(),
                                ),
                            }),
                        ).actions.push(action);
                    }
                    break;
                }
                case "UpdateAccountName": {
                    for (const taskEntry of this._taskEntryById.values()) {
                        const oldTask = taskEntry.task;
                        const newTask = applyTaskUpdateAccountNameToTaskIndexDoc(oldTask, action);

                        // If nothing changed in the task (probably because the account is not referenced
                        // by the task) then ignore and carry on.
                        if (oldTask === newTask) break;

                        taskEntry.task = newTask;

                        // Clients won't see this action if no affected tasks were updated.
                        //
                        // This is different than the `UpdateTask` and `UpdateCollection` behavior where we
                        // always send actions down to clients even if the task doesn't change. For
                        // correctness, it should be ok to not send noop actions. More so we choose to send
                        // noop actions for completeness. Sending a noop update account name action to
                        // every task regardless of whether it's affected seems inefficient so we're ok
                        // sacrificing completeness.
                        getOrSetDefaultMapValue(taskEntryUpdateById, newTask.id, () => ({
                            taskEntry,
                            oldTask,
                            actions: [],
                            taskReferencesSubscriptions: Array.from(
                                taskEntry.iterateTaskReferencesSubscriptionDependents(),
                            ),
                        })).actions.push(action);
                    }
                    break;
                }
                case "UpdateNotepadPage": {
                    break;
                }
                default:
                    throw exhaustive(action);
            }
        }

        // 1. Process collection updates in task references subscriptions (query
        //    subscriptions and task subscriptions) and direct collection subscriptions.
        for (const {
            collectionEntry,
            oldCollection,
            actions,
            taskReferencesSubscriptions,
        } of collectionEntryUpdateById.values()) {
            assert(isNonEmptyReadonlyArray(actions));

            if (oldCollection !== null) {
                // Update task references subscriptions (query subscriptions and task
                // subscriptions):
                for (const subscription of taskReferencesSubscriptions) {
                    subscription.onReferencedCollectionUpdate(
                        context,
                        eventBuilder,
                        collectionEntry.collection.id,
                        oldCollection,
                        collectionEntry.collection,
                        actions,
                    );
                }

                // Update direct collection subscriptions:
                for (const subscription of collectionEntry.iterateCollectionSubscriptionDependents()) {
                    subscription.onCollectionUpdate(
                        context,
                        eventBuilder,
                        collectionEntry.collection.id,
                        oldCollection,
                        collectionEntry.collection,
                        actions,
                    );
                }
            }
        }

        const alreadyAppliedTaskEntryUpdateIds = new Set<TaskId>();

        const applyTaskEntryUpdate = ({
            taskEntry,
            oldTask,
            actions,
            taskReferencesSubscriptions,
        }: {
            taskEntry: TaskRealtimeStoreTaskEntry;
            oldTask: TaskIndexDoc | null;
            actions: Array<TaskAction>;
            taskReferencesSubscriptions: Array<TaskRealtimeTaskReferencesSubscriptionBase>;
        }) => {
            if (alreadyAppliedTaskEntryUpdateIds.has(taskEntry.task.id)) return;
            alreadyAppliedTaskEntryUpdateIds.add(taskEntry.task.id);

            assert(isNonEmptyReadonlyArray(actions));

            if (oldTask !== null) {
                // Update task references subscriptions (query subscriptions and task
                // subscriptions):
                for (const subscription of taskReferencesSubscriptions) {
                    subscription.onReferencedTaskUpdate(
                        context,
                        eventBuilder,
                        taskEntry.task.id,
                        oldTask,
                        taskEntry.task,
                        actions,
                    );
                }

                // Update direct task subscriptions:
                for (const subscription of taskEntry.iterateTaskSubscriptionDependents()) {
                    subscription.onTaskUpdate(
                        context,
                        eventBuilder,
                        taskEntry.task.id,
                        oldTask,
                        taskEntry.task,
                        actions,
                    );
                }

                // Update direct query subscriptions:
                for (const query of taskEntry.iterateQueryDependents()) {
                    const {isStillVisible} = query.onVisibleTaskUpdate(
                        context,
                        eventBuilder,
                        taskEntry.task.id,
                        oldTask,
                        taskEntry.task,
                        actions,
                    );
                    if (!isStillVisible) {
                        taskEntry.removeQueryDependent(query);
                    }
                }
            }

            // Attempt to add updated tasks to all our queries in case an update made the task
            // visible in the query.
            for (const query of this._queries.values()) {
                if (taskEntry.hasQueryDependent(query)) continue;

                const {isVisible} = query.maybeAddVisibleTask(
                    context,
                    eventBuilder,
                    taskEntry.task,
                );
                if (isVisible) {
                    taskEntry.addQueryDependent(query);
                }
            }
        };

        const onReferencedTaskAddOrRemove = (taskId: TaskId) => {
            const taskEntryUpdate = taskEntryUpdateById.get(taskId);

            if (taskEntryUpdate) {
                applyTaskEntryUpdate(taskEntryUpdate);
            }
        };

        assert(this._onReferencedTaskAddOrRemove === null);
        this._onReferencedTaskAddOrRemove = onReferencedTaskAddOrRemove;
        try {
            // 2. Process task updates in task references subscriptions (query subscriptions
            //    and task subscriptions), direct task subscriptions, and direct query
            //    subscriptions.
            for (const taskEntryUpdate of taskEntryUpdateById.values()) {
                applyTaskEntryUpdate(taskEntryUpdate);
            }
        } finally {
            this._onReferencedTaskAddOrRemove = null;
        }

        return queriesByMaybeAddVisibleTaskIdToLoad;
    }

    private async _applyActionTransactionAsync(
        context: TaskRealtimeSystemActionContext,
        queriesByMaybeAddVisibleTaskIdToLoad: Map<TaskId, Set<TaskRealtimeQuery>>,
        eventBuilder: TaskRealtimeActionTransactionUpdateEventBuilder,
    ) {
        await runAllPromises(
            Array.from(queriesByMaybeAddVisibleTaskIdToLoad, async ([taskId, queries]) => {
                const taskEntry = await this.loadTaskEntry(context, taskId);

                for (const query of queries) {
                    // If the task is still not visible in this query (some concurrent process may have
                    // made it visible) then attempt to add the task to the query given the task passes
                    // the query's filters.
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
        // actions need to go to which clients while still preserving the atomicity of a
        // transaction.
        await eventBuilder.finishAndSendEvents(context);
    }

    private _onReferencedTaskAddOrRemove: ((taskId: TaskId) => void) | null = null;

    public onReferencedTaskAddOrRemove(taskId: TaskId) {
        this._onReferencedTaskAddOrRemove?.(taskId);
    }

    /**
     * Load an entry for a task from OpenSearch and put it in `taskEntryById`.
     *
     * Batches and dedupes load requests behind the scenes.
     *
     * If we can't find a task then we'll retry for a bit and eventually throw an
     * error. It's expected when you call this method that the underlying task exists.
     * If it doesn't that must mean our index is stale so we retry for a bit.
     *
     * Returns a `PromiseImmediate` that resolves synchronously if the task is already
     * available in the store.
     */
    public loadTaskEntry(
        context: TaskRealtimeSystemActionContext,
        taskId: TaskId,
    ): PromiseImmediate<TaskRealtimeStoreTaskEntry> {
        // If we've already loaded the task, great! No need to load it now.
        const taskEntry = this._taskEntryById.get(taskId);
        if (taskEntry !== undefined) return PromiseImmediate.resolve(taskEntry);

        return getOrSetDefaultMapValue(this._loadingTaskPromiseById, taskId, () => {
            return PromiseImmediate.resolve(
                retryWithExponentialBackoff(async retry => {
                    const taskEntry = await this._loadTaskEntryIfExists(context, taskId);

                    if (!taskEntry) {
                        throw retry(new InternalError("Task not found"));
                    }

                    return taskEntry;
                }),
            );
        });
    }

    private _loadTaskEntryIfExists(
        context: TaskRealtimeSystemActionContext,
        taskId: TaskId,
    ): Promise<TaskRealtimeStoreTaskEntry | null> {
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

        const promiseResolver = createPromiseResolver<TaskRealtimeStoreTaskEntry | null>();
        this._scheduledTaskLoadBatch.push({taskId, promiseResolver});

        // Once the promise has settled, delete it from `loadingTaskPromiseById`. You can
        // now get the task from `taskEntryById`.
        //
        // If the task entry is evicted then we should create a new loading promise.
        promiseResolver.promise.then(
            () => this._loadingTaskPromiseById.delete(taskId),
            () => this._loadingTaskPromiseById.delete(taskId),
        );

        return promiseResolver.promise;
    }

    private async _executeLoadTaskBatch(
        context: TaskRealtimeSystemActionContext,
        taskLoadBatch: Array<{
            taskId: TaskId;
            promiseResolver: PromiseResolver<TaskRealtimeStoreTaskEntry | null>;
        }>,
    ): Promise<void> {
        await taskRealtimeStoreBeforeLoadTaskTestCheckpoint.waitForTest(this.spaceId);

        const [tasks] = await runAllPromises([
            getTaskIndexDocsIfExist(
                context,
                this.spaceId,
                taskLoadBatch.map(({taskId}) => taskId),
            ),
            // We need to make sure we have a full action history store before calling
            // `_executeLoadTaskBatchSync()` which needs the action history to catch up our
            // OpenSearch query result.
            this.ensureFullActionHistory(context),
        ]);

        this._executeLoadTaskBatchSync(context, taskLoadBatch, tasks);
    }

    // The synchronous part of `_executeLoadTaskBatch()` to be run after the network
    // request. It's useful to make this synchronous since we'll be updating our
    // internal store state and we don't want to think about concurrent
    // readers/writers.
    private _executeLoadTaskBatchSync(
        context: TaskRealtimeSystemActionContext,
        taskLoadBatch: Array<{
            taskId: TaskId;
            promiseResolver: PromiseResolver<TaskRealtimeStoreTaskEntry | null>;
        }>,
        tasks: ReadonlyArray<OpensearchClientDocWithIdAndVersion<
            TaskId,
            TaskIndexActualDoc
        > | null>,
    ): void {
        const freshTaskById = new Map<
            TaskId,
            {
                freshTask: TaskIndexDoc;
                promiseResolver: PromiseResolver<TaskRealtimeStoreTaskEntry | null>;
            }
        >();

        // Check if any of the tasks were loaded concurrently while we were waiting on our
        // network request. We can immediately resolve any that were.
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
                    const {
                        version,
                        lastIndexSearchEntityJob,
                        approximateActionCountByAccountId,
                        ...freshTask
                    } = task;

                    freshTaskById.set(taskId, {
                        freshTask,
                        promiseResolver,
                    });
                }
            }
        }

        // Catch up our tasks which are freshly loaded from OpenSearch with any actions in
        // our history so they're up-to-date in realtime.
        for (const [taskId, {freshTask, promiseResolver}] of freshTaskById) {
            let task = freshTask;

            this.actionHistory.iterateTaskActions(
                context.tracer.getTracer(),
                this.spaceId,
                taskId,
                (action, {getActionReferencedSortableAccount}) => {
                    if (action.type === "UpdateTask") {
                        task = applyTaskActionToTaskIndexDoc(
                            task,
                            action.time,
                            action.taskAction,
                            getActionReferencedSortableAccount,
                        );
                    } else {
                        cast<"UpdateAccountName">(action.type);

                        task = applyTaskUpdateAccountNameToTaskIndexDoc(task, action);
                    }
                },
            );

            const taskEntry = new TaskRealtimeStoreTaskEntry(this, task);
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
    ): PromiseImmediate<TaskRealtimeStoreCollectionEntry> {
        // If we've already loaded the collection, great! No need to load it now.
        const collectionEntry = this._collectionEntryById.get(collectionId);
        if (collectionEntry !== undefined) return PromiseImmediate.resolve(collectionEntry);

        return getOrSetDefaultMapValue(this._loadingCollectionPromiseById, collectionId, () => {
            return PromiseImmediate.resolve(
                retryWithExponentialBackoff(async retry => {
                    const taskEntry = await this._loadCollectionEntryIfExists(
                        context,
                        collectionId,
                    );

                    if (!taskEntry) {
                        throw retry(new InternalError("Task not found"));
                    }

                    return taskEntry;
                }),
            );
        });
    }

    private _loadCollectionEntryIfExists(
        context: TaskRealtimeSystemActionContext,
        collectionId: TaskCollectionId,
    ): Promise<TaskRealtimeStoreCollectionEntry | null> {
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

        const promiseResolver = createPromiseResolver<TaskRealtimeStoreCollectionEntry | null>();
        this._scheduledCollectionLoadBatch.push({collectionId, promiseResolver});

        // Once the promise has settled, delete it from `loadingCollectionPromiseById`. You
        // can now get the task from `collectionEntryById`.
        //
        // If the task entry is evicted then we should create a new loading promise.
        promiseResolver.promise.then(
            () => this._loadingCollectionPromiseById.delete(collectionId),
            () => this._loadingCollectionPromiseById.delete(collectionId),
        );

        return promiseResolver.promise;
    }

    private async _executeLoadCollectionBatch(
        context: TaskRealtimeSystemActionContext,
        collectionLoadBatch: Array<{
            collectionId: TaskCollectionId;
            promiseResolver: PromiseResolver<TaskRealtimeStoreCollectionEntry | null>;
        }>,
    ): Promise<void> {
        await taskRealtimeStoreBeforeLoadCollectionTestCheckpoint.waitForTest(this.spaceId);

        const [collections] = await runAllPromises([
            getTaskCollectionIndexDocsIfExist(
                context,
                this.spaceId,
                collectionLoadBatch.map(({collectionId}) => collectionId),
            ),
            // We need to make sure we have a full action history store before calling
            // `_executeLoadCollectionBatchSync()` which needs the action history to catch up
            // our OpenSearch query result.
            this.ensureFullActionHistory(context),
        ]);

        this._executeLoadCollectionBatchSync(context, collectionLoadBatch, collections);
    }

    // The synchronous part of `_executeLoadCollectionBatch()` to be run after the
    // network request. It's useful to make this synchronous since we'll be updating
    // our internal store state and we don't want to think about concurrent
    // readers/writers.
    private _executeLoadCollectionBatchSync(
        context: TaskRealtimeSystemActionContext,
        collectionLoadBatch: Array<{
            collectionId: TaskCollectionId;
            promiseResolver: PromiseResolver<TaskRealtimeStoreCollectionEntry | null>;
        }>,
        collections: ReadonlyArray<OpensearchClientDocWithIdAndVersion<
            TaskCollectionId,
            TaskCollectionIndexActualDoc
        > | null>,
    ): void {
        const freshCollectionById = new Map<
            TaskCollectionId,
            {
                freshCollection: TaskCollectionIndexDoc;
                promiseResolver: PromiseResolver<TaskRealtimeStoreCollectionEntry | null>;
            }
        >();

        // Check if any of the collections were loaded concurrently while we were waiting
        // on our network request. We can immediately resolve any that were.
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
                    const {version, ...freshCollection} = collection;

                    freshCollectionById.set(collectionId, {
                        freshCollection,
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
                action => {
                    collection = applyTaskCollectionActionToCollectionIndexDoc(
                        collection,
                        action.time,
                        action.collectionAction,
                    );
                },
            );

            const collectionEntry = new TaskRealtimeStoreCollectionEntry(this, collection);

            this._collectionEntryById.set(collectionId, collectionEntry);

            promiseResolver.resolve(collectionEntry);
        }
    }

    private _getEvictableCount() {
        return (
            this._openEvictableQueries.size +
            this._nextEvictableQueries.size +
            this._openEvictableTaskIds.size +
            this._nextEvictableTaskIds.size +
            this._openEvictableCollectionIds.size +
            this._nextEvictableCollectionIds.size
        );
    }

    public addEvictableQuery(query: TaskRealtimeQuery) {
        if (!this._nextEvictableQueries.has(query)) {
            this._openEvictableQueries.add(query);

            // If this is the first evictable item in the store, register ourselves for the
            // next eviction.
            if (!this._isEvicting && this._getEvictableCount() === 1) this._scheduleEviction();
        }
    }

    public removeEvictableQuery(query: TaskRealtimeQuery) {
        if (!this._openEvictableQueries.delete(query)) {
            this._nextEvictableQueries.delete(query);
        }
    }

    public addEvictableTaskId(taskId: TaskId) {
        if (!this._nextEvictableTaskIds.has(taskId)) {
            this._openEvictableTaskIds.add(taskId);

            // If this is the first evictable item in the store, register ourselves for the
            // next eviction.
            if (!this._isEvicting && this._getEvictableCount() === 1) this._scheduleEviction();
        }
    }

    public removeEvictableTaskId(taskId: TaskId) {
        if (!this._openEvictableTaskIds.delete(taskId)) {
            this._nextEvictableTaskIds.delete(taskId);
        }
    }

    public addEvictableCollectionId(collectionId: TaskCollectionId) {
        if (!this._openEvictableCollectionIds.has(collectionId)) {
            this._nextEvictableCollectionIds.add(collectionId);

            // If this is the first evictable item in the store, register ourselves for the
            // next eviction.
            if (!this._isEvicting && this._getEvictableCount() === 1) this._scheduleEviction();
        }
    }

    public removeEvictableCollectionId(collectionId: TaskCollectionId) {
        if (!this._openEvictableCollectionIds.delete(collectionId)) {
            this._nextEvictableCollectionIds.delete(collectionId);
        }
    }

    public evict() {
        this._isEvicting = true;
        try {
            let evictQueries: Set<TaskRealtimeQuery> | null = this._nextEvictableQueries;
            this._nextEvictableQueries = this._openEvictableQueries;
            this._openEvictableQueries = new Set();

            let evictTaskIds: Set<TaskId> | null = this._nextEvictableTaskIds;
            this._nextEvictableTaskIds = this._openEvictableTaskIds;
            this._openEvictableTaskIds = new Set();

            let evictCollectionIds: Set<TaskCollectionId> | null = this._nextEvictableCollectionIds;
            this._nextEvictableCollectionIds = this._openEvictableCollectionIds;
            this._openEvictableCollectionIds = new Set();

            // If in the process of evicting one of our items, another item becomes evictable
            // then we want to evict that item too. Since it means the previous item we evicted
            // was its one reference and that one reference was dead.
            //
            // This happens when we destroy queries. If a query has 10 loaded tasks which have
            // no other references when the query is destroyed then we also want to evict those
            // tasks.
            while (
                (evictQueries && evictQueries.size > 0) ||
                (evictTaskIds && evictTaskIds.size > 0) ||
                (evictCollectionIds && evictCollectionIds.size > 0)
            ) {
                if (evictQueries) {
                    for (const query of evictQueries) {
                        assert(
                            this._queries.delete(
                                stringifyForDeepEqualCheck<CalendarDate>(
                                    {filters: query.filters, sorts: query.sorts},
                                    date => date.toString(),
                                ),
                            ),
                        );

                        query.destroy();
                    }
                }

                if (evictTaskIds) {
                    for (const taskId of evictTaskIds) {
                        assert(this._taskEntryById.delete(taskId));
                    }
                }

                if (evictCollectionIds) {
                    for (const collectionId of evictCollectionIds) {
                        assert(this._collectionEntryById.delete(collectionId));
                    }
                }

                if (this._openEvictableQueries.size > 0) {
                    evictQueries = this._openEvictableQueries;
                    this._openEvictableQueries = new Set();
                } else {
                    evictQueries = null;
                }

                if (this._openEvictableTaskIds.size > 0) {
                    evictTaskIds = this._openEvictableTaskIds;
                    this._openEvictableTaskIds = new Set();
                } else {
                    evictTaskIds = null;
                }

                if (this._openEvictableCollectionIds.size > 0) {
                    evictCollectionIds = this._openEvictableCollectionIds;
                    this._openEvictableCollectionIds = new Set();
                } else {
                    evictCollectionIds = null;
                }
            }

            // If we have more to evict in our `next*` evictable sets then schedule an eviction
            // for the next timer run. Our `open*` evictable sets should be exhausted.
            if (this._getEvictableCount() > 0) this._scheduleEviction();
        } finally {
            this._isEvicting = false;
        }
    }

    public onFatalError(context: TaskRealtimeProcessContext, error: InternalError) {
        for (const query of this._queries.values()) {
            query.onFatalError(context, error);
        }

        for (const taskEntry of this._taskEntryById.values()) {
            for (const subscription of taskEntry.iterateTaskSubscriptionDependents()) {
                subscription.onFatalError(context, error);
            }
        }

        for (const collectionEntry of this._collectionEntryById.values()) {
            for (const subscription of collectionEntry.iterateCollectionSubscriptionDependents()) {
                subscription.onFatalError(context, error);
            }
        }
    }
}

/**
 * The representation of a task in our store.
 */
export class TaskRealtimeStoreTaskEntry {
    public readonly store: TaskRealtimeStoreInternal;

    /** The current task object. */
    public task: TaskIndexDoc;

    /**
     * Queries that depend on this task. If a query is in this set then our task must
     * be visible in the query.
     */
    private readonly _queryDependents = new Set<TaskRealtimeQuery>();

    /**
     * Direct subscriptions to this task (not through references).
     */
    private readonly _taskSubscriptionDependents = new Set<TaskRealtimeTaskSubscriptionInternal>();

    /**
     * Tasks reference all their parent tasks, recursively.
     */
    private readonly _taskReferencesSubscriptionDependents =
        new Set<TaskRealtimeTaskReferencesSubscriptionBase>();

    constructor(store: TaskRealtimeStoreInternal, initialTask: TaskIndexDoc) {
        this.store = store;
        this.task = initialTask;

        this.store.addEvictableTaskId(this.task.id);

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

    private _getDependentCount() {
        return (
            this._queryDependents.size +
            this._taskSubscriptionDependents.size +
            this._taskReferencesSubscriptionDependents.size
        );
    }

    public iterateQueryDependents() {
        return this._queryDependents.values();
    }

    public hasQueryDependent(query: TaskRealtimeQuery) {
        return this._queryDependents.has(query);
    }

    public addQueryDependent(query: TaskRealtimeQuery) {
        const wasEvictable = this._getDependentCount() === 0;
        this._queryDependents.add(query);
        if (wasEvictable) this.store.removeEvictableTaskId(this.task.id);
    }

    public removeQueryDependent(query: TaskRealtimeQuery) {
        if (process.env.NODE_ENV !== "production") {
            assert(this._queryDependents.has(query), "Query was not added as a dependent to task");
        }

        this._queryDependents.delete(query);
        const isEvictable = this._getDependentCount() === 0;
        if (isEvictable) this.store.addEvictableTaskId(this.task.id);
    }

    public iterateTaskSubscriptionDependents() {
        return this._taskSubscriptionDependents.values();
    }

    public addTaskSubscriptionDependent(subscription: TaskRealtimeTaskSubscriptionInternal) {
        const wasEvictable = this._getDependentCount() === 0;
        this._taskSubscriptionDependents.add(subscription);
        if (wasEvictable) this.store.removeEvictableTaskId(this.task.id);
    }

    public removeTaskSubscriptionDependent(subscription: TaskRealtimeTaskSubscriptionInternal) {
        this._taskSubscriptionDependents.delete(subscription);
        const isEvictable = this._getDependentCount() === 0;
        if (isEvictable) this.store.addEvictableTaskId(this.task.id);
    }

    public iterateTaskReferencesSubscriptionDependents() {
        return this._taskReferencesSubscriptionDependents.values();
    }

    public addTaskReferencesSubscriptionDependent(
        subscription: TaskRealtimeTaskReferencesSubscriptionBase,
    ) {
        const wasEvictable = this._getDependentCount() === 0;
        this._taskReferencesSubscriptionDependents.add(subscription);
        if (wasEvictable) this.store.removeEvictableTaskId(this.task.id);
    }

    public removeTaskReferencesSubscriptionDependent(
        subscription: TaskRealtimeTaskReferencesSubscriptionBase,
    ) {
        this._taskReferencesSubscriptionDependents.delete(subscription);
        const isEvictable = this._getDependentCount() === 0;
        if (isEvictable) this.store.addEvictableTaskId(this.task.id);
    }
}

export class TaskRealtimeStoreCollectionEntry {
    public readonly store: TaskRealtimeStoreInternal;
    public collection: TaskCollectionIndexDoc;

    /**
     * Direct subscriptions to this collection (not through references).
     */
    private readonly _collectionSubscriptionDependents =
        new Set<TaskRealtimeCollectionSubscriptionInternal>();

    /**
     * A task references all of its collections and all collections of task parents,
     * recursively.
     */
    private readonly _taskReferencesSubscriptionDependents =
        new Set<TaskRealtimeTaskReferencesSubscriptionBase>();

    constructor(store: TaskRealtimeStoreInternal, initialCollection: TaskCollectionIndexDoc) {
        this.store = store;
        this.collection = initialCollection;

        this.store.addEvictableCollectionId(this.collection.id);

        // In test and development environments make sure `this.collection = newCollection`
        // never changes the `TaskCollectionId`. In production this is a simple property
        // getter/setter.
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

    private _getDependentCount() {
        return (
            this._collectionSubscriptionDependents.size +
            this._taskReferencesSubscriptionDependents.size
        );
    }

    public iterateCollectionSubscriptionDependents() {
        return this._collectionSubscriptionDependents.values();
    }

    public addCollectionSubscriptionDependent(
        subscription: TaskRealtimeCollectionSubscriptionInternal,
    ) {
        const wasEvictable = this._getDependentCount() === 0;
        this._collectionSubscriptionDependents.add(subscription);
        if (wasEvictable) this.store.removeEvictableCollectionId(this.collection.id);
    }

    public removeCollectionSubscriptionDependent(
        subscription: TaskRealtimeCollectionSubscriptionInternal,
    ) {
        this._collectionSubscriptionDependents.delete(subscription);
        const isEvictable = this._getDependentCount() === 0;
        if (isEvictable) this.store.addEvictableCollectionId(this.collection.id);
    }

    public iterateTaskReferencesSubscriptionDependents() {
        return this._taskReferencesSubscriptionDependents.values();
    }

    public addTaskReferencesSubscriptionDependent(
        subscription: TaskRealtimeTaskReferencesSubscriptionBase,
    ) {
        const wasEvictable = this._getDependentCount() === 0;
        this._taskReferencesSubscriptionDependents.add(subscription);
        if (wasEvictable) this.store.removeEvictableCollectionId(this.collection.id);
    }

    public removeTaskReferencesSubscriptionDependent(
        subscription: TaskRealtimeTaskReferencesSubscriptionBase,
    ) {
        this._taskReferencesSubscriptionDependents.delete(subscription);
        const isEvictable = this._getDependentCount() === 0;
        if (isEvictable) this.store.addEvictableCollectionId(this.collection.id);
    }
}
