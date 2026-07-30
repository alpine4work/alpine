import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {authorizeTaskAccessIfPossible} from "~/server/tasks/data/authorization/authorize_task_access_if_possible.js";
import {authorizeTaskCollectionAccess} from "~/server/tasks/data/authorization/authorize_task_collection_access.js";
import {authorizeTaskCollectionAccessIfPossible} from "~/server/tasks/data/authorization/authorize_task_collection_access_if_possible.js";
import {authorizeTaskQueryAccess} from "~/server/tasks/data/authorization/authorize_task_query_access.js";
import {backfillTaskActionTransactionHistory} from "~/server/tasks/data/backfill_task_action_transaction_history.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    TaskRealtimeActionContext,
    TaskRealtimeProcessContext,
    TaskRealtimeSystemActionContext,
} from "~/server/tasks/data/task_realtime_context.js";
import {TaskRealtimeActionHistory} from "~/server/tasks/realtime/task_realtime_action_history.js";
import {
    TaskRealtimeCollectionSubscription,
    TaskRealtimeCollectionSubscriptionCallbacks,
} from "~/server/tasks/realtime/task_realtime_collection_subscription.js";
import {
    TaskRealtimeQuerySubscription,
    TaskRealtimeQuerySubscriptionCallbacks,
} from "~/server/tasks/realtime/task_realtime_query_subscription.js";
import {TaskRealtimeStore} from "~/server/tasks/realtime/task_realtime_store.js";
import {
    TaskRealtimeTaskSubscription,
    TaskRealtimeTaskSubscriptionCallbacks,
} from "~/server/tasks/realtime/task_realtime_task_subscription.js";
import {TaskRealtimeUpdateEventBuilderBase} from "~/server/tasks/realtime/task_realtime_update_event_builder.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {ErrorBase, FailedPreconditionError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {
    AccountId,
    SiteId,
    SpaceId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {collectReferencedIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_ids_from_task_action.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskQueryDefaults} from "~/shared/tasks/task_query_defaults.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskRealtimeQueryLoadedState} from "~/shared/tasks/task_realtime_protocol.js";

// Run the query store eviction procedure every minute. When an item in the query
// store is made evictable it is guaranteed to survive at least one eviction call.
// This means items will be evicted from the query store at most within two minutes
// of becoming evictable.
const taskRealtimeServerEvictionMs = 1000 * 60;

/**
 * The horizontally scalable task realtime server. We don't actually run the HTTP
 * server from this class (see `task_realtime_service.ts`). This class manages all
 * the logic and state associated with the server.
 *
 * Each space is routed to 1+ task realtime servers. These servers are responsible
 * for executing queries and managing realtime WebSocket connections.
 */
export class TaskRealtimeServer {
    /**
     * If the server is currently running then our state is non-null. If the server has
     * stopped running then state is null.
     */
    private _state: {
        /**
         * Whether our server has been discovered yet. We consider our server discovered
         * when all other services in our system know about it.
         *
         * When our server is discovered, `sendActionTransaction()` will be called for
         * every action we need to care about across our system. Before this promise
         * resolves we don't have that guarantee.
         */
        readonly discoveredPromise: Promise<{readonly discoveredTime: number}>;

        /**
         * The timeout for our server's eviction procedure.
         */
        readonly evictTimeout: Timeout;
    } | null = null;

    private readonly _processContext: TaskRealtimeProcessContext;
    private readonly _actionHistory: TaskRealtimeActionHistory;
    private readonly _startActionHistory: () => void;
    private readonly _stopActionHistory: () => void;
    private readonly _backfillActionHistoryPromiseBySpaceId = new Map<SpaceId, Promise<void>>();
    private _scheduledStoresForEviction = new Set<TaskRealtimeStore>();
    private _disableActionHistoryBackfillForTest?: boolean;

