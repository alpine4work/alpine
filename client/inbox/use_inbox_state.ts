import {useCallback, useEffect, useReducer, useRef} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {useReporter} from "~/client/design/reporter.js";
import {DynamoGeneralRealtimeIndexQuery} from "~/client/dynamo/dynamo_general_realtime_index_query.js";
import {useDynamoGeneralRealtimeIndexQueryBase} from "~/client/dynamo/use_dynamo_general_realtime_index_query.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useErrorState} from "~/client/helpers/use_error_state.js";
import {
    ActionForStateWithOptimisticUpdates,
    StateWithOptimisticUpdates,
    getInitialStateWithOptimisticUpdates,
    reduceStateWithOptimisticUpdates,
    useStateWithOptimisticUpdatesMonitor,
} from "~/client/helpers/use_state_with_optimistic_updates.js";
import {useWaitForState} from "~/client/helpers/use_wait_for_state.js";
import {
    subscribeToArchiveInboxChannelPostsEntryPostOptimistically,
    subscribeToUnarchiveInboxChannelPostsEntryPostOptimistically,
} from "~/client/inbox/use_archive_inbox_channel_posts_entry_post.js";
import {
    subscribeToArchiveInboxEntryOptimistically,
    subscribeToUnarchiveInboxEntryOptimistically,
} from "~/client/inbox/use_archive_inbox_entry.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {useIsInertNativeMobileRoute} from "~/client/remix/use_is_inert_native_mobile_route.js";
import {useMyAccountWebSocket, useSpaceContext} from "~/client/spaces/space_context.js";
import {inboxEntryViewMinHeight} from "~/client/styles/inbox_shared_styles.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/get_initial_virtualized_scroll_view_rendered_item_count.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {InboxChannelPostsEntryModel, InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {
    backfillInboxEntries,
    getInboxEntries,
    observeInbox,
} from "~/shared/rpc/notifications_rpc_definitions.js";

type InboxState = {
    readonly query: StateWithOptimisticUpdates<DynamoGeneralRealtimeIndexQuery<InboxEntryModel>>;
    readonly withoutAnimation: boolean;
    readonly itemsDeletedByLastChangeForAnimation: ReadonlyArray<{
        readonly index: number;
        readonly cursor: DynamoIndexCursor;
        readonly item: DynamoGeneralRealtimeItem<InboxEntryModel>;
    }>;
};

type InboxStateAction =
    | (ActionForStateWithOptimisticUpdates<DynamoGeneralRealtimeIndexQuery<InboxEntryModel>> & {
          readonly withAnimation: boolean;
      })
    | {
          readonly type: "SetWithoutAnimation";
          readonly withoutAnimation: boolean;
      };

function getInitialInboxState({
    initialEntriesResult,
    withoutAnimation = false,
}: {
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>;
    withoutAnimation?: boolean;
}): InboxState {
    const query = DynamoGeneralRealtimeIndexQuery.new(initialEntriesResult);

    return {
        query: getInitialStateWithOptimisticUpdates(query),
        withoutAnimation,
        itemsDeletedByLastChangeForAnimation: emptyArray,
    };
}

function reduceInboxState(state: InboxState, action: InboxStateAction): InboxState {
    if (action.type === "SetWithoutAnimation") {
        return {
            query: state.query,
            withoutAnimation: action.withoutAnimation,
            itemsDeletedByLastChangeForAnimation: emptyArray,
        };
    }

    const newQuery = reduceStateWithOptimisticUpdates(state.query, action);

    return {
        query: newQuery,
        withoutAnimation: state.withoutAnimation,
        itemsDeletedByLastChangeForAnimation:
            !state.withoutAnimation && action.withAnimation
                ? Array.from(newQuery.value.getDeletedItems(state.query.value))
                : emptyArray,
    };
}

/**
 * Manages the inbox's realtime state.
 *
 * - Subscribes to realtime changes to the inbox
 * - Backfills realtime changes when we connect to realtime
 * - Provides a function to load more data based on what's rendered
 */
