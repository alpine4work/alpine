import {useEffect, useReducer, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {DynamoGeneralRealtimeIndexQuery} from "~/client/dynamo/dynamo_general_realtime_index_query";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {inboxEntryViewMinHeight} from "~/client/inbox/inbox_entry_view";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context";
import {useMyAccountWebSocket, useSpaceContext} from "~/client/spaces/space_context";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/virtualized_scroll_view";
import {convertRemLengthToPx} from "~/shared/design/spacing";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {InboxEntryModel} from "~/shared/models/inbox_model";
import {backfillInboxEntries, getInboxEntries} from "~/shared/rpc/notifications_rpc_definitions";

type InboxState = {
    readonly query: DynamoGeneralRealtimeIndexQuery<InboxEntryModel>;
    readonly itemsDeletedByLastChange: ReadonlyArray<{
        readonly cursor: DynamoIndexCursor;
        readonly item: DynamoGeneralRealtimeItem<InboxEntryModel>;
    }>;
};

function getInitialInboxState(
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>,
): InboxState {
    return {
        query: DynamoGeneralRealtimeIndexQuery.new(initialEntriesResult),
        itemsDeletedByLastChange: [],
    };
}

function reduceInboxState(
    oldState: InboxState,
    getNewQuery:
        | DynamoGeneralRealtimeIndexQuery<InboxEntryModel>
        | ((
              oldQuery: DynamoGeneralRealtimeIndexQuery<InboxEntryModel>,
          ) => DynamoGeneralRealtimeIndexQuery<InboxEntryModel>),
): InboxState {
    const newQuery = typeof getNewQuery === "function" ? getNewQuery(oldState.query) : getNewQuery;
    const deletedItems = newQuery.getDeletedItems(oldState.query);

    return {
        query: newQuery,
        itemsDeletedByLastChange: Array.from(deletedItems),
    };
}

/**
 * Manages the inbox's realtime state.
 *
 * - Subscribes to realtime changes to the inbox
 * - Backfills realtime changes when we connect to realtime
 * - Provides a function to load more data based on what's rendered
 */
export function useInboxState({
    initialEntriesResult,
}: {
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>;
}) {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const {isConnected, subscribeToEvents} = useMyAccountWebSocket();

    const [{query, itemsDeletedByLastChange}, dispatch] = useReducer(
        reduceInboxState,
        initialEntriesResult,
        getInitialInboxState,
    );

    // Subscribe to realtime events that may change what's in the inbox.
    useEffect(() => {
        return subscribeToEvents(event =>
            dispatch(query => query.handleEventTransaction(event.readTime, event.eventTransaction)),
        );
    }, [subscribeToEvents]);

    // Whenever we connect, we need to backfill changes from when we initially read
    // inbox entries until now. That way if any realtime events happened during
    // that time we can incorporate them into our state instead of completely
    // missing them.
    //
    // NOCOMMIT: Testing that disconnecting and reconnecting will get any events
    // missed while disconnected
    const wasConnectedRef = useRef(false);
    useEffect(() => {
        if (!isConnected) {
            wasConnectedRef.current = false;
            return;
        }

        if (wasConnectedRef.current) return;
        wasConnectedRef.current = true;

        backfillInboxEntries(context, {
            spaceId: space.id,
            readTime: query.getReadTime(),
        }).then(
            ({backfillEntriesResult}) => {
                switch (backfillEntriesResult.type) {
                    case "Available": {
                        dispatch(query =>
                            query.handleEventTransaction(
                                backfillEntriesResult.readTime,
                                backfillEntriesResult.eventTransaction,
                            ),
                        );
                        break;
                    }
                    case "Unavailable": {
                        // If a backfill is unavailable then fully reload our inbox entries to catch us
                        // up to the latest data.
                        getInboxEntries(context, {
                            spaceId: space.id,
                            limit: getInitialVirtualizedScrollViewRenderedItemCount(
                                getClientInfoWithoutListening(),
                                inboxEntryViewMinHeight,
                            ),
                            afterCursor: null,
                        }).then(
                            ({entriesResult}) => {
                                // Bit of a hack. Set this to false so that when the effect re-runs because we
                                // got a new query we send a new backfill request with the `readTime` of our
                                // reset query.
                                //
                                // By resetting the query we lose realtime event history. So it's kinda like we
                                // were disconnected from realtime up until this point.
                                wasConnectedRef.current = false;

                                dispatch(DynamoGeneralRealtimeIndexQuery.new(entriesResult));
                            },
                            error => setErrorState({hasError: true, error}),
                        );
                        break;
                    }
                    default:
                        throw exhaustive(backfillEntriesResult);
                }
            },
            error => setErrorState({hasError: true, error}),
        );
    }, [context, isConnected, query, space.id]);

    const isLoadingRef = useRef(false);
    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    if (errorState.hasError) throw errorState.error;

    const tryLoadingMore = useEvent(
        (
            viewHeight: number,
            renderedRange: {startIndex: number; endIndex: number} | null,
        ): {isLoading: false} | {isLoading: true; promise: Promise<void>} => {
            // If we're already loading, don't try to load more comments.
            if (isLoadingRef.current) return {isLoading: false};

            const result = actuallyTryLoadingMoreData(renderedRange);
            if (!result.isLoading) return result;

            isLoadingRef.current = true;
            result.promise.then(
                () => {
                    isLoadingRef.current = false;
                },
                error => {
                    isLoadingRef.current = false;
                    setErrorState({hasError: true, error});
                },
            );
            return result;

            // Try to load more data without worrying about managing coordination with
            // `isLoadingRef` or error handling.
            function actuallyTryLoadingMoreData(
                renderedRange: {startIndex: number; endIndex: number} | null,
            ): {isLoading: false} | {isLoading: true; promise: Promise<void>} {
                if (!renderedRange) return {isLoading: false};
                if (!query.isLoadingIndicatorVisible(renderedRange)) return {isLoading: false};

                const afterCursor = query.getNextPageCursorIfExists();
                if (!afterCursor) return {isLoading: false};

                const promise = (async () => {
                    // The limit of items we will load is one view worth of entries. This gives
                    // the user some space to scroll and read before we need to load more entries.
                    const limit = Math.max(
                        20,
                        Math.ceil(
                            viewHeight /
                                convertRemLengthToPx(
                                    inboxEntryViewMinHeight,
                                    getRemPxWithoutListening(),
                                ),
                        ),
                    );

                    const {entriesResult} = await getInboxEntries(context, {
                        spaceId: space.id,
                        limit,
                        afterCursor,
                    });

                    dispatch(query => query.loadMore(entriesResult));
                })();

                return {isLoading: true, promise};
            }
        },
    );

    return {
        query,
        itemsDeletedByLastChange,
        tryLoadingMore,
    };
}