    private readonly _storeBySpaceId = new DefaultMap<SpaceId, TaskRealtimeStore>(spaceId => {
        const store: TaskRealtimeStore = new TaskRealtimeStore({
            spaceId,
            actionHistory: this._actionHistory,
            ensureFullActionHistory: context => this._ensureFullActionHistory(context, spaceId),
            scheduleEviction: () => this._scheduledStoresForEviction.add(store),
            // When there's an internal error handling something in the store, we destroy the
            // store and let the next request create a fresh store. The store should also be
            // responsible for closing any WebSocket connections that were subscribed to the
            // store.
            onFatalError: () => this._storeBySpaceId.delete(spaceId),
        });

        return store;
    });

    private constructor(context: TaskRealtimeProcessContext) {
        const [actionHistory, {start: startActionHistory, stop: stopActionHistory}] =
            TaskRealtimeActionHistory.new();

        this._processContext = context;
        this._actionHistory = actionHistory;
        this._startActionHistory = startActionHistory;
        this._stopActionHistory = stopActionHistory;
    }

    public static new(
        context: TaskRealtimeProcessContext,
    ): [TaskRealtimeServer, {start: (discoveredPromise: Promise<void>) => void; stop: () => void}] {
        const server = new TaskRealtimeServer(context);
        return [
            server,
            {
                start: discoveredPromise => server._start(discoveredPromise),
                stop: () => server._stop(),
            },
        ];
    }

    public assertEmptyForTest() {
        assert(process.env.NODE_ENV === "test");

        for (const store of this._storeBySpaceId.values()) {
            store.assertEmptyForTest();
        }
    }

    /**
     * Start running our server. We don't actually run the HTTP server from this class,
     * only all the logic and state.
     *
     * Must pass in a `discoveredPromise`. This promise should resolve when all other
     * services in our system have discovered this task realtime server. Importantly,
     * this means once the promise has resolved then `sendActionTransaction()` should
     * be called for every new action transaction we need to care about. We may receive
     * some calls to `query()` or `sendActionTransaction()` before we've been fully
     * discovered. However, some server functionality must wait for the server to be
     * discovered.
     */
    private _start(discoveredPromise: Promise<void>) {
        assert(this._state === null);

        this._startActionHistory();

        const evict = () => {
            const startTime = Date.now();

            this._evict();

            const endTime = Date.now();
            state.evictTimeout = createTimeout(
                evict,
                taskRealtimeServerEvictionMs - (endTime - startTime),
            );
        };

        const state = {
            discoveredPromise: discoveredPromise.then(() => ({
                discoveredTime: Date.now(),
            })),
            evictTimeout: createTimeout(evict, taskRealtimeServerEvictionMs),
        };

        this._state = state;
    }

    /**
     * Stops our server from running.
     */
    private _stop() {
        assert(this._state !== null);
        this._state.evictTimeout.clear();
        this._state = null;
        this._stopActionHistory();

        // In tests, backfill when the server starts again. Restarting the server resets
        // `clearActionHistoryForTest()`.
        if (this._disableActionHistoryBackfillForTest === true) {
            this._disableActionHistoryBackfillForTest = false;
        }
    }

    private _evict() {
        if (this._scheduledStoresForEviction.size === 0) return;

        this._processContext.tracer.withSpanSync(
            "Evicting dead items from task realtime server",
            context => {
                const stores = this._scheduledStoresForEviction;
                this._scheduledStoresForEviction = new Set();

                for (const store of stores) {
                    context.tracer.withSpanSync(
                        "Evicting dead items from task realtime query store",
                        (context, span) => {
                            span.addData({context: {spaceId: store.spaceId}});

                            try {
                                store.evict(context);
                            } catch {
                                span.addException(span);

                                // Don't rethrow the error. If an eviction call fails we report it in our span and
                                // continue.
                            }
                        },
                    );
                }
            },
        );
    }

    /**
     * Immediately evict all dead items from our server. You may only run this in test
     * environments.
     */
    public evictAllForTest() {
        assert(process.env.NODE_ENV === "test");

        this._evict();
        this._evict();

        // Dead items stay around for at least one eviction. So we need to evict twice to
        // evict everything. Assert that once we evict twice there are no more scheduled
        // evictions.
        assert(
            this._scheduledStoresForEviction.size === 0,
            "Expected two evictions to be enough to evict everything",
        );
    }

