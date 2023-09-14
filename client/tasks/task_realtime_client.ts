import {AppContext} from "~/client/context/app_context.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {WebSocketClient} from "~/client/web_socket/web_socket_client.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array.js";
import {Id, generateId} from "~/shared/id/id.js";
import {SpaceId, TaskRealtimeQuerySubscriptionId} from "~/shared/id/types/id_types.js";
import {TaskRealtimeProtocol} from "~/shared/tasks/task_realtime_protocol.js";

/**
 * Manages the client's realtime connection to `TaskRealtimeService` and owns
 * the `TaskClientDatabase` object. When we connect to the WebSocket we'll
 * subscribe to the queries in our store so we can keep them up-to-date in
 * realtime.
 */
export class TaskRealtimeClient {
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

        const queriesStore = this.store.getQueriesStore();
        const subscribedQueries = new Set<{
            query: TaskClientQuery;
            querySubscriptionId: Promise<TaskRealtimeQuerySubscriptionId>;
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
                subscribedQueries.clear();
                return;
            }

            const newQueries = new Set<TaskClientQuery>(queriesStore.getSnapshot());
            const oldSubscribedQueries = new Set<{
                query: TaskClientQuery;
                querySubscriptionId: Promise<TaskRealtimeQuerySubscriptionId>;
            }>();

            for (const subscribedQuery of subscribedQueries) {
                if (newQueries.delete(subscribedQuery.query)) continue;
                oldSubscribedQueries.add(subscribedQuery);
            }

            // Subscribe to new queries:
            if (newQueries.size > 0) {
                const newQueriesArray = Array.from(newQueries);

                // When either:
                //
                // 1. Our WebSocket transitions to a connected state; OR
                // 2. A query is added to the store while our WebSocket is connected
                //
                // We want to subscribe to the new queries in our WebSocket. Subscribing will
                // backfill any realtime changes we've missed while the WebSocket was not
                // connected.
                //
                // TODO(calebmer): Currently calling `subscribeToQueries` sends the entire
                // query response to the client a second time. It would be nice if we only sent
                // changes between the last time the client was up-to-date and now. But given
                // our CRDT everything-is-unordered backend design it's hard to know what
                // actions the client has missed. This doesn't really affect perceived
                // performance for the user so even though it's wasteful we let it happen
                // for now. Maybe there's cool research around CRDT state vectors we can use
                // for syncing? A dumb optimization like a `lastModified` timestamp that noops
                // if the query was not modified since then could also work.
                const subscribePromise = this._client.procedures.subscribeToQueries({
                    queries: newQueriesArray.map(query => ({
                        limit: query.getDesiredCountSnapshot(),
                        filters: query.filters,
                        sorts: query.sorts,
                    })),
                });

                for (let i = 0; i < newQueriesArray.length; i++) {
                    const query = newQueriesArray[i]!;

                    subscribedQueries.add({
                        query,
                        querySubscriptionId: subscribePromise.then(
                            output => output.queries[i]!.querySubscriptionId,
                        ),
                    });
                }

                subscribePromise.then(
                    output => {
                        batchStoreUpdates(() => {
                            for (let i = 0; i < output.queries.length; i++) {
                                const query = newQueriesArray[i]!;
                                const {loadedState, previouslyBackfilledTaskIds} =
                                    output.queries[i]!;

                                this.store.loadTasksIntoQuery(query, {
                                    loadedState,
                                    previouslyBackfilledTaskIds,
                                });
                            }
                        });
                    },
                    error => {
                        // NOCOMMIT: How do we present errors??
                        console.error(error);
                    },
                );
            }

            // Unsubscribe from old queries:
            if (oldSubscribedQueries.size > 0) {
                for (const subscribedQuery of oldSubscribedQueries) {
                    subscribedQueries.delete(subscribedQuery);
                }

                const unsubscribeFromConnectionId = connectionId;

                Promise.allSettled(
                    Array.from(
                        oldSubscribedQueries,
                        subscribedQuery => subscribedQuery.querySubscriptionId,
                    ),
                )
                    .then(querySubscriptionIdResults => {
                        // Ignore any errors when resolving `querySubscriptionId` promises. Those
                        // errors should have been handled above. If a `querySubscriptionId` erred it
                        // is not subscribed on the server.
                        const querySubscriptionIds = filterMapArray(
                            querySubscriptionIdResults,
                            querySubscriptionIdResult =>
                                querySubscriptionIdResult.status === "fulfilled"
                                    ? querySubscriptionIdResult.value
                                    : null,
                        );

                        if (querySubscriptionIds.length === 0) return;

                        // If our connection changed while waiting on `querySubscriptionId`s (maybe the
                        // connection closed unexpectedly) then these queries are automatically
                        // unsubscribed and we don't need to send a message.
                        if (unsubscribeFromConnectionId !== connectionId) return;

                        return this._client.procedures.unsubscribeFromQueries({
                            querySubscriptionIds,
                        });
                    })
                    .catch(error => {
                        // NOCOMMIT: How do we present errors??
                        console.error(error);
                    });
            }
        };

        const unsubscribeFromQueriesStore = queriesStore.subscribe(updateSubscribedQueries);

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
