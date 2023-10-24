import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {AppContext} from "~/client/context/app_context.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/task_client_collection_subscription.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/tasks/task_client_task_subscription.js";
import {WebSocketClient} from "~/client/web_socket/web_socket_client.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {Id, generateId} from "~/shared/id/id.js";
import {
    BrowserId,
    SpaceId,
    TaskRealtimeCollectionSubscriptionId,
    TaskRealtimeQuerySubscriptionId,
    TaskRealtimeTaskSubscriptionId,
} from "~/shared/id/types/id_types.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskRealtimeProtocol} from "~/shared/tasks/task_realtime_protocol.js";

/**
 * How long we should retain queries from the server that we don't know the
 * immediate purpose of. It's expected that UI code will find these queries and
 * take their own reference during this period. If the query was over-fetched
 * and the UI doesn't need it then once the retention period is up we'll
 * unsubscribe.
 *
 * Most commonly preloaded task children queries for grid view fall into this
 * bucket. We preload some children queries on the server in a best effort
 * fashion. We may use stale data and load a query for a task that's not
 * actually visible in the grid view. We unsubscribe from these unused queries
 * at the end of this retention period.
 */
export const unknownTaskQueryFromServerRetentionPeriodMs = 1000 * 5;

/**
 * Manages the client's realtime connection to `TaskRealtimeService` and owns
 * the `TaskClientDatabase` object. When we connect to the WebSocket we'll
 * subscribe to the queries in our store so we can keep them up-to-date in
 * realtime.
 */
export class TaskRealtimeClient {
    private readonly _getContext: () => AppContext;
    public readonly spaceId: SpaceId;
    private readonly _browserId: BrowserId;
    private readonly _onDisplayError: (options: {title: string; error: unknown}) => void;
    private readonly _client: WebSocketClient<typeof TaskRealtimeProtocol>;
    private _disconnect: (() => void) | null = null;

    public readonly store: TaskClientStore;

    private readonly _shouldLoadGridViewExpansionStateForQuery = new WeakSet<TaskClientQuery>();
    private readonly _initialGridViewExpansionStateByQuery = new WeakMap<
        TaskClientQuery,
        TaskGridViewExpansionState
    >();

    constructor(
        getContext: () => AppContext,
        {
            accountStore,
            spaceId,
            browserId,
            onDisplayError,
        }: {
            accountStore: AccountClientStore;
            spaceId: SpaceId;
            browserId: BrowserId;
            onDisplayError: (options: {title: string; error: unknown}) => void;
        },
    ) {
        this._getContext = getContext;
        this.spaceId = spaceId;
        this._browserId = browserId;
        this._onDisplayError = onDisplayError;

        this._client = new WebSocketClient(
            getContext,
            TaskRealtimeProtocol,
            `/api/task-realtime/${this.spaceId}`,
        );

        this.store = new TaskClientStore({
            accountStore,
            spaceId,
            onError: options => {
                if (options.display) {
                    onDisplayError(options);
                } else {
                    this._getContext()
                        .tracer.getRoot()
                        .logUncaughtException(
                            "Uncaught exception from task client store",
                            options.error,
                        );
                }
            },
        });
    }