    /**
     * Clear the action history in test environments. You should only do this if you
     * know the task index has incorporated all actions and refreshed!
     */
    public clearActionHistoryForTest() {
        assert(import.meta.jest);

        // Calling stop/start on action history clears it.
        if (this._state !== null) {
            this._stopActionHistory();
            this._startActionHistory();
        }

        // Don't backfill history. We want to pretend like time has moved past when the
        // history visible window starts.
        this._disableActionHistoryBackfillForTest = true;
    }

    /**
     * Ensure that we have a full action history for the provided space. If our server
     * was recently discovered that means we haven't been receiving
     * `sendActionTransaction()` calls and we need to catch up.
     */
    private async _ensureFullActionHistory(
        context: TaskRealtimeSystemActionContext,
        spaceId: SpaceId,
    ) {
        assert(this._state !== null);
        const {discoveredTime} = await this._state.discoveredPromise;
        const visibleStartTime = this._actionHistory.getVisibleStartTime();

        // If our history visibility window starts after we were discovered then we have
        // already received every relevant action.
        //
        // This also means we should never need to make a backfill request again for the
        // rest of our server's lifetime. So clear the backfill promise cache to free up
        // some memory.
        if (visibleStartTime >= discoveredTime) {
            this._backfillActionHistoryPromiseBySpaceId.clear();
            return;
        }

        if (this._disableActionHistoryBackfillForTest === true) {
            assert(import.meta.jest);
            return;
        }

        return await getOrSetDefaultMapValue(
            this._backfillActionHistoryPromiseBySpaceId,
            spaceId,
            async () => {
                const actionTransactions = await backfillTaskActionTransactionHistory(
                    context,
                    spaceId,
                    new Date(visibleStartTime),
                );

                const referencedAccountIds = new Set<AccountId>();
                // NOTE(ifitzsimmons, 2026-03-12): we don't currently use these referenced site ids
                // anywhere. The reason we collect Account IDs is to put them into
                // `TaskRealtimeActionHistorySpaceSegment.actionReferencedAccountById` in order to
                // compute `TaskQuerySortCursor`s. We don't currently plan on sorting by site, so
                // there's no need to collect the `SitePreviewModel`s of the referenced sites.
                const referencedSiteIds = new Set<SiteId>();
                for (const actionTransaction of actionTransactions) {
                    for (const action of actionTransaction.actions) {
                        collectReferencedIdsFromTaskAction(
                            referencedAccountIds,
                            referencedSiteIds,
                            action,
                        );
                    }
                }

                const referencedAccounts = await runAllPromises(
                    Array.from(referencedAccountIds, accountId =>
                        getAccount(context, spaceId, accountId, {
                            // It's important that we read our referenced accounts with a strong read
                            // consistency to make sure our realtime server sees the correct account name.
                            //
                            // After we've finished committing the new account name we're also guaranteed to
                            // have commit the update name task action. So the action will always be applied on
                            // our server after the new account name is visible with a strong read consistency.
                            // This means we'll never miss an account name update. Actions applied after the
                            // update name task action will always see the correct account name.
                            consistency: "Strong",
                        }),
                    ),
                );

                for (const actionTransaction of actionTransactions) {
                    // Add the action transaction to our history but don't send it to connected clients
                    // since the action happened in the past. If a client asks for a backfill we will
                    // serve them one using our action history class.
                    this._actionHistory.addActionTransaction(actionTransaction, referencedAccounts);
                }
            },
        );
    }

    public async loadQuery(
        context: TaskRealtimeSystemActionContext,
        options: {
            spaceId: SpaceId;
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            limit: number;
        },
    ): Promise<{
        loadedState: TaskRealtimeQueryLoadedState;
        tasks: Array<TaskIndexDoc>;
    }> {
        // Must be a system actor because we do no filtering to check whether you are
        // allowed to see the queried tasks. Permissions filtering is done at a different
        // level.
        context.actor.authorizeSystem();

        await authorizeSpaceAccess(context, options.spaceId);

        const store = this._storeBySpaceId.getOrSetDefault(options.spaceId);
        return await store.loadQuery(context, options);
    }

