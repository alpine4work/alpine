import {AppContext} from "~/client/context/app_context.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/task_client_collection_subscription.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/tasks/task_client_task_subscription.js";
import {WebSocketClient} from "~/client/web_socket/web_socket_client.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array.js";
import {Id, generateId} from "~/shared/id/id.js";
import {
    SpaceId,
    TaskRealtimeCollectionSubscriptionId,
    TaskRealtimeQuerySubscriptionId,
    TaskRealtimeTaskSubscriptionId,
} from "~/shared/id/types/id_types.js";
import {TaskRealtimeProtocol} from "~/shared/tasks/task_realtime_protocol.js";

/**
 * Manages the client's realtime connection to `TaskRealtimeService` and owns
 * the `TaskClientDatabase` object. When we connect to the WebSocket we'll
 * subscribe to the queries in our store so we can keep them up-to-date in
 * realtime.
 */
export class TaskRealtimeClient {
    private readonly _getContext: () => AppContext;
    public readonly spaceId: SpaceId;
    private readonly _client: WebSocketClient<typeof TaskRealtimeProtocol>;
    private _disconnect: (() => void) | null = null;

    public readonly store: TaskClientStore;

    constructor(
        getContext: () => AppContext,
        {
            spaceId,
            onDisplayError,
        }: {
            spaceId: SpaceId;
            onDisplayError: (options: {title: string; error: unknown}) => void;
        },
    ) {
        this._getContext = getContext;
        this.spaceId = spaceId;

        this._client = new WebSocketClient(
            getContext,
            TaskRealtimeProtocol,
            `/api/task-realtime/${this.spaceId}`,
        );

        this.store = new TaskClientStore({spaceId, onDisplayError});
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
                return;
            }

            const subscriptions = subscriptionsStore.getSnapshot();

            const newQueries = new Set(subscriptions.queries);
            const newTaskSubscriptions = new Set(subscriptions.taskSubscriptions);
            const newCollectionSubscriptions = new Set(subscriptions.collectionSubscriptions);

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

                const newQueryLimits = newQueriesArray.map(query =>
                    // When subscribing to a query, load at least the grid view limit.
                    //
                    // If we're re-subscribing to a query that had many tasks then we want to load
                    // all those tasks back. If the query requested to load more tasks then add
                    // those on as well.
                    Math.max(
                        query.taskOrderStore.getSnapshot().length +
                            query.loadMoreTaskCountStore.getSnapshot(),
                        getTaskGridViewLoadQueryLimit(getClientInfoWithoutListening()),
                    ),
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
                        queries: newQueriesArray.map((query, i) => ({
                            limit: newQueryLimits[i]!,
                            filters: query.filters,
                            sorts: query.sorts,
                        })),
                        taskIds: Array.from(
                            newTaskSubscriptions,
                            taskSubscription => taskSubscription.taskId,
                        ),
                        collectionIds: Array.from(
                            newCollectionSubscriptions,
                            collectionSubscription => collectionSubscription.collectionId,
                        ),
                    })
                    .then(output => {
                        batchStoreUpdates(() => {
                            for (let i = 0; i < output.queries.length; i++) {
                                const query = newQueriesArray[i]!;
                                const {loadedState, previouslyBackfilledTaskIds} =
                                    output.queries[i]!;

                                this.store.loadTasksIntoQuery(query, {
                                    limit: newQueryLimits[i]!,
                                    loadedState,
                                    previouslyBackfilledTaskIds,
                                });
                            }
                        });

                        return output;
                    });

                for (let i = 0; i < newQueriesArray.length; i++) {
                    const query = newQueriesArray[i]!;

                    const querySubscriptionIdPromise = subscribePromise.then(
                        output => output.queries[i]!.querySubscriptionId,
                    );

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

                            const {loadedState, previouslyBackfilledTaskIds} =
                                await this._client.procedures.loadMoreQueryTasks({
                                    querySubscriptionId,
                                    limit: loadMoreTaskCount,
                                });

                            this.store.loadTasksIntoQuery(query, {
                                limit: loadMoreTaskCount,
                                loadedState,
                                previouslyBackfilledTaskIds,
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

                            // NOCOMMIT: How do we present errors to the user??
                            console.error(error);
                        });
                    };

                    // When the query's `loadMoreTask` property changes that triggers a data load
                    // here in our realtime client to...load more tasks.
                    const unsubscribeFromLoadMoreTaskCount =
                        query.loadMoreTaskCountStore.subscribe(loadMoreTasks);

                    subscribedQueries.add({
                        query,
                        querySubscriptionIdPromise,
                        unsubscribeFromLoadMoreTaskCount,
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
    }

    public disconnect() {
        assert(this._disconnect !== null, "WebSocket is already disconnected");
        this._disconnect();
        this._disconnect = null;
    }
}
