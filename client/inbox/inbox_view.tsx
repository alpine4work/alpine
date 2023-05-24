import {RemixEntryContext} from "@remix-run/react";
import {MemoryHistory, createMemoryHistory, createPath} from "history";
import {SpinnerGap} from "phosphor-react";
import {
    Memo,
    MutableRefObject,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {useRemPx} from "~/client/design/helpers/use_rem_px";
import {delayFullPageTransitionLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {DynamoGeneralRealtimeIndexQuery} from "~/client/dynamo/dynamo_general_realtime_index_query";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies";
import {usePromise} from "~/client/helpers/use_promise";
import {
    InboxEntryView,
    inboxEntryDeleteAnimationDurationMs,
    inboxEntryViewMinHeight,
    inboxEntryWidth,
} from "~/client/inbox/inbox_entry_view";
import {InboxPeekContextProvider} from "~/client/inbox/inbox_peek_context";
import {InboxViewEntriesEmpty} from "~/client/inbox/inbox_view_entries_empty";
import {InboxViewTopBar} from "~/client/inbox/inbox_view_top_bar";
import {useInboxState} from "~/client/inbox/use_inbox_state";
import {loadInitialPeekDataForClient} from "~/client/peek/load_initial_peek_data_for_client";
import {PeekRemixEmbed} from "~/client/peek/peek_remix_embed";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view";
import {convertRemLengthToPx, spacing} from "~/shared/design/spacing";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types";
import {DynamoIndexCursor, DynamoItemKey} from "~/shared/dynamo/dynamo_opaque_strings";
import {InternalError} from "~/shared/error/error";
import {createInterval} from "~/shared/helpers/async/interval";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {generateId} from "~/shared/id/id";
import {PeekId} from "~/shared/id/types/id_types";
import {InboxEntryModel} from "~/shared/notifications/inbox_model";
import {
    convertPeekPathToSpacePath,
    convertSpacePathToPeekPath,
} from "~/shared/remix/peek_path_helpers";
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
    readonly transition: {
        readonly peek: InboxViewPeek;
        readonly pendingPromiseResolver: PromiseResolver<void>;
    } | null;
};

export function InboxView({
    filter,
    initialEntriesResult,
    initialPeekData,
    onPeekChange,
}: {
    filter: "New" | "Archive";
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>;
    initialPeekData: {path: string; loaderData: unknown} | null;
    onPeekChange: (peek: InboxViewPeek | null) => void;
}) {
    const remixEntryContext = useContext(RemixEntryContext);
    assert(remixEntryContext, "Expected Remix entry context");

    const {query, updateQueryOptimistically, itemsDeletedByLastChangeForAnimation, tryLoadingMore} =
        useInboxState({
            filter,
            initialEntriesResult,
        });

    /* ========================================================================== *\
     *                                 Peek state                                 *
    \* ========================================================================== */

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
                if (item.type === "Loaded") {
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
                transition: null,
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
            transition: null,
        };
    });

    // If we don't know the item key for our peek, try searching the query whenever
    // we load new data to see if an item was loaded that matches our peek's path.
    //
    // This will happen when we server-side render a peek who's item is not
    // included in the initial set of inbox entries.
    useEffect(() => {
        if (peekState.activePeek && !peekState.activePeek.key) {
            const key = findItemKeyForPathIfExists(peekState.activePeek.initialPath);

            if (key) {
                setPeekState(peekState => {
                    if (!peekState.activePeek || peekState.activePeek.key) {
                        return peekState;
                    }
                    return {
                        ...peekState,
                        activePeek: {...peekState.activePeek, key},
                    };
                });
            }
        }
    }, [findItemKeyForPathIfExists, peekState.activePeek]);

    const activeEntry = useMemo(
        () =>
            peekState.activePeek && peekState.activePeek.key
                ? query.getItemByKeyIfExists(peekState.activePeek.key)
                : null,
        [peekState.activePeek, query],
    );

    const deleteEntryOptimistically = useEvent(
        ({
            promise,
            entry,
            withAnimation,
        }: {
            promise: Promise<unknown>;
            entry: DynamoGeneralRealtimeItem<InboxEntryModel>;
            withAnimation: boolean;
        }) => {
            updateQueryOptimistically({
                promise,
                withAnimation,
                update: query => query.deleteItemByKeyIfExistsAtVersion(entry.key, entry.version),
            });
        },
    );

    /* ========================================================================== *\
     *                           Inbox entry selection                            *
    \* ========================================================================== */

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const selectEntry = useEvent((entry: DynamoGeneralRealtimeItem<InboxEntryModel> | null) => {
        if (!entry) {
            setPeekState({
                activePeek: null,
                transition: null,
            });
            return Promise.resolve();
        }

        // Don't select the same entry twice in a row since that would cause two
        // data fetches.
        if ((peekState.transition?.peek ?? peekState.activePeek)?.key === entry.key) {
            return Promise.resolve();
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

        const pendingPromiseResolver = createPromiseResolver();

        setPeekState({
            activePeek: peekState.activePeek,
            transition: {
                peek: {
                    id: generateId(),
                    key: entry.key,
                    initialPath: typeof spacePath !== "string" ? createPath(spacePath) : spacePath,
                    history: createMemoryHistory({initialEntries: [peekPath]}),
                    loaderDataRefPromise: PromiseImmediate.resolve(loaderDataRefPromise),
                },
                pendingPromiseResolver,
            },
        });

        return pendingPromiseResolver.promise;
    });

    useEffect(() => {
        const {transition} = peekState;
        if (!transition) return;

        let isCancelled = false;
        let isAccepted = false;

        const acceptTransition = () => {
            if (isCancelled) return;

            if (isAccepted) return;
            isAccepted = true;

            transition.pendingPromiseResolver.resolve();

            setPeekState({
                activePeek: transition.peek,
                transition: null,
            });
        };

        // Accept the transition with whatever comes first:
        //
        // - Our data promise resolves
        // - Our loading indicator delay finishes
        transition.peek.loaderDataRefPromise.then(acceptTransition, acceptTransition);
        const timeout = createTimeout(
            acceptTransition,
            delayFullPageTransitionLoadingIndicatorLimitMs,
        );

        return () => {
            isCancelled = true;
            timeout.clear();
            transition.pendingPromiseResolver.resolve();
        };
    }, [peekState]);

    const selectedPeek = peekState.transition?.peek ?? peekState.activePeek;
    const selectedEntryKey = selectedPeek?.key ?? null;

    const selectedEntry = useMemo(
        () => (selectedEntryKey ? query.getItemByKeyIfExists(selectedEntryKey) : null),
        [query, selectedEntryKey],
    );

    // Whenever a new entry is selected we want to call our `onPeekChange()`
    // callback which changes the URL.
    const lastSelectedEntryKeyRef = useRef(selectedEntryKey);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (lastSelectedEntryKeyRef.current === selectedPeek?.key) return;
        lastSelectedEntryKeyRef.current = selectedPeek?.key ?? null;

        onPeekChange(selectedPeek);
    }, [onPeekChange, selectedEntryKey, selectedPeek]);

    /* ========================================================================== *\
     *                    Adjacent inbox entries to selection                     *
    \* ========================================================================== */

    const [rememberedSelectedEntryCursor, setRememberedSelectedEntryCursor] =
        useStateWithDependencies(selectedEntry?.cursor ?? null, [selectedEntryKey]);

    // If `selectedEntry` changes then update `rememberedSelectedEntryCursor`. But
    // not when `selectedEntry` changes to null! If `selectedEntry` is null we want
    // to remember the old cursor for `selectedEntryKey`.
    if (selectedEntry && rememberedSelectedEntryCursor !== selectedEntry.cursor) {
        setRememberedSelectedEntryCursor(selectedEntry.cursor);
    }

    const nextEntry = useMemo(() => {
        // If we know where the selected item is in the inbox, select the item after
        // it. Otherwise select the first item.
        if (rememberedSelectedEntryCursor) {
            return query.getItemAfterCursorIfExists(rememberedSelectedEntryCursor);
        } else if (query.getItemCount() > 0) {
            const item = query.getItem(0);
            return item.type === "Loaded" ? item.item : null;
        } else {
            return null;
        }
    }, [query, rememberedSelectedEntryCursor]);

    const previousEntry = useMemo(() => {
        // If we know where the selected item is in the inbox, select the item before
        // it. Otherwise select the first item.
        if (rememberedSelectedEntryCursor) {
            return query.getItemBeforeCursorIfExists(rememberedSelectedEntryCursor);
        } else if (query.getItemCount() > 0) {
            const item = query.getItem(0);
            return item.type === "Loaded" ? item.item : null;
        } else {
            return null;
        }
    }, [query, rememberedSelectedEntryCursor]);

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

                        if (previousEntry) {
                            void selectEntry(previousEntry);
                        }
                        break;
                    }
                    case "ArrowDown": {
                        // If focus is within a text input element then arrow key presses are for
                        // text editing.
                        if (isTextInputElement(document.activeElement)) break;

                        event.stopPropagation();
                        event.preventDefault();

                        if (nextEntry) {
                            void selectEntry(nextEntry);
                        }
                        break;
                    }
                }
            }}
        >
            <InboxViewTopBar
                filter={filter}
                activeEntry={activeEntry?.item ?? null}
                nextEntry={nextEntry}
                previousEntry={previousEntry}
                selectEntry={selectEntry}
                deleteActiveEntryOptimistically={(promise, {withAnimation}) => {
                    if (!activeEntry) return;
                    deleteEntryOptimistically({promise, entry: activeEntry.item, withAnimation});
                }}
            />
            <Box flexGrow="1" overflow="hidden" display="flex">
                <Box
                    flexShrink="0"
                    width={inboxEntryWidth}
                    overflow="hidden"
                    backgroundColor="grey-0"
                    borderRight="grey-10"
                >
                    {query.getItemCount() === 0 ? (
                        <InboxViewEntriesEmpty filter={filter} />
                    ) : (
                        <InboxViewEntries
                            query={query}
                            tryLoadingMore={tryLoadingMore}
                            itemsDeletedByLastChangeForAnimation={
                                itemsDeletedByLastChangeForAnimation
                            }
                            selectedEntryKey={selectedEntryKey}
                            selectEntry={selectEntry}
                        />
                    )}
                </Box>
                {useMemo(
                    () => (
                        <Box flexGrow="1" overflow="hidden">
                            {peekState.activePeek && (
                                <InboxViewPeekContent
                                    // Fully remount whenever the peek changes...
                                    key={peekState.activePeek.key}
                                    filter={filter}
                                    peek={peekState.activePeek}
                                    entry={activeEntry?.item ?? null}
                                    deleteEntryOptimistically={deleteEntryOptimistically}
                                />
                            )}
                        </Box>
                    ),
                    [activeEntry, deleteEntryOptimistically, filter, peekState.activePeek],
                )}
            </Box>
        </GlobalKeyDownEvent>
    );
}