    public async expensivelyLoadQueryAfterCursor(
        context: TaskRealtimeSystemActionContext,
        options: {
            spaceId: SpaceId;
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            limit: number;
            afterCursor: TaskQuerySortCursor | null;
        },
    ): Promise<{
        loadedState: TaskRealtimeQueryLoadedState;
        tasks: Array<TaskIndexDoc>;
    }> {
        // Must be a system actor because we do no filtering to check whether you are
        // allowed to see the queried tasks. Permissions filtering is done at a different
        // level.
        context.actor.authorizeSystem();

        await authorizeSpaceAccess(context, options.spaceId);

        const store = this._storeBySpaceId.getOrSetDefault(options.spaceId);
        return await store.expensivelyLoadQueryAfterCursor(context, options);
    }

    public async subscribeToQuery(
        context: TaskRealtimeSystemActionContext,
        options: {
            spaceId: SpaceId;
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            callbacks: TaskRealtimeQuerySubscriptionCallbacks;
        },
    ): Promise<TaskRealtimeQuerySubscription> {
        // Must be a system actor because we do no filtering to check whether you are
        // allowed to see the queried tasks. Permissions filtering is done at a different
        // level.
        context.actor.authorizeSystem();

        await authorizeSpaceAccess(context, options.spaceId);

        const store = this._storeBySpaceId.getOrSetDefault(options.spaceId);
        return store.subscribeToQuery(options);
    }

    public async subscribeToTask(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        options: {
            spaceId: SpaceId;
            taskId: TaskId;
            callbacks: TaskRealtimeTaskSubscriptionCallbacks;
        },
    ): Promise<TaskRealtimeTaskSubscription> {
        // Must be a system actor because we do no authorization to check whether you are
        // allowed to see the task.
        context.actor.authorizeSystem();

        await authorizeSpaceAccess(context, options.spaceId);

        const store = this._storeBySpaceId.getOrSetDefault(options.spaceId);
        return await store.subscribeToTask(context, eventBuilder, options);
    }

    public async subscribeToCollection(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        options: {
            spaceId: SpaceId;
            collectionId: TaskCollectionId;
            callbacks: TaskRealtimeCollectionSubscriptionCallbacks;
        },
    ): Promise<TaskRealtimeCollectionSubscription> {
        // Must be a system actor because we do no authorization to check whether you are
        // allowed to see the collection.
        context.actor.authorizeSystem();

        await authorizeSpaceAccess(context, options.spaceId);

        const store = this._storeBySpaceId.getOrSetDefault(options.spaceId);
        return await store.subscribeToCollection(context, eventBuilder, options);
    }

    public async applyActionTransaction(
        context: TaskRealtimeSystemActionContext,
        actionTransaction: {
            spaceId: SpaceId;
            committedTime: Date;
            actions: ReadonlyArray<TaskAction>;
            clientId: TaskRealtimeClientId | null;
        },
    ) {
        // Must be a system actor since the action transaction doesn't include information
        // about the actor which committed it.
        context.actor.authorizeSystem();

        await authorizeSpaceAccess(context, actionTransaction.spaceId);

        const referencedAccountIds = new Set<AccountId>();
        // NOTE(ifitzsimmons, 2026-03-12): we don't currently use these referenced site ids
        // anywhere. The reason we collect Account IDs is to put them into
        // `TaskRealtimeActionHistorySpaceSegment.actionReferencedAccountById` in order to
        // compute `TaskQuerySortCursor`s. We don't currently plan on sorting by site, so
        // there's no need to collect the `SitePreviewModel`s of the referenced sites.
        const referencedSiteIds = new Set<SiteId>();
        for (const action of actionTransaction.actions) {
            collectReferencedIdsFromTaskAction(referencedAccountIds, referencedSiteIds, action);
        }

        const referencedAccounts = await runAllPromises(
            Array.from(referencedAccountIds, accountId =>
                getAccount(context, actionTransaction.spaceId, accountId, {
                    // It's important that we read our referenced accounts with a strong read
                    // consistency to make sure our realtime server sees the correct account name.
                    //
                    // After we've finished committing the new account name we're also guaranteed to
                    // have commit the update name task action. So the action will always be applied on
                    // our server after the new account name is visible with a strong read consistency.
                    // This means we'll never miss an account name update. Actions applied after the
                    // update name task action will always see the correct account name.
                    consistency: "Strong",
                }),
            ),
        );

        const referencedAccountById = new Map(
            referencedAccounts.map(account => [account.id, account]),
        );

        this._actionHistory.addActionTransaction(actionTransaction, referencedAccounts);

        const store = this._storeBySpaceId.get(actionTransaction.spaceId);
        await store?.applyActionTransaction(context, actionTransaction, referencedAccountById);
    }