    public connect() {
        assert(this._disconnect === null, "WebSocket is already connected");

        let connectionId: Id | null = null;

        this._client.connect();

        const subscriptionsStore = this.store.getSubscriptionsStore();

        const subscribedQueries = new Set<{
            query: TaskClientQuery;
            querySubscriptionIdPromise: Promise<TaskRealtimeQuerySubscriptionId>;
            unsubscribeFromLoadMoreTaskCount: () => void;
        }>();
        const subscribedTasks = new Set<{
            taskSubscription: TaskClientTaskSubscription;
            taskSubscriptionIdPromise: Promise<TaskRealtimeTaskSubscriptionId>;
        }>();
        const subscribedCollections = new Set<{
            collectionSubscription: TaskClientCollectionSubscription;
            collectionSubscriptionIdPromise: Promise<TaskRealtimeCollectionSubscriptionId>;
        }>();

        const unsubscribeFromState = this._client.state.subscribe(() => {
            const clientState = this._client.state.getSnapshot();

            if (clientState.isConnected && connectionId === null) {
                connectionId = generateId();
                updateSubscribedQueries();
            }

            if (!clientState.isConnected && connectionId !== null) {
                connectionId = null;
                updateSubscribedQueries();
            }
        });

        const unsubscribeFromEvents = this._client.subscribeToEvents(event => {
            this.store.applyUpdateEvent(event);
        });

        const updateSubscribedQueries = () => {
            // If our WebSocket client disconnects then none of our queries are subscribed
            // anymore. We'll resubscribe if the client reconnects.
            if (!connectionId) {
                for (const subscribedQuery of subscribedQueries) {
                    subscribedQuery.unsubscribeFromLoadMoreTaskCount();
                }
                subscribedQueries.clear();
                subscribedTasks.clear();
                subscribedCollections.clear();
                return;
            }

            const subscriptions = subscriptionsStore.getSnapshot();

            const newQueries = new Set(
                filterMapIterable(subscriptions.queries, ([query, {isUnsubscribing}]) =>
                    !isUnsubscribing ? query : null,
                ),
            );
            const newTaskSubscriptions = new Set(
                flatMapIterable(subscriptions.taskSubscriptionsById.values(), subscriptions =>
                    filterMapIterable(subscriptions, ([subscription, {isUnsubscribing}]) =>
                        !isUnsubscribing ? subscription : null,
                    ),
                ),
            );
            const newCollectionSubscriptions = new Set(
                flatMapIterable(subscriptions.collectionSubscriptionsById.values(), subscriptions =>
                    filterMapIterable(subscriptions, ([subscription, {isUnsubscribing}]) =>
                        !isUnsubscribing ? subscription : null,
                    ),
                ),
            );

            const oldSubscribedQueries = new Set<{
                query: TaskClientQuery;
                querySubscriptionIdPromise: Promise<TaskRealtimeQuerySubscriptionId>;
                unsubscribeFromLoadMoreTaskCount: () => void;
            }>();
            const oldSubscribedTasks = new Set<{
                taskSubscription: TaskClientTaskSubscription;
                taskSubscriptionIdPromise: Promise<TaskRealtimeTaskSubscriptionId>;
            }>();
            const oldSubscribedCollections = new Set<{
                collectionSubscription: TaskClientCollectionSubscription;
                collectionSubscriptionIdPromise: Promise<TaskRealtimeCollectionSubscriptionId>;
            }>();

            for (const subscribedQuery of subscribedQueries) {
                if (newQueries.delete(subscribedQuery.query)) continue;
                oldSubscribedQueries.add(subscribedQuery);
            }

            for (const subscribedTask of subscribedTasks) {
                if (newTaskSubscriptions.delete(subscribedTask.taskSubscription)) continue;
                oldSubscribedTasks.add(subscribedTask);
            }

            for (const subscribedCollection of subscribedCollections) {
                if (newCollectionSubscriptions.delete(subscribedCollection.collectionSubscription))
                    continue;
                oldSubscribedCollections.add(subscribedCollection);
            }

            // Subscribe to new queries, tasks, and collections:
            if (
                newQueries.size > 0 ||
                newTaskSubscriptions.size > 0 ||
                newCollectionSubscriptions.size > 0
            ) {
                const newQueriesArray = Array.from(newQueries);
                const newTaskSubscriptionsArray = Array.from(newTaskSubscriptions);
                const newCollectionSubscriptionsArray = Array.from(newCollectionSubscriptions);

                const newQueryLimits = newQueriesArray.map(
                    query =>
                        // If we're re-subscribing to a query that had many tasks then we want to load
                        // all those tasks back. If the query requested to load more tasks then add
                        // those on as well.
                        query.taskOrderStore.getSnapshot().length +
                        query.loadMoreTaskCountStore.getSnapshot(),
                );

                // When either:
                //
                // 1. Our WebSocket transitions to a connected state; OR
                // 2. A query is added to the store while our WebSocket is connected
                //
                // We want to subscribe to the new queries in our WebSocket. Subscribing will
                // backfill any realtime changes we've missed while the WebSocket was not
                // connected.
                //
                // TODO(calebmer): Currently calling `subscribe` sends the entire
                // query response to the client a second time. It would be nice if we only sent
                // changes between the last time the client was up-to-date and now. But given
                // our CRDT everything-is-unordered backend design it's hard to know what
                // actions the client has missed. This doesn't really affect perceived
                // performance for the user so even though it's wasteful we let it happen
                // for now. Maybe there's cool research around CRDT state vectors we can use
                // for syncing? A dumb optimization like a `lastModified` timestamp that noops
                // if the query was not modified since then could also work.
                const subscribePromise = this._client.procedures
                    .subscribe({
                        clientTime: this.store.clock.now(),
                        queries: newQueriesArray.map((query, i) => ({
                            limit: newQueryLimits[i]!,
                            filters: query.filters,
                            sorts: query.sorts,
                            shouldLoadGridViewExpandedChildTasksForBrowserId:
                                this._shouldLoadGridViewExpansionStateForQuery.delete(query)
                                    ? this._browserId
                                    : undefined,
                        })),
                        taskIds: newTaskSubscriptionsArray.map(
                            taskSubscription => taskSubscription.taskId,
                        ),
                        collectionIds: newCollectionSubscriptionsArray.map(
                            collectionSubscription => collectionSubscription.collectionId,
                        ),
                    })
                    .then(output => {
                        const extraQueriesToRelease: Array<TaskClientQuery> = [];

                        // After some period, release our reference to extra queries we received from
                        // the server. We hope our UI code has taken a reference to these queries.
                        setTimeout(() => {
                            batchStoreUpdates(() => {
                                for (const extraQuery of extraQueriesToRelease) {
                                    extraQuery.release();
                                }
                            });
                        }, unknownTaskQueryFromServerRetentionPeriodMs);

                        batchStoreUpdates(() => {
                            for (let i = 0; i < output.querySubscriptionResults.length; i++) {
                                const query = newQueriesArray[i]!;
                                const result = output.querySubscriptionResults[i]!;

                                if (!result.ok) {
                                    query.setError(result.error);
                                } else {
                                    query.clearError();

                                    this.store.loadTasksIntoQuery(query, {
                                        limit: newQueryLimits[i]!,
                                        loadedState: result.loadedState,
                                        previouslyBackfilledTaskIds:
                                            result.previouslyBackfilledTaskIds,
                                    });

                                    if (result.gridViewExpansionState) {
                                        this._initialGridViewExpansionStateByQuery.set(
                                            query,
                                            result.gridViewExpansionState,
                                        );
                                    }

                                    // The server may have subscribed us to some extra queries. Let's create query
                                    // models for these queries in our store. We retain them for ~5s then
                                    // unsubscribe from them if UI code doesn't retain the query.
                                    for (const extraQueryResult of result.extraQueries) {
                                        const extraQuery = this.store.createAndRetainQuery({
                                            filters: extraQueryResult.filters,
                                            sorts: extraQueryResult.sorts,
                                            // The client may, as an optimization, reuse an existing `TaskClientQuery` when
                                            // `createAndRetainQuery()` is called. However, we can't do that here! The
                                            // server has setup a fresh subscription for us that we must respect.
                                            //
                                            // Two subscriptions for the same query causes problems.
                                            withoutReuse: true,
                                        });

                                        this.store.loadTasksIntoQuery(extraQuery, {
                                            limit: extraQueryResult.limit,
                                            loadedState: extraQueryResult.loadedState,
                                            previouslyBackfilledTaskIds:
                                                extraQueryResult.previouslyBackfilledTaskIds,
                                        });

                                        // Make sure that we don't already have a query subscription for this
                                        // new query.
                                        assert(
                                            iterableEvery(
                                                subscribedQueries,
                                                subscribedQuery =>
                                                    subscribedQuery.query !== extraQuery,
                                            ),
                                        );

                                        subscribedQueries.add(
                                            createQuerySubscription({
                                                query: extraQuery,
                                                querySubscriptionIdPromise: Promise.resolve(
                                                    extraQueryResult.querySubscriptionId,
                                                ),
                                            }),
                                        );

                                        extraQueriesToRelease.push(extraQuery);
                                    }
                                }
                            }

                            for (let i = 0; i < output.taskSubscriptionResults.length; i++) {
                                const taskSubscription = newTaskSubscriptionsArray[i]!;
                                const result = output.taskSubscriptionResults[i]!;

                                if (!result.ok) {
                                    taskSubscription.setError(result.error);
                                } else {
                                    taskSubscription.clearError();
                                }
                            }

                            for (let i = 0; i < output.collectionSubscriptionResults.length; i++) {
                                const collectionSubscription = newCollectionSubscriptionsArray[i]!;
                                const result = output.collectionSubscriptionResults[i]!;

                                if (!result.ok) {
                                    collectionSubscription.setError(result.error);
                                } else {
                                    collectionSubscription.clearError();
                                }
                            }

                            // Apply our update event after updating query loaded states. Otherwise queries
                            // would ignore newly backfilled tasks as out of range.
                            if (output.updateEvent) {
                                this.store.applyUpdateEvent(output.updateEvent);
                            }
                        });

                        return output;
                    });

                for (let i = 0; i < newQueriesArray.length; i++) {
                    const query = newQueriesArray[i]!;

                    const querySubscriptionIdPromise = subscribePromise.then(output => {
                        const result = output.querySubscriptionResults[i]!;
                        if (!result.ok) throw result.error;
                        return result.querySubscriptionId;
                    });

                    // Suppress uncaught promise errors. Safe to ignore errors since they're set on
                    // subscription objects. Errors will be re-thrown and presented to the user if
                    // they matter.
                    querySubscriptionIdPromise.catch(() => {});

                    subscribedQueries.add(
                        createQuerySubscription({
                            query,
                            querySubscriptionIdPromise,
                        }),
                    );
                }

                for (let i = 0; i < newTaskSubscriptionsArray.length; i++) {
                    const newTaskSubscription = newTaskSubscriptionsArray[i]!;

                    const taskSubscriptionIdPromise = subscribePromise.then(output => {
                        const result = output.taskSubscriptionResults[i]!;
                        if (!result.ok) throw result.error;
                        return result.taskSubscriptionId;
                    });

                    // Suppress uncaught promise errors. Safe to ignore errors since they're set on
                    // subscription objects. Errors will be re-thrown and presented to the user if
                    // they matter.
                    taskSubscriptionIdPromise.catch(() => {});

                    subscribedTasks.add({
                        taskSubscription: newTaskSubscription,
                        taskSubscriptionIdPromise,
                    });
                }

                for (let i = 0; i < newCollectionSubscriptionsArray.length; i++) {
                    const newCollectionSubscription = newCollectionSubscriptionsArray[i]!;

                    const collectionSubscriptionIdPromise = subscribePromise.then(output => {
                        const result = output.collectionSubscriptionResults[i]!;
                        if (!result.ok) throw result.error;
                        return result.collectionSubscriptionId;
                    });

                    // Suppress uncaught promise errors. Safe to ignore errors since they're set on
                    // subscription objects. Errors will be re-thrown and presented to the user if
                    // they matter.
                    collectionSubscriptionIdPromise.catch(() => {});

                    subscribedCollections.add({
                        collectionSubscription: newCollectionSubscription,
                        collectionSubscriptionIdPromise,
                    });
                }

                subscribePromise.catch(error => {
                    // NOCOMMIT: How do we present errors??
                    console.error(error);
                });
            }

            // Unsubscribe from old queries, tasks, and collections:
            if (
                oldSubscribedQueries.size > 0 ||
                oldSubscribedTasks.size > 0 ||
                oldSubscribedCollections.size > 0
            ) {
                for (const subscribedQuery of oldSubscribedQueries) {
                    subscribedQuery.unsubscribeFromLoadMoreTaskCount();
                    subscribedQueries.delete(subscribedQuery);
                }

                for (const subscribedTask of oldSubscribedTasks) {
                    subscribedTasks.delete(subscribedTask);
                }

                for (const subscribedCollection of oldSubscribedCollections) {
                    subscribedCollections.delete(subscribedCollection);
                }

                const unsubscribeFromConnectionId = connectionId;

                runAllPromises([
                    Promise.allSettled(
                        Array.from(
                            oldSubscribedQueries,
                            subscribedQuery => subscribedQuery.querySubscriptionIdPromise,
                        ),
                    ),
                    Promise.allSettled(
                        Array.from(
                            oldSubscribedTasks,
                            subscribedTask => subscribedTask.taskSubscriptionIdPromise,
                        ),
                    ),
                    Promise.allSettled(
                        Array.from(
                            oldSubscribedCollections,
                            subscribedCollection =>
                                subscribedCollection.collectionSubscriptionIdPromise,
                        ),
                    ),
                ])
                    .then(
                        ([
                            querySubscriptionIdResults,
                            taskSubscriptionIdResults,
                            collectionSubscriptionIdResults,
                        ]) => {
                            // Ignore any errors when resolving `querySubscriptionIdPromise`s. Those
                            // errors should have been handled above. If a `querySubscriptionIdPromise`
                            // erred it is not subscribed on the server.
                            //
                            // Same for `taskSubscriptionIds` and `collectionSubscriptionIds` below.
                            const querySubscriptionIds = filterMapArray(
                                querySubscriptionIdResults,
                                querySubscriptionIdResult =>
                                    querySubscriptionIdResult.status === "fulfilled"
                                        ? querySubscriptionIdResult.value
                                        : null,
                            );

                            const taskSubscriptionIds = filterMapArray(
                                taskSubscriptionIdResults,
                                taskSubscriptionIdResult =>
                                    taskSubscriptionIdResult.status === "fulfilled"
                                        ? taskSubscriptionIdResult.value
                                        : null,
                            );

                            const collectionSubscriptionIds = filterMapArray(
                                collectionSubscriptionIdResults,
                                collectionSubscriptionIdResult =>
                                    collectionSubscriptionIdResult.status === "fulfilled"
                                        ? collectionSubscriptionIdResult.value
                                        : null,
                            );

                            if (
                                querySubscriptionIds.length === 0 &&
                                taskSubscriptionIds.length === 0 &&
                                collectionSubscriptionIds.length === 0
                            ) {
                                return;
                            }

                            // If our connection changed while waiting on `querySubscriptionId`s (maybe the
                            // connection closed unexpectedly) then these queries are automatically
                            // unsubscribed and we don't need to send a message.
                            if (unsubscribeFromConnectionId !== connectionId) return;

                            return this._client.procedures.unsubscribe({
                                querySubscriptionIds,
                                taskSubscriptionIds,
                                collectionSubscriptionIds,
                            });
                        },
                    )
                    // Once we've finished unsubscribing, we need to cleanup the subscriptions in
                    // our store. They'll still hang on to their data, for instance, until we've
                    // finished unsubscribing.
                    //
                    // If there was an error the server may not have actually unsubscribed us but we
                    // still cleanup our store in case the server partially succeeded.
                    .finally(() => {
                        for (const {query} of oldSubscribedQueries) {
                            this.store.onQueryUnsubscribed(query);
                        }

                        for (const {taskSubscription} of oldSubscribedTasks) {
                            this.store.onTaskSubscriptionUnsubscribed(taskSubscription);
                        }

                        for (const {collectionSubscription} of oldSubscribedCollections) {
                            this.store.onCollectionSubscriptionUnsubscribed(collectionSubscription);
                        }
                    })
                    .catch(error => {
                        // NOCOMMIT: How do we present errors??
                        console.error(error);
                    });
            }
        };

        const unsubscribeFromQueriesStore = subscriptionsStore.subscribe(updateSubscribedQueries);

        this._disconnect = () => {
            // Clear the `connectionId` since our state listener won't be called after
            // this. This will stop an `unsubscribeFromQueries()` call from being made
            // after disconnection.
            connectionId = null;

            unsubscribeFromState();
            unsubscribeFromEvents();
            unsubscribeFromQueriesStore();
            this._client.disconnect();
        };

        const createQuerySubscription = ({
            query,
            querySubscriptionIdPromise,
        }: {
            query: TaskClientQuery;
            querySubscriptionIdPromise: Promise<TaskRealtimeQuerySubscriptionId>;
        }): {
            query: TaskClientQuery;
            querySubscriptionIdPromise: Promise<TaskRealtimeQuerySubscriptionId>;
            unsubscribeFromLoadMoreTaskCount: () => void;
        } => {
            const loadMoreTasksMutex = new Mutex();

            const loadMoreTasks = () => {
                // Use a mutex to only let one `loadMoreQueryTasks` call run at a time. A
                // previous `loadMoreQueryTasks` call may fulfill the next one.
                const loadMoreTasksPromise = loadMoreTasksMutex.withLock(async () => {
                    // If a query was unsubscribed then don't load more tasks.
                    if (!subscriptionsStore.getSnapshot().queries.has(query)) return;

                    const querySubscriptionId = await querySubscriptionIdPromise;

                    const loadMoreTaskCount = query.loadMoreTaskCountStore.getSnapshot();

                    // Don't proceed if there are no more tasks to load. May happen if a previous
                    // `loadMoreTasks` call fully loaded our query.
                    if (loadMoreTaskCount === 0) return;

                    const {loadedState, previouslyBackfilledTaskIds, updateEvent} =
                        await this._client.procedures.loadMoreQueryTasks({
                            clientTime: this.store.clock.now(),
                            querySubscriptionId,
                            limit: loadMoreTaskCount,
                        });

                    batchStoreUpdates(() => {
                        this.store.loadTasksIntoQuery(query, {
                            limit: loadMoreTaskCount,
                            loadedState,
                            previouslyBackfilledTaskIds,
                        });

                        // Apply our update event after updating query loaded states. Otherwise queries
                        // would ignore newly backfilled tasks as out of range.
                        if (updateEvent) {
                            this.store.applyUpdateEvent(updateEvent);
                        }
                    });
                });

                loadMoreTasksPromise.catch(error => {
                    // If this promise fails after the query unsubscribes then that's expected! Not
                    // a glitch, don't present to the user. `unsubscribe` will cause any pending
                    // loads to fail with `CancelledError`. Still log the exception for tracking
                    // though. Maybe it was a system error?
                    if (!subscriptionsStore.getSnapshot().queries.has(query)) {
                        this._getContext()
                            .tracer.getRoot()
                            .logUncaughtException(
                                "Loading more tasks for query failed after query was unsubscribed",
                                error,
                            );
                        return;
                    }

                    this._onDisplayError({
                        title: "Couldn’t get more tasks",
                        error,
                    });
                });
            };

            // When the query's `loadMoreTask` property changes that triggers a data load
            // here in our realtime client to...load more tasks.
            const unsubscribeFromLoadMoreTaskCount =
                query.loadMoreTaskCountStore.subscribe(loadMoreTasks);

            return {
                query,
                querySubscriptionIdPromise,
                unsubscribeFromLoadMoreTaskCount,
            };
        };
    }

