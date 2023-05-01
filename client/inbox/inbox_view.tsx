import {RemixEntryContext} from "@remix-run/react";
import {MemoryHistory, createMemoryHistory} from "history";
import {SpinnerGap} from "phosphor-react";
import {MutableRefObject, useCallback, useContext, useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {delayFullPageTransitionLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {DynamoGeneralRealtimeIndexQuery} from "~/client/dynamo/dynamo_general_realtime_index_query";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {usePromise} from "~/client/helpers/use_promise";
import {InboxEntryView, inboxEntryViewMinHeight} from "~/client/inbox/inbox_entry_view";
import {loadInitialPeekData} from "~/client/peek/load_initial_peek_data";
import {convertSpacePathToPeekPath} from "~/client/peek/peek_path_helpers";
import {PeekRemixEmbed} from "~/client/peek/peek_remix_embed";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context";
import {useMyAccountWebSocket, useSpaceContext} from "~/client/spaces/space_context";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    getInitialVirtualizedScrollViewRenderedItemCount,
} from "~/client/virtualized/virtualized_scroll_view";
import {convertRemLengthToPx, spacing} from "~/shared/design/spacing";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types";
import {DynamoItemKey} from "~/shared/dynamo/dynamo_opaque_strings";
import {InternalError} from "~/shared/error/error";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {generateId} from "~/shared/id/id";
import {PeekId} from "~/shared/id/types/id_types";
import {InboxEntryModel} from "~/shared/models/inbox_model";
import {backfillInboxEntries, getInboxEntries} from "~/shared/rpc/notifications_rpc_definitions";
import {colorSchemeVars, spinAnimationClassName} from "~/shared/styles/styles";

type InboxViewPeek = {
    readonly id: PeekId;
    readonly key: DynamoItemKey;
    readonly history: MemoryHistory;
    readonly loaderDataRefPromise: PromiseImmediate<MutableRefObject<{[key: string]: unknown}>>;
};

type InboxViewPeekState = {
    readonly activePeek: InboxViewPeek | null;
    readonly transitionPeek: InboxViewPeek | null;
};

export function InboxView({
    initialEntriesResult,
}: {
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>;
}) {
    const remixEntryContext = useContext(RemixEntryContext);
    assert(remixEntryContext, "Expected Remix entry context");

    const entriesViewRef = useRef<VirtualizedScrollViewRef>(null);
    const context = useAppContext();
    const {space} = useSpaceContext();
    const [query, setQuery] = useState(() =>
        DynamoGeneralRealtimeIndexQuery.new(initialEntriesResult),
    );

    const {isConnected, subscribeToEvents} = useMyAccountWebSocket();

    // Subscribe to realtime events that may change what's in the inbox.
    useEffect(() => {
        return subscribeToEvents(event =>
            setQuery(query => query.handleEventTransaction(event.readTime, event.eventTransaction)),
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
                        setQuery(query =>
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

                                setQuery(DynamoGeneralRealtimeIndexQuery.new(entriesResult));
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

                const entriesView = assertExists(entriesViewRef.current);
                const entriesViewHeight = entriesView.getHeight();

                const promise = (async () => {
                    // The limit of items we will load is one view worth of entries. This gives
                    // the user some space to scroll and read before we need to load more entries.
                    const limit = Math.max(
                        20,
                        Math.ceil(
                            entriesViewHeight /
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

                    setQuery(query => query.loadMore(entriesResult));
                })();

                return {isLoading: true, promise};
            }
        },
    );

    // Whenever our query data changes, try loading more entries. In case our
    // rendered range stayed the same but we now see the loading indicator.
    //
    // This effect should also fire when `tryLoadingMore()` completes in case it
    // didn't fully load the query.
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        query;

        const view = assertExists(entriesViewRef.current);
        tryLoadingMore(view.getRenderedRange());
    }, [query, tryLoadingMore]);

    const [peekState, setPeekState] = useState<InboxViewPeekState>({
        activePeek: null,
        transitionPeek: null,
    });

    const selectEntry = useEvent((entry: DynamoGeneralRealtimeItem<InboxEntryModel>) => {
        // Don't select the same entry twice in a row since that would cause two
        // data fetches.
        if ((peekState.transitionPeek ?? peekState.activePeek)?.key === entry.key) {
            return;
        }

        const abortController = new AbortController();

        const spacePath = entry.model.getPath();
        const peekPath = convertSpacePathToPeekPath(spacePath);
        if (!peekPath) throw new InternalError("Can only render peek for a space route");

        const loaderDataRefPromise = (async () => {
            const {loaderData} = await loadInitialPeekData(
                remixEntryContext.clientRoutes,
                spacePath,
                abortController.signal,
            );
            return {current: loaderData};
        })();

        setPeekState({
            activePeek: peekState.activePeek,
            transitionPeek: {
                id: generateId(),
                key: entry.key,
                history: createMemoryHistory({initialEntries: [peekPath]}),
                loaderDataRefPromise: PromiseImmediate.resolve(loaderDataRefPromise),
            },
        });
    });

    useEffect(() => {
        if (!peekState.transitionPeek) return;

        let isCancelled = false;
        let isAccepted = false;

        const acceptTransition = () => {
            if (isCancelled) return;

            if (isAccepted) return;
            isAccepted = true;

            setPeekState({
                activePeek: peekState.transitionPeek,
                transitionPeek: null,
            });
        };

        // Accept the transition with whatever comes first:
        //
        // - Our data promise resolves
        // - Our loading indicator delay finishes
        peekState.transitionPeek.loaderDataRefPromise.then(acceptTransition, acceptTransition);
        const timeout = createTimeout(
            acceptTransition,
            delayFullPageTransitionLoadingIndicatorLimitMs,
        );

        return () => {
            isCancelled = true;
            timeout.clear();
        };
    }, [peekState]);

    const selectedEntryItemKey = (peekState.transitionPeek ?? peekState.activePeek)?.key;

    return (
        <Box flexGrow="1" overflow="hidden" display="flex">
            <Box
                flexShrink="0"
                overflow="hidden"
                width="96"
                backgroundColor="grey-0"
                borderRight="grey-10"
            >
                <VirtualizedScrollView
                    ref={entriesViewRef}
                    bufferedItemHeight={inboxEntryViewMinHeight}
                    onRenderedRangeChange={tryLoadingMore}
                    itemCount={query.getItemCount()}
                    renderItem={useCallback(
                        index => {
                            const item = query.getItem(index);
                            switch (item.type) {
                                case "LoadedItem": {
                                    return {
                                        key: `LoadedItem:${item.item.key}`,
                                        minHeight: inboxEntryViewMinHeight,
                                        node: (
                                            <InboxEntryView
                                                entry={item.item.model}
                                                isSelected={selectedEntryItemKey === item.item.key}
                                                onPress={() => selectEntry(item.item)}
                                            />
                                        ),
                                    };
                                }
                                case "LoadingIndicator": {
                                    return {
                                        key: "LoadingIndicator",
                                        minHeight: inboxEntryViewMinHeight,
                                        node: (
                                            <Box
                                                display="flex"
                                                justifyContent="center"
                                                alignItems="center"
                                                style={{height: inboxEntryViewMinHeight}}
                                            >
                                                <SpinnerGap
                                                    className={spinAnimationClassName}
                                                    color={colorSchemeVars["grey-60"]}
                                                    size={spacing["4"]}
                                                />
                                            </Box>
                                        ),
                                    };
                                }
                                default:
                                    throw exhaustive(item);
                            }
                        },
                        [query, selectEntry, selectedEntryItemKey],
                    )}
                />
            </Box>
            <Box flexGrow="1" overflow="hidden">
                {peekState.activePeek && (
                    <InboxViewPeekContent
                        // Fully remount whenever the peek changes...
                        key={peekState.activePeek.key}
                        peek={peekState.activePeek}
                    />
                )}
            </Box>
        </Box>
    );
}

function InboxViewPeekContent({peek}: {peek: InboxViewPeek}) {
    const loaderDataRefResult = usePromise(peek.loaderDataRefPromise);

    return (
        <Box width="full" height="full" overflow="hidden" display="flex" flexDirection="column">
            {!loaderDataRefResult.isPending ? (
                <PeekRemixEmbed
                    peekId={peek.id}
                    withMobileLayout={false}
                    loaderDataRef={loaderDataRefResult.value}
                    history={peek.history}
                />
            ) : (
                <Box flexGrow="1" display="flex" justifyContent="center" alignItems="center">
                    <SpinnerGap
                        className={spinAnimationClassName}
                        color={colorSchemeVars["grey-70"]}
                        size={spacing["6"]}
                    />
                </Box>
            )}
        </Box>
    );
}