    /**
     * Get the provided task from our realtime store. If the task is in our store we
     * will return immediately. Otherwise we will load the task from OpenSearch and
     * catch it up so it's up-to-date in realtime.
     *
     * If the task does not exist we will throw an error. It may take a while to throw
     * a not found error since the task might not exist _yet_. You may know about a
     * task before it's indexed in OpenSearch. In that case we retry until a timeout is
     * reached.
     */
    public async getTask(
        context: TaskRealtimeSystemActionContext,
        spaceId: SpaceId,
        taskId: TaskId,
    ): Promise<TaskIndexDoc> {
        // Must be a system actor because we do no filtering to check whether you are
        // allowed to see the task.
        context.actor.authorizeSystem();

        await authorizeSpaceAccess(context, spaceId);

        const store = this._storeBySpaceId.getOrSetDefault(spaceId);
        return await store.getTask(context, taskId);
    }

    /**
     * Get the provided collection from our realtime store. If the collection is in our
     * store we will return immediately. Otherwise we will load the collection from
     * OpenSearch and catch it up so it's up-to-date in realtime.
     *
     * If the collection does not exist we will throw an error. It may take a while to
     * throw a not found error since the collection might not exist _yet_. You may know
     * about a collection before it's indexed in OpenSearch. In that case we retry
     * until a timeout is reached.
     */
    public async getCollection(
        context: TaskRealtimeSystemActionContext,
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
    ): Promise<TaskCollectionIndexDoc> {
        // Must be a system actor because we do no filtering to check whether you are
        // allowed to see the task.
        context.actor.authorizeSystem();

        await authorizeSpaceAccess(context, spaceId);

        const store = this._storeBySpaceId.getOrSetDefault(spaceId);
        return await store.getCollection(context, collectionId);
    }

    /**
     * Authorizes that an account actor has access to a query. Throws an error if we're
     * unauthorized.
     *
     * Will use in-memory tasks/collections when available and otherwise will load from
     * DynamoDB.
     */
    public async authorizeQueryAccess(
        context: TaskRealtimeActionContext,
        {
            spaceId,
            filters,
            sorts,
            consistency,
        }: {
            spaceId: SpaceId;
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            consistency?: DynamoCacheReadConsistency;
        },
    ) {
        await authorizeTaskQueryAccess(
            context,
            {
                spaceId,
                filters,
                sorts,
                consistency,
            },
            {
                getTaskIndexDocIfExists: taskId =>
                    this._storeBySpaceId.get(spaceId)?.getTaskIfLoaded(taskId),
                getCollectionIndexDocIfExists: collectionId =>
                    this._storeBySpaceId.get(spaceId)?.getCollectionIfLoaded(collectionId),
            },
        );
    }