export function useInboxState(props: {
    filter: "New" | "Archive";
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>;
    withoutAnimation?: boolean;
}) {
    const {filter} = props;

    const context = useAppContext();
    const reporter = useReporter();
    const {space} = useSpaceContext();
    const {isConnected, subscribeToEvents, subscribeToPongs} = useMyAccountWebSocket();

    const [
        {
            query: queryState,
            withoutAnimation: oldWithoutAnimation,
            itemsDeletedByLastChangeForAnimation,
        },
        dispatch,
    ] = useReducer(reduceInboxState, props, getInitialInboxState);

    const {value: query, valueWithoutOptimisticUpdates: queryWithoutOptimisticUpdates} = queryState;

    useStateWithOptimisticUpdatesMonitor(
        queryState,
        useCallback(action => dispatch({...action, withAnimation: true}), []),
    );

    const newWithoutAnimation = useIsInertNativeMobileRoute() || (props.withoutAnimation ?? false);

    if (oldWithoutAnimation !== newWithoutAnimation) {
        dispatch({
            type: "SetWithoutAnimation",
            withoutAnimation: newWithoutAnimation,
        });
    }

    const waitForQueryWithoutOptimisticUpdates = useWaitForState(queryWithoutOptimisticUpdates);

    const updateQueryOptimistically = useCallback(
        (
            event: {promise: Promise<unknown>; withAnimation: boolean},
            update: (
                query: DynamoGeneralRealtimeIndexQuery<InboxEntryModel>,
            ) => DynamoGeneralRealtimeIndexQuery<InboxEntryModel>,
        ) => {
            dispatch({
                type: "OptimisticUpdate",
                withAnimation: event.withAnimation,
                promise: event.promise.then(() =>
                    // Wait to resolve our optimistic update until we receive a realtime event that
                    // turns our optimistic update into a noop.
                    //
                    // That's because we don't trust that by the time `promise` resolves we've seen
                    // the realtime event from our WebSocket. `promise` may be from an RPC call
                    // which kicks off a background `NotificationEvent` job that eventually sends
                    // the realtime event we're looking for. We don't want to resolve our optimistic
                    // update until that background job finishes and we've seen the realtime event.
                    // Otherwise unrelated realtime events may overwrite our optimistic update
                    // causing the UI to glitch for the user.
                    waitForQueryWithoutOptimisticUpdates(query => update(query) === query),
                ),
                update,
            });
        },
        [waitForQueryWithoutOptimisticUpdates],
    );

    useEffect(() => {
        if (filter === "New") {
            return subscribeToArchiveInboxEntryOptimistically(event => {
                updateQueryOptimistically(event, query =>
                    query.optimisticallyDeleteItemByKeyIfExists(event.entry.key),
                );
            });
        } else {
            return subscribeToUnarchiveInboxEntryOptimistically(event => {
                updateQueryOptimistically(event, query =>
                    query.optimisticallyDeleteItemByKeyIfExists(event.entry.key),
                );
            });
        }
    }, [filter, space.id, updateQueryOptimistically]);

    useEffect(() => {
        // We won't see archive post events if we're looking at archived inbox entries
        // because in an archived channel posts entry all posts are already archived.
        if (filter === "Archive") return;

        return subscribeToArchiveInboxChannelPostsEntryPostOptimistically(event => {
            updateQueryOptimistically(event, query =>
                query.optimisticallyUpdateItemByKeyIfExists(event.entry.key, item => {
                    if (!(item.model instanceof InboxChannelPostsEntryModel)) return item;

                    const post = item.model.posts.get(event.postId);
                    if (!post) return item;
                    if (post.isArchived) return item;

                    const newPosts = new Map(item.model.posts);
                    newPosts.set(event.postId, {isArchived: true});

                    // If every post is now archived, the entire entry is archived! So delete the
                    // entry from our query.
                    if (iterableEvery(newPosts.values(), post => post.isArchived)) return null;

                    return {
                        ...item,
                        model: item.model.clone({posts: newPosts}),
                    };
                }),
            );
        });
    }, [filter, space.id, updateQueryOptimistically]);

    useEffect(() => {
        return subscribeToUnarchiveInboxChannelPostsEntryPostOptimistically(event => {
            updateQueryOptimistically(event, query =>
                query.optimisticallyUpdateItemByKeyIfExists(event.entry.key, item => {
                    if (!(item.model instanceof InboxChannelPostsEntryModel)) return item;

                    const post = item.model.posts.get(event.postId);
                    if (!post) return item;
                    if (!post.isArchived) return item;

                    const newPosts = new Map(item.model.posts);
                    newPosts.set(event.postId, {isArchived: false});

                    // If we're looking at archived inbox entries and a single post is now
                    // unarchived then delete this entry from our query.
                    if (
                        filter === "Archive" &&
                        !iterableEvery(newPosts.values(), post => post.isArchived)
                    ) {
                        return null;
                    }

                    return {
                        ...item,
                        model: item.model.clone({posts: newPosts}),
                    };
                }),
            );
        });
    }, [filter, space.id, updateQueryOptimistically]);

    useDynamoGeneralRealtimeIndexQueryBase(
        {
            query,
            onUpdateQuery: useCallback(
                (
                    update: (
                        query: DynamoGeneralRealtimeIndexQuery<InboxEntryModel>,
                    ) => DynamoGeneralRealtimeIndexQuery<InboxEntryModel>,
                ) => dispatch({type: "Update", update, withAnimation: true}),
                [],
            ),
        },
        {
            isConnected,
            subscribeToPongs,
            subscribeToEvents: useCallback(
                subscriber => subscribeToEvents(event => subscriber(event.eventTransaction)),
                [subscribeToEvents],
            ),
            backfillQuery: useCallback(
                async checkpoint => {
                    // Also observe the inbox when we successfully connect to realtime. When we're
                    // connected to realtime this also incidentally means the page is visible.
                    //
                    // We find this a pretty reasonable place to say "ok, the user is actually
                    // looking at the inbox" whether they are looking at the inbox page or the
                    // inbox preview overlay.
                    //
                    // It's also nice that we create an RPC batch with the backfill request.
                    observeInbox(context, {spaceId: space.id}).catch(error => {
                        reporter.logErrorWithoutDisplaying("Couldn’t observe inbox", error);
                    });

                    const {backfillEntriesResult} = await backfillInboxEntries(context, {
                        spaceId: space.id,
                        checkpoint,
                    });
                    return backfillEntriesResult;
                },
                [context, reporter, space.id],
            ),
            reloadQuery: useCallback(async () => {
                const {entriesResult} = await getInboxEntries(context, {
                    spaceId: space.id,
                    filter,
                    limit: getInitialVirtualizedScrollViewRenderedItemCount(
                        getClientInfo(),
                        inboxEntryViewMinHeight,
                    ),
                    afterCursor: null,
                });
                return entriesResult;
            }, [context, filter, space.id]),
        },
    );

    const isLoadingRef = useRef(false);
    const setErrorState = useErrorState();

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
                    setErrorState(error);
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
                                    getSpacingScaleWithoutListening(),
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
                        withAnimation: true,
                    });
                })();

                return {isLoading: true, promise};
            }
        },
    );

    return {
        query,
        itemsDeletedByLastChangeForAnimation,
        tryLoadingMore,
    };
}