function InboxViewEntries({
    query,
    tryLoadingMore,
    itemsDeletedByLastChangeForAnimation,
    selectedEntryKey,
    selectEntry,
}: {
    query: DynamoGeneralRealtimeIndexQuery<InboxEntryModel>;
    tryLoadingMore: (
        viewHeight: number,
        renderedRange: {startIndex: number; endIndex: number} | null,
    ) => void;
    itemsDeletedByLastChangeForAnimation: ReadonlyArray<{
        index: number;
        cursor: DynamoIndexCursor;
        item: DynamoGeneralRealtimeItem<InboxEntryModel>;
    }>;
    selectedEntryKey: DynamoItemKey | null;
    selectEntry: (entry: DynamoGeneralRealtimeItem<InboxEntryModel>) => Promise<void>;
}) {
    const viewRef = useRef<VirtualizedScrollViewRef>(null);
    const remPx = useRemPx();

    // Whenever our query data changes, try loading more entries. In case our
    // rendered range stayed the same but we now see the loading indicator.
    //
    // This effect should also fire when `tryLoadingMore()` completes in case it
    // didn't fully load the query.
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        query;

        const view = assertExists(viewRef.current);
        tryLoadingMore(view.getHeight(), view.getRenderedRange());
    }, [query, tryLoadingMore]);

    const itemCount = query.getItemCount();

    // We use this to help assistive technologies understand our list
    // virtualization. If we haven't loaded all items we set the size to -1 which
    // indicates the size is unknown.
    // https://w3c.github.io/aria/#aria-setsize
    const ariaSetsize = query.getItemCountWithoutLoadingIndicator() === itemCount ? itemCount : -1;

    // Whenever a new entry is selected we want to scroll to that entry
    const lastSelectedEntryKeyRef = useRef(selectedEntryKey);
    useLayoutEffectWithoutServerSideWarning(() => {
        const view = assertExists(viewRef.current);

        if (lastSelectedEntryKeyRef.current === selectedEntryKey) return;
        lastSelectedEntryKeyRef.current = selectedEntryKey ?? null;

        // When a new entry is selected, make sure it is visible in our scroll window. Scroll to
        // it if it is not visible.
        if (selectedEntryKey) {
            view.scrollToKeyIfExists(`Loaded:${selectedEntryKey}`);
        }
    }, [selectedEntryKey]);

    const [deletedItemAnimationsState, setDeletedItemAnimationsState] = useState<{
        readonly currentAnimation: {
            readonly offset: number;
            readonly deletedItem: {
                readonly index: number;
                readonly cursor: DynamoIndexCursor;
                readonly item: DynamoGeneralRealtimeItem<InboxEntryModel>;
            };
        };
        readonly queuedAnimations: ReadonlyArray<{
            readonly offset: number;
            readonly deletedItem: {
                readonly index: number;
                readonly cursor: DynamoIndexCursor;
                readonly item: DynamoGeneralRealtimeItem<InboxEntryModel>;
            };
        }>;
    } | null>(null);

    // When an item is deleted, we start an animation to shift entries below the
    // deleted item up to fill its space. This helps users see an item was removed
    // and what happens next.
    {
        const deletedItem = itemsDeletedByLastChangeForAnimation[0];
        if (deletedItem) {
            // We should still have the height of the deleted item in
            // `VirtualizedScrollViewRef` since the render hasn't finished and unmounted
            // the element yet.
            let offset = viewRef.current?.getPositionByKeyIfExists(
                `Loaded:${deletedItem.item.key}`,
            )?.height;

            // If we are deleting the first item, don't animate into the top padding.
            if (typeof offset === "number" && deletedItem.index === 0) {
                offset -= convertRemLengthToPx(spacing["1"], remPx);
            }

            offset ??= convertRemLengthToPx(inboxEntryViewMinHeight, remPx);

            if (!deletedItemAnimationsState) {
                setDeletedItemAnimationsState({
                    currentAnimation: {
                        offset,
                        deletedItem,
                    },
                    queuedAnimations: [],
                });
            } else if (
                deletedItemAnimationsState.currentAnimation.deletedItem !== deletedItem &&
                deletedItemAnimationsState.queuedAnimations.every(
                    animation => animation.deletedItem !== deletedItem,
                )
            ) {
                setDeletedItemAnimationsState({
                    currentAnimation: deletedItemAnimationsState.currentAnimation,
                    queuedAnimations: [
                        ...deletedItemAnimationsState.queuedAnimations,
                        {
                            offset,
                            deletedItem,
                        },
                    ],
                });
            }
        }
    }

    const hasDeletedAnimationState = !!deletedItemAnimationsState;

    useEffect(() => {
        // Important to use a boolean here so we don't subscribe to all
        // `deletedItemAnimationsState` changes.
        if (!hasDeletedAnimationState) return;

        // Keep popping animations from the stack until `deletedItemAnimationsState` is
        // null which will re-run the effect and clear the interval.
        const interval = createInterval(() => {
            setDeletedItemAnimationsState(animationState => {
                if (!animationState) return null;

                const [currentAnimation, ...queuedAnimations] = animationState.queuedAnimations;
                if (!currentAnimation) return null;

                return {
                    currentAnimation,
                    queuedAnimations,
                };
            });
        }, inboxEntryDeleteAnimationDurationMs);

        return () => interval.clear();
    }, [hasDeletedAnimationState]);

    // Collect all items that we need to animate deletion of into a sorted array.
    // We will interleave this array in our virtualized list.
    const deletedItemAnimations = useMemo(() => {
        if (!deletedItemAnimationsState) return [];

        const deletedItemAnimations = [];

        for (const animation of [
            deletedItemAnimationsState.currentAnimation,
            ...deletedItemAnimationsState.queuedAnimations,
        ]) {
            if (animation.deletedItem.index < itemCount + 1) {
                deletedItemAnimations.push(animation);
            }
        }

        // Sort animations by the index they are replacing.
        deletedItemAnimations.sort((a, b) => a.deletedItem.index - b.deletedItem.index);

        return deletedItemAnimations;
    }, [deletedItemAnimationsState, itemCount]);

    const itemCountWithDeletedItemAnimations = itemCount + deletedItemAnimations.length;

    return (
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
                width="full"
                height="full"
                overflow="hidden"
            >
                <VirtualizedScrollView
                    ref={viewRef}
                    bufferedItemHeight={inboxEntryViewMinHeight}
                    onRenderedRangeChange={renderedRange => {
                        const view = assertExists(viewRef.current);
                        tryLoadingMore(view.getHeight(), renderedRange);
                    }}
                    itemCount={itemCountWithDeletedItemAnimations}
                    renderItem={useCallback(
                        index => {
                            const isFirstItem = index === 0;
                            const isLastItem = index === itemCountWithDeletedItemAnimations - 1;

                            let deletedItemAnimation = null;

                            for (const animation of deletedItemAnimations) {
                                if (index === animation.deletedItem.index) {
                                    return {
                                        key: `Loaded:${animation.deletedItem.item.key}`,
                                        minHeight: inboxEntryViewMinHeight,
                                        node: (
                                            <InboxEntryView
                                                entry={animation.deletedItem.item.model}
                                                isSelected={false}
                                                onPressStart={() => {}}
                                                isFirstEntry={isFirstItem}
                                                isLastEntry={isLastItem}
                                                deletedItemAnimation={
                                                    animation ===
                                                    deletedItemAnimationsState?.currentAnimation
                                                        ? animation
                                                        : deletedItemAnimation
                                                }
                                            />
                                        ),
                                    };
                                } else if (index > animation.deletedItem.index) {
                                    index--;

                                    if (
                                        animation === deletedItemAnimationsState?.currentAnimation
                                    ) {
                                        deletedItemAnimation = animation;
                                    }
                                }
                            }

                            const item = query.getItem(index);

                            switch (item.type) {
                                case "Loaded": {
                                    return {
                                        key: `Loaded:${item.item.key}`,
                                        minHeight: inboxEntryViewMinHeight,
                                        node: (
                                            <InboxEntryView
                                                entry={item.item.model}
                                                isSelected={selectedEntryKey === item.item.key}
                                                // We don't have a visual press state for items, so immediately
                                                // select the entry on press start to give the user some response.
                                                onPressStart={() => {
                                                    void selectEntry(item.item);
                                                }}
                                                isFirstEntry={isFirstItem}
                                                isLastEntry={isLastItem}
                                                aria-posinset={index}
                                                aria-setsize={ariaSetsize}
                                                deletedItemAnimation={deletedItemAnimation}
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
                                                style={{
                                                    height: inboxEntryViewMinHeight,
                                                }}
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
                        [
                            query,
                            deletedItemAnimations,
                            itemCountWithDeletedItemAnimations,
                            deletedItemAnimationsState?.currentAnimation,
                            selectedEntryKey,
                            ariaSetsize,
                            selectEntry,
                        ],
                    )}
                />
            </Box>
        </FocusRing>
    );
}

function InboxViewPeekContent({
    filter,
    peek,
    entry,
    deleteEntryOptimistically,
}: {
    filter: "New" | "Archive";
    peek: InboxViewPeek;
    entry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    deleteEntryOptimistically: Memo<
        ({
            promise,
            entry,
            withAnimation,
        }: {
            promise: Promise<unknown>;
            entry: DynamoGeneralRealtimeItem<InboxEntryModel>;
            withAnimation: boolean;
        }) => void
    >;
}) {
    const loaderDataRefResult = usePromise(peek.loaderDataRefPromise);

    const onCreateMessageOptimistically = useEvent((promise: Promise<unknown>) => {
        // We may not have an entry if the path in the URL is no longer in the inbox
        // entries query.
        if (!entry) return;

        // Only new entries implicitly dismiss on message creation.
        if (filter !== "New") return;

        let shouldImplicitlyDismissAfterCreateMessage;
        switch (entry.model.type) {
            case "Chat":
            case "PostComments":
            case "DocumentCommentThread":
                shouldImplicitlyDismissAfterCreateMessage = true;
                break;
            case "ChannelPosts":
            case "DocumentNewCommentThreads":
                shouldImplicitlyDismissAfterCreateMessage = false;
                break;
            default:
                throw exhaustive(entry.model);
        }

        // Only some entries implicitly dismiss after sending a message.
        if (!shouldImplicitlyDismissAfterCreateMessage) return;

        deleteEntryOptimistically({
            promise,
            entry,
            withAnimation: true,
        });
    });

    return (
        <Box width="full" height="full" overflow="hidden" display="flex" flexDirection="column">
            {!loaderDataRefResult.isPending ? (
                <InboxPeekContextProvider
                    onCreateMessageOptimistically={onCreateMessageOptimistically}
                >
                    <PeekRemixEmbed
                        peekId={peek.id}
                        withMobileLayout={false}
                        loaderDataRef={loaderDataRefResult.value}
                        history={peek.history}
                    />
                </InboxPeekContextProvider>
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