    /**
     * Authorizes that an account actor has access to a task. Throws an error if we're
     * unauthorized.
     *
     * Will use in-memory tasks/collections when available and otherwise will load from
     * DynamoDB.
     */
    public async authorizeTaskAccess(
        context: TaskRealtimeActionContext,
        spaceId: SpaceId,
        taskId: TaskId,
        expectedAccessLevel: AccessLevel,
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<void> {
        const {spaceId: actualSpaceId} = await authorizeTaskAccess(
            context,
            taskId,
            expectedAccessLevel,
            {
                getTaskIndexDocIfExists: taskId =>
                    this._storeBySpaceId.get(spaceId)?.getTaskIfLoaded(taskId),
                getCollectionIndexDocIfExists: collectionId =>
                    this._storeBySpaceId.get(spaceId)?.getCollectionIfLoaded(collectionId),
            },
            options,
        );

        if (actualSpaceId !== spaceId) {
            throw new FailedPreconditionError("Tried loading `TaskId` with the wrong `SpaceId`");
        }
    }

    /**
     * Authorizes that an account actor has access to a task. Throws an error if we're
     * unauthorized.
     *
     * Will use in-memory tasks/collections when available and otherwise will load from
     * DynamoDB.
     */
    public async authorizeTaskAccessIfPossible(
        context: TaskRealtimeActionContext,
        spaceId: SpaceId,
        taskId: TaskId,
        expectedAccessLevel: AccessLevel,
        options?: {consistency?: DynamoCacheReadConsistency; dangerouslyAllowDeleted?: boolean},
    ): Promise<Result<void, ErrorBase> | null> {
        const result = await authorizeTaskAccessIfPossible(
            context,
            taskId,
            expectedAccessLevel,
            {
                getTaskIndexDocIfExists: taskId =>
                    this._storeBySpaceId.get(spaceId)?.getTaskIfLoaded(taskId),
                getCollectionIndexDocIfExists: collectionId =>
                    this._storeBySpaceId.get(spaceId)?.getCollectionIfLoaded(collectionId),
            },
            options,
        );
        if (result === null) return null;

        return mapResult(result, ({spaceId: actualSpaceId}) => {
            if (actualSpaceId !== spaceId) {
                throw new FailedPreconditionError(
                    "Tried loading `TaskId` with the wrong `SpaceId`",
                );
            }
        });
    }

    /**
     * Authorizes that an account actor has access to a collection. Throws an error if
     * we're unauthorized.
     *
     * Will use in-memory tasks/collections when available and otherwise will load from
     * DynamoDB.
     */
    public async authorizeCollectionAccess(
        context: TaskRealtimeActionContext,
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
        expectedAccessLevel: AccessLevel,
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<{defaults: TaskQueryDefaults}> {
        const {spaceId: actualSpaceId, defaults} = await authorizeTaskCollectionAccess(
            context,
            collectionId,
            expectedAccessLevel,
            {
                getCollectionIndexDocIfExists: collectionId =>
                    this._storeBySpaceId.get(spaceId)?.getCollectionIfLoaded(collectionId),
            },
            options,
        );

        if (actualSpaceId !== spaceId) {
            throw new FailedPreconditionError(
                "Tried loading `TaskCollectionId` with the wrong `SpaceId`",
            );
        }

        return {defaults};
    }

    /**
     * Authorizes that an account actor has access to a collection. Throws an error if
     * we're unauthorized.
     *
     * Will use in-memory tasks/collections when available and otherwise will load from
     * DynamoDB.
     */
    public async authorizeCollectionAccessIfPossible(
        context: TaskRealtimeActionContext,
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
        expectedAccessLevel: AccessLevel,
        options?: {consistency?: DynamoCacheReadConsistency; dangerouslyAllowDeleted?: boolean},
    ): Promise<Result<void, ErrorBase> | null> {
        const result = await authorizeTaskCollectionAccessIfPossible(
            context,
            collectionId,
            expectedAccessLevel,
            {
                getCollectionIndexDocIfExists: collectionId =>
                    this._storeBySpaceId.get(spaceId)?.getCollectionIfLoaded(collectionId),
            },
            options,
        );
        if (result === null) return null;

        return mapResult(result, ({spaceId: actualSpaceId}) => {
            if (actualSpaceId !== spaceId) {
                throw new FailedPreconditionError(
                    "Tried loading `TaskCollectionId` with the wrong `SpaceId`",
                );
            }
        });
    }
}
