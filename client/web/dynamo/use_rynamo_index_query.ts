import {Memo, useCallback, useEffect, useRef, useState} from "react";
import {RynamoIndexQuery} from "~/client/web/dynamo/rynamo_index_query.js";
import {useErrorState} from "~/client/web/helpers/use_error_state.js";
import {
    RynamoBackfillResult,
    RynamoEvent,
    RynamoIndexQueryResult,
} from "~/shared/dynamo/rynamo_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

/**
 * Keep a query from our DynamoDB realtime framework up-to-date on the client.
 *
 * You must have initially loaded the query somewhere. Probably a server-side
 * render.
 *
 * You must connect to a WebSocket or other push-based realtime service outside of
 * this hook and then pass in relevant `isConnected` and `subscribeToEvents` props
 * to wire up this hook to a WebSocket.
 */
export function useRynamoIndexQuery<Model>(
    initialQueryResult: RynamoIndexQueryResult<Model>,
    options: {
        /**
         * Are we connected to a WebSocket or other push-based realtime service that will
         * send us events when our item updates? If true then `subscribeToEvents()` should
         * be how we access those realtime events.
         */
        isConnected: boolean;

        /**
         * Subscribe to pong messages from our WebSocket. As long as we're receiving pong
         * events (which include `ServerSynchronizationCheckpoint`s) the client can be
         * certain its content is up-to-date.
         */
        subscribeToPongs: Memo<(subscriber: (message: WebSocketPongMessage) => void) => () => void>;

        /**
         * Subscribe to realtime events that may affect this item. The event source may
         * also be sending events unrelated to our item, this hook will filter out
         * unrelated updates.
         *
         * This hook also correctly handles out-of-order updates. If a past update is
         * delivered late (after a newer update) we will drop it.
         */
        subscribeToEvents: Memo<
            (
                subscriber: (eventTransaction: ReadonlyArray<RynamoEvent<unknown>>) => void,
            ) => () => void
        >;

        /**
         * We need to backfill changes to the query whenever we connect to our realtime
         * service. That's because when connected to our realtime service, we're guaranteed
         * to receive all events for the query that start AFTER we successfully connect.
         * But what if updates happened BEFORE we connect but after we load the initial
         * item that's passed in as a prop? The backfill function catches these updates.
         *
         * The backfill function also runs if the user temporarily disconnects from
         * internet then reconnects (e.g. they went through a tunnel) to make sure the user
         * doesn't miss any realtime updates.
         */
        backfillQuery: Memo<
            (checkpoint: ServerSynchronizationCheckpoint) => Promise<RynamoBackfillResult<Model>>
        >;

        /**
         * If `backfillQuery()` returns an `Unavailable` result then we'll call this
         * function to completely reload the query. Our internal query state will be
         * completely reset and the user scrolled to the top.
         */
        reloadQuery: Memo<() => Promise<RynamoIndexQueryResult<Model>>>;
    },
): {
    query: RynamoIndexQuery<Model>;
    handleEvent: Memo<(eventTransaction: ReadonlyArray<RynamoEvent<unknown>>) => void>;
} {
    const [query, setQuery] = useState(() => RynamoIndexQuery.new(initialQueryResult));

    return useRynamoIndexQueryBase({query, onUpdateQuery: setQuery}, options);
}

/**
 * The same as `useRynamoIndexQuery()` but you can bring your own state.
 */
