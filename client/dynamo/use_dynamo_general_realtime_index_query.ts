import {Memo, useEffect, useRef, useState} from "react";
import {DynamoGeneralRealtimeIndexQuery} from "~/client/dynamo/dynamo_general_realtime_index_query.js";
import {
    DynamoGeneralRealtimeBackfillResult,
    DynamoGeneralRealtimeEvent,
    DynamoGeneralRealtimeIndexQueryResult,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Keep a query from our DynamoDB realtime framework up-to-date on the client.
 *
 * You must have initially loaded the query somewhere. Probably a server-side
 * render.
 *
 * You must connect to a WebSocket or other push-based realtime service outside
 * of this hook and then pass in relevant `isConnected` and `subscribeToEvents`
 * props to wire up this hook to a WebSocket.
 */
export function useDynamoGeneralRealtimeIndexQuery<Model>(
    initialQueryResult: DynamoGeneralRealtimeIndexQueryResult<Model>,
    options: {
        /**
         * Are we connected to a WebSocket or other push-based realtime service that
         * will send us events when our item updates? If true then
         * `subscribeToEvents()` should be how we access those realtime events.
         */
        isConnected: boolean;

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
                subscriber: (event: {
                    readTime: Date;
                    eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>;
                }) => void,
            ) => () => void
        >;

        /**
         * We need to backfill changes to the query whenever we connect to our realtime
         * service. That's because when connected to our realtime service, we're
         * guaranteed to receive all events for the query that start AFTER we
         * successfully connect. But what if updates happened BEFORE we connect but
         * after we load the initial item that's passed in as a prop? The backfill
         * function catches these updates.
         *
         * The backfill function also runs if the user temporarily disconnects from
         * internet then reconnects (e.g. they went through a tunnel) to make sure the
         * user doesn't miss any realtime updates.
         */
        backfillQuery: Memo<
            (options: {readTime: Date}) => Promise<DynamoGeneralRealtimeBackfillResult<Model>>
        >;

        /**
         * If `backfillQuery()` returns an `Unavailable` result then we'll call this
         * function to completely reload the query. Our internal query state will be
         * completely reset and the user scrolled to the top.
         */
        reloadQuery: Memo<() => Promise<DynamoGeneralRealtimeIndexQueryResult<Model>>>;
    },
): {
    query: DynamoGeneralRealtimeIndexQuery<Model>;
} {
    const [query, setQuery] = useState(() =>
        DynamoGeneralRealtimeIndexQuery.new(initialQueryResult),
    );

    useDynamoGeneralRealtimeIndexQueryBase({query, onUpdateQuery: setQuery}, options);

    return {query};
}

/**
 * The same as `useDynamoGeneralRealtimeIndexQuery()` but you can bring your
 * own state.
 */
export function useDynamoGeneralRealtimeIndexQueryBase<Model, Extra>(
    {
        query,
        onUpdateQuery,
    }: {
        query: DynamoGeneralRealtimeIndexQuery<Model, Extra>;
        onUpdateQuery: Memo<
            (
                update: (
                    query: DynamoGeneralRealtimeIndexQuery<Model, Extra>,
                ) => DynamoGeneralRealtimeIndexQuery<Model, Extra>,
            ) => void
        >;
    },
    {
        isConnected,
        subscribeToEvents,
        backfillQuery,
        reloadQuery,
    }: {
        /**
         * Are we connected to a WebSocket or other push-based realtime service that
         * will send us events when our item updates? If true then
         * `subscribeToEvents()` should be how we access those realtime events.
         */
        isConnected: boolean;

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
                subscriber: (event: {
                    readTime: Date;
                    eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>;
                }) => void,
            ) => () => void
        >;

        /**
         * We need to backfill changes to the query whenever we connect to our realtime
         * service. That's because when connected to our realtime service, we're
         * guaranteed to receive all events for the query that start AFTER we
         * successfully connect. But what if updates happened BEFORE we connect but
         * after we load the initial item that's passed in as a prop? The backfill
         * function catches these updates.
         *
         * The backfill function also runs if the user temporarily disconnects from
         * internet then reconnects (e.g. they went through a tunnel) to make sure the
         * user doesn't miss any realtime updates.
         */
        backfillQuery: Memo<
            (options: {readTime: Date}) => Promise<DynamoGeneralRealtimeBackfillResult<Model>>
        >;

        /**
         * If `backfillQuery()` returns an `Unavailable` result then we'll call this
         * function to completely reload the query. Our internal query state will be
         * completely reset and the user scrolled to the top.
         */
        reloadQuery: Memo<() => Promise<DynamoGeneralRealtimeIndexQueryResult<Model>>>;
    },
) {
    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    if (errorState.hasError) throw errorState.error;

    // Subscribe to realtime events that may change what's in the channel.
    useEffect(() => {
        return subscribeToEvents(event => {
            onUpdateQuery(query =>
                query.handleEventTransaction(event.readTime, event.eventTransaction),
            );
        });
    }, [onUpdateQuery, subscribeToEvents]);

    // Whenever we connect, we need to backfill changes from when we initially read
    // inbox entries until now. That way if any realtime events happened during
    // that time we can incorporate them into our state instead of completely
    // missing them.
    const wasConnectedRef = useRef(false);
    useEffect(() => {
        if (!isConnected) {
            wasConnectedRef.current = false;
            return;
        }

        if (wasConnectedRef.current) return;
        wasConnectedRef.current = true;

        backfillQuery({
            readTime: query.getReadTime(),
        }).then(
            backfillResult => {
                switch (backfillResult.type) {
                    case "Available": {
                        onUpdateQuery(query =>
                            query.handleEventTransaction(
                                backfillResult.readTime,
                                backfillResult.eventTransaction,
                            ),
                        );
                        break;
                    }
                    case "Unavailable": {
                        // If a backfill is unavailable then fully reload our query to catch us
                        // up to the latest data.
                        reloadQuery().then(
                            result => {
                                // Bit of a hack. Set this to false so that when the effect re-runs because we
                                // got a new query we send a new backfill request with the `readTime` of our
                                // reset query.
                                //
                                // By resetting the query we lose realtime event history. So it's kinda like we
                                // were disconnected from realtime up until this point.
                                wasConnectedRef.current = false;

                                onUpdateQuery(() => DynamoGeneralRealtimeIndexQuery.new(result));
                            },
                            error => setErrorState({hasError: true, error}),
                        );
                        break;
                    }
                    default:
                        throw exhaustive(backfillResult);
                }
            },
            error => setErrorState({hasError: true, error}),
        );
    }, [backfillQuery, isConnected, onUpdateQuery, query, reloadQuery]);
}
