import {AppContext} from "~/client/context/app_context.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {WebSocketClient} from "~/client/web_socket/web_socket_client.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
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

    constructor(getContext: () => AppContext, spaceId: SpaceId) {
        this._client = new WebSocketClient(
            getContext,
            TaskRealtimeProtocol,
            `/api/task-realtime/${spaceId}`,
        );

        this.spaceId = spaceId;
        this.store = new TaskClientStore({spaceId});
    }

    public connect() {
        assert(this._disconnect === null, "WebSocket is already connected");

        let isConnected = false;

        this._client.connect();

        const unsubscribeFromClientState = this._client.state.subscribe(() => {
            const clientState = this._client.state.getSnapshot();

            if (isConnected !== clientState.isConnected) {
                isConnected = clientState.isConnected;

                // When we connect to the WebSocket we need to subscribe to queries in our
                // store. This applies when we initially load the page and if the WebSocket
                // temporarily disconnects.
                //
                // Subscribing will backfill any realtime changes we've missed while the
                // WebSocket was not connected.
                //
                // TODO(calebmer): Currently calling `subscribeToQuery` sends the entire query
                // response to the client a second time. It would be nice if we only sent
                // changes between the last time the client was up-to-date and now. But given
                // our CRDT everything-is-unordered backend design it's hard to know what
                // actions the client has missed. This doesn't really affect perceived
                // performance for the user so even though it's wasteful we let it happen
                // for now.
                if (isConnected) {
                    // NOCOMMIT:
                    // for (const [queryId, query] of this._databaseStore
                    //     .getSnapshot()
                    //     .iterateQueries()) {
                    //     this._client.procedures
                    //         .subscribeToQuery({
                    //             limit: query.getCount(),
                    //             filters: query.filters,
                    //             sorts: query.sorts,
                    //         })
                    //         .then(
                    //             ({loadedState, previouslyBackfilledTaskIds}) => {
                    //                 this._databaseStore.set(store =>
                    //                     // NOCOMMIT: What if `loadedState` shrinks? The extend loaded state bit
                    //                     // won't work.
                    //                     store.loadTasksIntoQuery(queryId, {
                    //                         loadedState,
                    //                         previouslyBackfilledTaskIds,
                    //                     }),
                    //                 );
                    //             },
                    //             error => {
                    //                 // NOCOMMIT
                    //                 console.error(error);
                    //             },
                    //         );
                    // }
                }
            }
        });

        this._disconnect = () => {
            unsubscribeFromClientState();
            this._client.disconnect();
        };
    }

    public disconnect() {
        assert(this._disconnect !== null, "WebSocket is already disconnected");
        this._disconnect();
        this._disconnect = null;
    }
}