    public disconnect() {
        assert(this._disconnect !== null, "WebSocket is already disconnected");
        this._disconnect();
        this._disconnect = null;
    }

    /**
     * Should we load the initial `TaskGridViewExpansionState` for this query and
     * preload children queries along with it? If you call this BEFORE our realtime
     * client attempts to subscribe to the query (you'll need to use
     * `batchStoreUpdates()` to delay the subscription listener firing) then we'll
     * load the query's initial grid view expansion state.
     *
     * Grid view expansion state is best effort and is not kept up-to-date in
     * realtime. Because of grid view expansion state's limitations we have you
     * fetch/retrieve it through these janky methods on `TaskRealtimeClient`.
     */
    public setShouldLoadGridViewExpansionStateForQuery(query: TaskClientQuery) {
        this._shouldLoadGridViewExpansionStateForQuery.add(query);
    }

    /**
     * If you loaded the grid view expansion state for a query (with
     * `setShouldLoadGridViewExpansionStateForQuery()`) then you may retrieve it
     * with this function. You may only call this function once, subsequent calls
     * will return null.
     *
     * Grid view expansion state is best effort and is not kept up-to-date in
     * realtime. Because of grid view expansion state's limitations we have you
     * fetch/retrieve it through these janky methods on `TaskRealtimeClient`.
     */
    public takeInitialGridViewExpansionStateForQueryIfExists(query: TaskClientQuery) {
        const gridViewExpansionState = this._initialGridViewExpansionStateByQuery.get(query);
        if (gridViewExpansionState) this._initialGridViewExpansionStateByQuery.delete(query);
        return gridViewExpansionState;
    }
}
