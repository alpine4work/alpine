import {RemixEntryContext} from "@remix-run/react";
import {MemoryHistory, createMemoryHistory, createPath} from "history";
import {SpinnerGap} from "phosphor-react";
import {
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
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies";
import {usePromise} from "~/client/helpers/use_promise";
import {
    InboxEntryView,
    inboxEntryAnimationDurationMs,
    inboxEntryViewMinHeight,
    inboxEntryWidth,
} from "~/client/inbox/inbox_entry_view";
import {useInboxState} from "~/client/inbox/use_inbox_state";
import {loadInitialPeekDataForClient} from "~/client/peek/load_initial_peek_data_for_client";
import {
    convertPeekPathToSpacePath,
    convertSpacePathToPeekPath,
} from "~/client/peek/peek_path_helpers";
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
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {generateId} from "~/shared/id/id";
import {PeekId} from "~/shared/id/types/id_types";
import {InboxEntryModel} from "~/shared/models/inbox_model";
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
    const remPx = useRemPx();

    const entriesViewRef = useRef<VirtualizedScrollViewRef>(null);

    const {query, itemsDeletedByLastChange, tryLoadingMore} = useInboxState({
        initialEntriesResult,
    });

    // Whenever our query data changes, try loading more entries. In case our
    // rendered range stayed the same but we now see the loading indicator.
    //
    // This effect should also fire when `tryLoadingMore()` completes in case it
    // didn't fully load the query.
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        query;

        const view = assertExists(entriesViewRef.current);
        tryLoadingMore(view.getHeight(), view.getRenderedRange());
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
    const selectedEntryKey = selectedPeek?.key ?? null;

    // Whenever a new entry is selected:
    //
    // 1. We want to scroll to that entry
    // 2. We want to call our `onPeekChange()` callback which changes the URL
    const lastSelectedEntryKeyRef = useRef(selectedEntryKey);
    useLayoutEffectWithoutServerSideWarning(() => {
        const entriesView = assertExists(entriesViewRef.current);

        if (lastSelectedEntryKeyRef.current === selectedPeek?.key) return;
        lastSelectedEntryKeyRef.current = selectedPeek?.key ?? null;

        if (!selectedPeek) {
            onPeekChange(null);
        } else {
            // When a new entry is selected, make sure it is visible in our scroll window. Scroll to
            // it if it is not visible.
            if (selectedPeek.key) entriesView.scrollToKeyIfExists(`Loaded:${selectedPeek.key}`);

            onPeekChange(selectedPeek);
        }
    }, [onPeekChange, selectedEntryKey, selectedPeek]);

    // Remember the last cursor of our selected item. We use this when the user
    // presses up and down to figure out what the next entry to go to is.
    const selectedEntryCursorRef = useRef<{
        key: DynamoItemKey;
        cursor: DynamoIndexCursor | null;
    } | null>(null);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!selectedEntryKey) {
            selectedEntryCursorRef.current = null;
            return;
        }

        if (
            !selectedEntryCursorRef.current ||
            selectedEntryCursorRef.current.key !== selectedEntryKey
        ) {
            selectedEntryCursorRef.current = {
                key: selectedEntryKey,
                cursor: null,
            };
        }

        // Only update the cursor if we have it. If the item was removed from `query`,
        // we want to keep the last cursor we saw for the entry key.
        const cursor = query.getItemByKeyIfExists(selectedEntryKey)?.cursor;
        if (cursor) selectedEntryCursorRef.current.cursor = cursor;
    }, [query, selectedEntryKey]);

    // When an item is deleted, we start an animation to shift entries below the
    // deleted item up to fill its space. This helps users see an item was removed
    // and what happens next.
    const [animationState, setAnimationState] = useStateWithDependencies(
        itemsDeletedByLastChange => {
            if (itemsDeletedByLastChange.length === 0) return null;
            const {cursor, item} = itemsDeletedByLastChange[0]!;

            // We should still have the height of the deleted item in
            // `VirtualizedScrollViewRef` since the render hasn't finished and unmounted
            // the element yet.
            const offset =
                entriesViewRef.current?.getPositionByKeyIfExists(`Loaded:${item.key}`)?.height ??
                convertRemLengthToPx(inboxEntryViewMinHeight, remPx);

            return {
                afterCursor: cursor,
                offset,
            };
        },
        [itemsDeletedByLastChange],
    );

    useEffect(() => {
        if (!animationState) return;

        const timeout = createTimeout(() => {
            setAnimationState(null);
        }, inboxEntryAnimationDurationMs);

        return () => timeout.clear();
    }, [animationState, setAnimationState]);

    const itemCount = query.getItemCount();

    // We use this to help assistive technologies understand our list
    // virtualization. If we haven't loaded all items we set the size to -1 which
    // indicates the size is unknown.
    // https://w3c.github.io/aria/#aria-setsize
    const ariaSetsize = query.getItemCountWithoutLoadingIndicator() === itemCount ? itemCount : -1;

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
                        if (selectedEntryCursorRef.current?.cursor) {
                            const previousEntry = query.getItemBeforeCursorIfExists(
                                selectedEntryCursorRef.current.cursor,
                            );
                            if (previousEntry) {
                                selectEntry(previousEntry);
                            }
                        } else if (query.getItemCount() > 0) {
                            const item = query.getItem(0);
                            if (item.type === "Loaded") {
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
                        if (selectedEntryCursorRef.current?.cursor) {
                            const nextEntry = query.getItemAfterCursorIfExists(
                                selectedEntryCursorRef.current.cursor,
                            );
                            if (nextEntry) {
                                selectEntry(nextEntry);
                            }
                        } else if (query.getItemCount() > 0) {
                            const item = query.getItem(0);
                            if (item.type === "Loaded") {
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
                        width={inboxEntryWidth}
                        backgroundColor="grey-0"
                        borderRight="grey-10"
                    >
                        <VirtualizedScrollView
                            ref={entriesViewRef}
                            bufferedItemHeight={inboxEntryViewMinHeight}
                            onRenderedRangeChange={renderedRange => {
                                const view = assertExists(entriesViewRef.current);
                                tryLoadingMore(view.getHeight(), renderedRange);
                            }}
                            itemCount={itemCount}
                            renderItem={useCallback(
                                index => {
                                    const item = query.getItem(index);
                                    switch (item.type) {
                                        case "Loaded": {
                                            return {
                                                key: `Loaded:${item.item.key}`,
                                                minHeight: inboxEntryViewMinHeight,
                                                node: (
                                                    <InboxEntryView
                                                        entry={item.item.model}
                                                        isSelected={
                                                            selectedEntryKey === item.item.key
                                                        }
                                                        // Select entry when the press starts so we only highlight one item
                                                        // at a time. Instead of highlighting both the pressed item and last
                                                        // selected item.
                                                        onPressStart={() => selectEntry(item.item)}
                                                        isFirstEntry={index === 0}
                                                        isLastEntry={index === itemCount - 1}
                                                        aria-posinset={index}
                                                        aria-setsize={ariaSetsize}
                                                        animationState={
                                                            animationState &&
                                                            animationState.afterCursor < item.cursor
                                                                ? animationState
                                                                : null
                                                        }
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
                                [
                                    animationState,
                                    ariaSetsize,
                                    itemCount,
                                    query,
                                    selectEntry,
                                    selectedEntryKey,
                                ],
                            )}
                        />
                    </Box>
                </FocusRing>
                {useMemo(
                    () => (
                        <Box flexGrow="1" overflow="hidden">
                            {peekState.activePeek && (
                                <InboxViewPeekContent
                                    // Fully remount whenever the peek changes...
                                    key={peekState.activePeek.key}
                                    peek={peekState.activePeek}
                                />
                            )}
                        </Box>
                    ),
                    [peekState.activePeek],
                )}
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
