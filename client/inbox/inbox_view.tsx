import {RemixEntryContext} from "@remix-run/react";
import {MemoryHistory, createMemoryHistory, createPath} from "history";
import {SpinnerGap} from "phosphor-react";
import {MutableRefObject, useCallback, useContext, useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {delayFullPageTransitionLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {DynamoGeneralRealtimeIndexQuery} from "~/client/dynamo/dynamo_general_realtime_index_query";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {usePromise} from "~/client/helpers/use_promise";
import {InboxEntryView, inboxEntryViewMinHeight} from "~/client/inbox/inbox_entry_view";
import {loadInitialPeekDataForClient} from "~/client/peek/load_initial_peek_data_for_client";
import {
    convertPeekPathToSpacePath,
    convertSpacePathToPeekPath,
} from "~/client/peek/peek_path_helpers";
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

export type InboxViewPeek = {
    readonly id: PeekId;
    readonly key: DynamoItemKey | null;
    readonly initialPath: string;
    readonly history: MemoryHistory;
    readonly loaderDataRefPromise: PromiseImmediate<MutableRefObject<{[key: string]: unknown}>>;
};

type InboxViewPeekState = {
    readonly activePeek: InboxViewPeek | null;
    readonly transitionPeek: InboxViewPeek | null;
};

export function InboxView({
    initialEntriesResult,
    initialPeekData,
    onPeekChange,
}: {
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>;
    initialPeekData: {path: string; loaderData: unknown} | null;
    onPeekChange: (peek: InboxViewPeek | null) => void;
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

    // Takes the initial path we get when server-side rendering and returns the key
    // for the first item in our query that has a matching path.
    //
    // The item that rendered the path in the previous session may be offscreen. So
    // we will only know the corresponding key when it's lazy loaded.
    const findItemKeyForPathIfExists = useCallback(
        (initialPath: string): DynamoItemKey | null => {
            const itemCount = query.getItemCount();
            for (let i = 0; i < itemCount; i++) {
                const item = query.getItem(i);
                if (item.type === "LoadedItem") {
                    const path = item.item.model.getPath();
                    const pathString = typeof path !== "string" ? createPath(path) : path;
                    if (pathString === initialPath) {
                        return item.item.key;
                    }
                }
            }
            return null;
        },
        [query],
    );

    const [peekState, setPeekState] = useState<InboxViewPeekState>(() => {
        if (!initialPeekData) {
            return {
                activePeek: null,
                transitionPeek: null,
            };
        }

        const initialPath = createPath(
            assertExists(convertPeekPathToSpacePath(initialPeekData.path)),
        );

        return {
            activePeek: {
                id: generateId(),
                key: findItemKeyForPathIfExists(initialPath),
                initialPath,
                history: createMemoryHistory({initialEntries: [initialPeekData.path]}),
                loaderDataRefPromise: PromiseImmediate.resolve({
                    current: initialPeekData.loaderData as {[key: string]: unknown},
                }),
            },
            transitionPeek: null,
        };
    });

    // If we don't know the item key for our peek, try searching the query whenever
    // we load new data to see if an item was loaded that matches our peek's path.
    //
    // This will happen when we server-side render a peek who's item is not
    // included in the initial set of inbox entries.
    useEffect(() => {
        if (peekState.activePeek && !peekState.activePeek.key) {
            setPeekState(peekState => {
                if (!peekState.activePeek || peekState.activePeek.key) {
                    return peekState;
                }
                return {
                    ...peekState,
                    activePeek: {
                        ...peekState.activePeek,
                        key: findItemKeyForPathIfExists(peekState.activePeek.initialPath),
                    },
                };
            });
        }
    }, [findItemKeyForPathIfExists, peekState.activePeek]);

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
            const {loaderData} = await loadInitialPeekDataForClient(
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
                initialPath: typeof spacePath !== "string" ? createPath(spacePath) : spacePath,
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

    const selectedPeek = peekState.transitionPeek ?? peekState.activePeek;
    const selectedEntryKey = selectedPeek?.key;

    const lastSelectedEntryKeyRef = useRef(selectedEntryKey);
    useLayoutEffectWithoutServerSideWarning(() => {
        const entriesView = assertExists(entriesViewRef.current);

        if (lastSelectedEntryKeyRef.current === selectedPeek?.key) return;
        lastSelectedEntryKeyRef.current = selectedPeek?.key;

        if (!selectedPeek) {
            onPeekChange(null);
        } else {
            // When a new entry is selected, make sure it is visible in our scroll window. Scroll to
            // it if it is not visible.
            if (selectedPeek.key) entriesView.scrollToKeyIfExists(`LoadedItem:${selectedPeek.key}`);

            onPeekChange(selectedPeek);
        }
    }, [onPeekChange, selectedEntryKey, selectedPeek]);

    // We use this to help assistive technologies understand our list
    // virtualization. If we haven't loaded all items we set the size to -1 which
    // indicates the size is unknown.
    // https://w3c.github.io/aria/#aria-setsize
    const ariaSetsize =
        query.getItemCountWithoutLoadingIndicator() === query.getItemCount()
            ? query.getItemCount()
            : -1;

    return (
        <GlobalKeyDownEvent
            onGlobalKeyDown={event => {
                switch (event.key) {
                    case "ArrowUp": {
                        // If focus is within a text input element then arrow key presses are for
                        // text editing.
                        if (isTextInputElement(document.activeElement)) break;

                        event.stopPropagation();
                        event.preventDefault();

                        // If an item is already selected, select the previous item. Otherwise select
                        // the first item.
                        if (selectedEntryKey) {
                            const previousEntry = query.getItemBeforeKeyIfExists(selectedEntryKey);
                            if (previousEntry) {
                                selectEntry(previousEntry);
                            }
                        } else if (query.getItemCount() > 0) {
                            const item = query.getItem(0);
                            if (item.type === "LoadedItem") {
                                selectEntry(item.item);
                            }
                        }
                        break;
                    }
                    case "ArrowDown": {
                        // If focus is within a text input element then arrow key presses are for
                        // text editing.
                        if (isTextInputElement(document.activeElement)) break;

                        event.stopPropagation();
                        event.preventDefault();

                        // If an item is already selected, select the next item. Otherwise select
                        // the first item.
                        if (selectedEntryKey) {
                            const nextEntry = query.getItemAfterKeyIfExists(selectedEntryKey);
                            if (nextEntry) {
                                selectEntry(nextEntry);
                            }
                        } else if (query.getItemCount() > 0) {
                            const item = query.getItem(0);
                            if (item.type === "LoadedItem") {
                                selectEntry(item.item);
                            }
                        }
                        break;
                    }
                }
            }}
        >
            <Box flexGrow="1" overflow="hidden" display="flex">
                <FocusRing offset="inset">
                    <Box
                        // Our notification inbox implements the `listbox` ARIA role. So the inbox
                        // receives focus and you use arrow keys to navigate through notifications.
                        // https://www.w3.org/WAI/ARIA/apg/patterns/listbox
                        //
                        // The arrow key keyboard handlers are attached globally with
                        // `<GlobalKeyDownEvent>` so the user doesn't need the listbox focused to
                        // move between items. (This is nice for sighted users who like
                        // keyboard shortcuts.)
                        role="listbox"
                        tabIndex={0}
                        aria-label="Inbox"
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
                                                        isSelected={
                                                            selectedEntryKey === item.item.key
                                                        }
                                                        onPress={() => selectEntry(item.item)}
                                                        aria-posinset={index}
                                                        aria-setsize={ariaSetsize}
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
                                [ariaSetsize, query, selectEntry, selectedEntryKey],
                            )}
                        />
                    </Box>
                </FocusRing>
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
        </GlobalKeyDownEvent>
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