export function useRynamoIndexQueryBase<Model, Extra>(
    {
        query,
        onUpdateQuery,
    }: {
        query: RynamoIndexQuery<Model, Extra>;
        onUpdateQuery: Memo<
            (
                update: (query: RynamoIndexQuery<Model, Extra>) => RynamoIndexQuery<Model, Extra>,
            ) => void
        >;
    },
    {
        isConnected,
        subscribeToPongs,
        subscribeToEvents,
        backfillQuery,
        reloadQuery,
    }: {
        /**
         * Are we connected to a WebSocket or other push-based realtime service that will
         * send us events when our item updates? If true then `subscribeToEvents()` should
         * be how we access those realtime events.
         */
        isConnected: boolean;

        /**
         * Subscribe to pong messages from our WebSocket. As long as we're receiving pong
         * events (which include `ServerSynchronizationCheckpoint`s) the client can be
         * certain its content is up-to-date.
         */
        subscribeToPongs: Memo<(subscriber: (message: WebSocketPongMessage) => void) => () => void>;

        /**
         * Subscribe to realtime events that may affect this item. The event source may
         * also be sending events unrelated to our item, this hook will filter out
         * unrelated updates.
         *
         * This hook also correctly handles out-of-order updates. If a past update is
         * delivered late (after a newer update) we will drop it.
         */
        subscribeToEvents: Memo<
            (
                subscriber: (eventTransaction: ReadonlyArray<RynamoEvent<unknown>>) => void,
            ) => () => void
        >;

        /**
         * We need to backfill changes to the query whenever we connect to our realtime
         * service. That's because when connected to our realtime service, we're guaranteed
         * to receive all events for the query that start AFTER we successfully connect.
         * But what if updates happened BEFORE we connect but after we load the initial
         * item that's passed in as a prop? The backfill function catches these updates.
         *
         * The backfill function also runs if the user temporarily disconnects from
         * internet then reconnects (e.g. they went through a tunnel) to make sure the user
         * doesn't miss any realtime updates.
         */
        backfillQuery: Memo<
            (checkpoint: ServerSynchronizationCheckpoint) => Promise<RynamoBackfillResult<Model>>
        >;

        /**
         * If `backfillQuery()` returns an `Unavailable` result then we'll call this
         * function to completely reload the query. Our internal query state will be
         * completely reset and the user scrolled to the top.
         */
        reloadQuery: Memo<() => Promise<RynamoIndexQueryResult<Model>>>;
    },
): {
    query: RynamoIndexQuery<Model, Extra>;
    handleEvent: Memo<(eventTransaction: ReadonlyArray<RynamoEvent<unknown>>) => void>;
} {
    const setErrorState = useErrorState();

    const handleEvent = useCallback(
        (eventTransaction: ReadonlyArray<RynamoEvent<unknown>>) => {
            onUpdateQuery(query => query.handleEventTransaction(eventTransaction));
        },
        [onUpdateQuery],
    );

    // Subscribe to realtime events that may change what's in the channel.
    useEffect(() => {
        return subscribeToEvents(handleEvent);
    }, [handleEvent, subscribeToEvents]);

    // Whenever we get a pong from the WebSocket, update our checkpoint so we know data
    // is up-to-date as of this new time.
    useEffect(() => {
        return subscribeToPongs(({checkpoint}) => query.setMutableCheckpoint(checkpoint));
    }, [query, subscribeToPongs]);

    // Whenever we connect, we need to backfill changes from when we initially read
    // inbox entries until now. That way if any realtime events happened during that
    // time we can incorporate them into our state instead of completely missing them.
    const wasConnectedRef = useRef(false);
    useEffect(() => {
        if (!isConnected) {
            wasConnectedRef.current = false;
            return;
        }

        if (wasConnectedRef.current) return;
        wasConnectedRef.current = true;

        backfillQuery(query.getMutableCheckpoint()).then(
            backfillResult => {
                switch (backfillResult.type) {
                    case "Available": {
                        onUpdateQuery(query => {
                            const newQuery = query.handleEventTransaction(
                                backfillResult.eventTransaction,
                            );
                            newQuery.setMutableCheckpoint(backfillResult.checkpoint);
                            return newQuery;
                        });
                        break;
                    }
                    case "Unavailable": {
                        // If a backfill is unavailable then fully reload our query to catch us up to the
                        // latest data.
                        reloadQuery().then(
                            result => {
                                // Bit of a hack. Set this to false so that when the effect re-runs because we got
                                // a new query we send a new backfill request with the checkpoint of our reset
                                // query.
                                //
                                // By resetting the query we abandon any realtime events we've seen. So it's kinda
                                // like we were disconnected from realtime up until this point.
                                wasConnectedRef.current = false;

                                onUpdateQuery(() => RynamoIndexQuery.new(result));
                            },
                            error => setErrorState(error),
                        );
                        break;
                    }
                    default:
                        throw exhaustive(backfillResult);
                }
            },
            error => setErrorState(error),
        );
    }, [backfillQuery, isConnected, onUpdateQuery, query, reloadQuery, setErrorState]);

    return {
        query,
        handleEvent,
    };
}
