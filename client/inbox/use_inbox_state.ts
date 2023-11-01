import {useCallback, useEffect, useReducer, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {DynamoGeneralRealtimeIndexQuery} from "~/client/dynamo/dynamo_general_realtime_index_query.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {inboxEntryViewMinHeight} from "~/client/inbox/inbox_entry_view.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {useMyAccountWebSocket, useSpaceContext} from "~/client/spaces/space_context.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/virtualized_scroll_view.js";
import {convertRemLengthToPx} from "~/shared/design/spacing.js";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {
    backfillInboxEntries,
    getInboxEntries,
    observeInbox,
} from "~/shared/rpc/notifications_rpc_definitions.js";

type InboxState = {
    readonly queryWithoutOptimisticUpdates: DynamoGeneralRealtimeIndexQuery<InboxEntryModel>;
    readonly query: DynamoGeneralRealtimeIndexQuery<InboxEntryModel>;
    readonly optimisticUpdates: ReadonlyArray<{
        readonly promise: Promise<unknown>;
        readonly update: (
            query: DynamoGeneralRealtimeIndexQuery<InboxEntryModel>,
        ) => DynamoGeneralRealtimeIndexQuery<InboxEntryModel>;
    }>;
    readonly itemsDeletedByLastChangeForAnimation: ReadonlyArray<{
        readonly index: number;
        readonly cursor: DynamoIndexCursor;
        readonly item: DynamoGeneralRealtimeItem<InboxEntryModel>;
    }>;
};

type InboxStateAction =
    | {
          readonly type: "Update";
          readonly update: (
              query: DynamoGeneralRealtimeIndexQuery<InboxEntryModel>,
          ) => DynamoGeneralRealtimeIndexQuery<InboxEntryModel>;
      }
    | {
          readonly type: "OptimisticUpdate";
          readonly promise: Promise<unknown>;
          readonly update: (
              query: DynamoGeneralRealtimeIndexQuery<InboxEntryModel>,
          ) => DynamoGeneralRealtimeIndexQuery<InboxEntryModel>;
          readonly withAnimation: boolean;
      }
    | {
          readonly type: "ResolveOptimisticUpdate";
          readonly promise: Promise<unknown>;
      }
    | {
          readonly type: "RejectOptimisticUpdate";
          readonly promise: Promise<unknown>;
      };

function getInitialInboxState(
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>,
): InboxState {
    const query = DynamoGeneralRealtimeIndexQuery.new(initialEntriesResult);

    return {
        queryWithoutOptimisticUpdates: query,
        query,
        optimisticUpdates: [],
        itemsDeletedByLastChangeForAnimation: [],
    };
}

function reduceInboxState(oldState: InboxState, action: InboxStateAction): InboxState {
    switch (action.type) {
        case "Update": {
            const newQueryWithoutOptimisticUpdates = action.update(
                oldState.queryWithoutOptimisticUpdates,
            );

            const newQuery = oldState.optimisticUpdates.reduce(
                (query, {update}) => update(query),
                newQueryWithoutOptimisticUpdates,
            );

            return {
                queryWithoutOptimisticUpdates: newQueryWithoutOptimisticUpdates,
                query: newQuery,
                optimisticUpdates: oldState.optimisticUpdates,
                itemsDeletedByLastChangeForAnimation: Array.from(
                    newQuery.getDeletedItems(oldState.query),
                ),
            };
        }
        case "OptimisticUpdate": {
            const newOptimisticUpdates = [
                ...oldState.optimisticUpdates,
                {
                    promise: action.promise,
                    update: action.update,
                },
            ];

            const newQuery = newOptimisticUpdates.reduce(
                (query, {update}) => update(query),
                oldState.queryWithoutOptimisticUpdates,
            );

            return {
                queryWithoutOptimisticUpdates: oldState.queryWithoutOptimisticUpdates,
                query: newQuery,
                optimisticUpdates: newOptimisticUpdates,
                itemsDeletedByLastChangeForAnimation: action.withAnimation
                    ? Array.from(newQuery.getDeletedItems(oldState.query))
                    : [],
            };
        }
        case "ResolveOptimisticUpdate": {
            const resolvedOptimisticUpdates = [];
            const pendingOptimisticUpdates = [];

            for (const optimisticUpdate of oldState.optimisticUpdates) {
                if (optimisticUpdate.promise !== action.promise) {
                    pendingOptimisticUpdates.push(optimisticUpdate);
                } else {
                    resolvedOptimisticUpdates.push(optimisticUpdate);
                }
            }

            // Optimization: If no promises resolved, don't change state.
            if (pendingOptimisticUpdates.length === oldState.optimisticUpdates.length)
                return oldState;

            // Permanently apply optimistic update...
            const newQueryWithoutOptimisticUpdates = resolvedOptimisticUpdates.reduce(
                (query, {update}) => update(query),
                oldState.queryWithoutOptimisticUpdates,
            );

            const newQuery = pendingOptimisticUpdates.reduce(
                (query, {update}) => update(query),
                newQueryWithoutOptimisticUpdates,
            );

            return {
                queryWithoutOptimisticUpdates: newQueryWithoutOptimisticUpdates,
                query: newQuery,
                optimisticUpdates: pendingOptimisticUpdates,
                itemsDeletedByLastChangeForAnimation: Array.from(
                    newQuery.getDeletedItems(oldState.query),
                ),
            };
        }
        case "RejectOptimisticUpdate": {
            const pendingOptimisticUpdates = [];

            for (const optimisticUpdate of oldState.optimisticUpdates) {
                if (optimisticUpdate.promise !== action.promise) {
                    pendingOptimisticUpdates.push(optimisticUpdate);
                }
            }

            // Optimization: If no promises rejected, don't change state.
            if (pendingOptimisticUpdates.length === oldState.optimisticUpdates.length)
                return oldState;

            const newQuery = pendingOptimisticUpdates.reduce(
                (query, {update}) => update(query),
                oldState.queryWithoutOptimisticUpdates,
            );

            return {
                queryWithoutOptimisticUpdates: oldState.queryWithoutOptimisticUpdates,
                query: newQuery,
                optimisticUpdates: pendingOptimisticUpdates,
                itemsDeletedByLastChangeForAnimation: Array.from(
                    newQuery.getDeletedItems(oldState.query),
                ),
            };
        }
        default:
            throw exhaustive(action);
    }
}

/**
 * Manages the inbox's realtime state.
 *
 * - Subscribes to realtime changes to the inbox
 * - Backfills realtime changes when we connect to realtime
 * - Provides a function to load more data based on what's rendered
 */
export function useInboxState({
    filter,
    initialEntriesResult,
}: {
    filter: "New" | "Archive";
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>;
}) {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const {isConnected, subscribeToEvents} = useMyAccountWebSocket();

    const [{query, optimisticUpdates, itemsDeletedByLastChangeForAnimation}, dispatch] = useReducer(
        reduceInboxState,
        initialEntriesResult,
        getInitialInboxState,
    );

    const updateQueryOptimistically = useCallback(
        ({
            promise,
            update,
            withAnimation,
        }: {
            promise: Promise<unknown>;
            withAnimation: boolean;
            update: (
                query: DynamoGeneralRealtimeIndexQuery<InboxEntryModel>,
            ) => DynamoGeneralRealtimeIndexQuery<InboxEntryModel>;
        }) => {
            dispatch({
                type: "OptimisticUpdate",
                promise,
                update,
                withAnimation,
            });
        },
        [],
    );

    useEffect(() => {
        let isCancelled = false;

        for (const {promise} of optimisticUpdates) {
            promise.then(
                () => {
                    if (isCancelled) return;

                    dispatch({
                        type: "ResolveOptimisticUpdate",
                        promise,
                    });
                },
                () => {
                    if (isCancelled) return;

                    dispatch({
                        type: "RejectOptimisticUpdate",
                        promise,
                    });
                },
            );
        }

        return () => {
            isCancelled = true;
        };
    }, [optimisticUpdates]);

    // Subscribe to realtime events that may change what's in the inbox.
    useEffect(() => {
        return subscribeToEvents(event =>
            dispatch({
                type: "Update",
                update: query =>
                    query.handleEventTransaction(event.readTime, event.eventTransaction),
            }),
        );
    }, [subscribeToEvents]);

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

        backfillInboxEntries(context, {
            spaceId: space.id,
            readTime: query.getReadTime(),
        }).then(
            ({backfillEntriesResult}) => {
                switch (backfillEntriesResult.type) {
                    case "Available": {
                        dispatch({
                            type: "Update",
                            update: query =>
                                query.handleEventTransaction(
                                    backfillEntriesResult.readTime,
                                    backfillEntriesResult.eventTransaction,
                                ),
                        });
                        break;
                    }
                    case "Unavailable": {
                        // If a backfill is unavailable then fully reload our inbox entries to catch us
                        // up to the latest data.
                        getInboxEntries(context, {
                            spaceId: space.id,
                            filter,
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

                                dispatch({
                                    type: "Update",
                                    update: () =>
                                        DynamoGeneralRealtimeIndexQuery.new(entriesResult),
                                });
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

        // Also observe the inbox when we successfully connect to realtime. When we're
        // connected to realtime this also incidentally means the page is visible.
        //
        // We find this a pretty reasonable place to say "ok, the user is actually
        // looking at the inbox" whether they are looking at the inbox page or the
        // inbox preview overlay.
        observeInbox(context, {spaceId: space.id}).catch(error => {
            context.tracer.getRoot().logUncaughtException("Couldn't observe inbox", error);
        });
    }, [context, filter, isConnected, query, space.id]);

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
                        filter,
                        limit,
                        afterCursor,
                    });

                    dispatch({
                        type: "Update",
                        update: query => query.loadMore(entriesResult),
                    });
                })();

                return {isLoading: true, promise};
            }
        },
    );

    return {
        query,
        updateQueryOptimistically,
        itemsDeletedByLastChangeForAnimation,
        tryLoadingMore,
    };
}
