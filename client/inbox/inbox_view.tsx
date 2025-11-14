import {HydrationState} from "@remix-run/router";
import {SpinnerGap} from "phosphor-react";
import {Memo, useCallback, useEffect, useMemo, useRef} from "react";
import {ContentBlockWidthContextProvider} from "~/client/content/content_block_width.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {DynamoGeneralRealtimeIndexQuery} from "~/client/dynamo/dynamo_general_realtime_index_query.js";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element.js";
import {isModifiedKeyboardEvent} from "~/client/helpers/events/is_modified_keyboard_event.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {
    useArchiveInboxEntry,
    useUnarchiveInboxEntry,
} from "~/client/inbox/archive_inbox_entry_optimistically.js";
import {InboxContextProvider} from "~/client/inbox/inbox_context_provider.js";
import {InboxContextNavigation} from "~/client/inbox/inbox_context_types.js";
import {InboxEntryView, inboxEntryWidth} from "~/client/inbox/inbox_entry_view.js";
import {InboxViewEntriesEmpty} from "~/client/inbox/inbox_view_entries_empty.js";
import {InboxViewTopBar} from "~/client/inbox/inbox_view_top_bar.js";
import {useInboxDeletedItemAnimationState} from "~/client/inbox/internal/use_inbox_deleted_item_animation_state.js";
import {useInboxState} from "~/client/inbox/use_inbox_state.js";
import {PeekRemixEmbed} from "~/client/peek/peek_remix_embed.js";
import {PeekRemixEmbedRouter} from "~/client/peek/peek_remix_embed_router.js";
import {
    PeekSwitcherStatePeekBase,
    usePeekSwitcherState,
} from "~/client/peek/use_peek_switcher_state.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {inboxBannerHeight, inboxEntryViewMinHeight} from "~/client/styles/inbox_shared_styles.js";
import {colorSchemeVars, spinAnimationClassName} from "~/client/styles/styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoIndexCursor, DynamoItemKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Result} from "~/shared/helpers/control/result.js";
import {PeekId} from "~/shared/id/types/id_types.js";
import {InboxEntryModel, getInboxEntryPath} from "~/shared/notifications/inbox_model.js";

export function InboxView({
    filter,
    initialEntriesResult,
    initialPeekData,
    onPeekChange,
}: {
    filter: "New" | "Archive";
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>;
    initialPeekData: {spacePath: string; hydrationData: HydrationState} | null;
    onPeekChange: (peek: PeekSwitcherStatePeekBase<{key: DynamoItemKey | null}> | null) => void;
}) {
    const routeLayout = useRouteLayout();

    const {query, tryLoadingMore, itemsDeletedByLastChangeForAnimation} = useInboxState({
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
    const findItemKeyForSpacePathIfExists = useCallback(
        (spacePath: string): DynamoItemKey | null => {
            const itemCount = query.getItemCount();
            for (let i = 0; i < itemCount; i++) {
                const item = query.getItem(i);
                if (item.type === "Loaded") {
                    if (getInboxEntryPath(item.item.model, routeLayout) === spacePath) {
                        return item.item.key;
                    }
                }
            }
            return null;
        },
        [query, routeLayout],
    );

    const {selectedPeek, activePeek, switchPeek} = usePeekSwitcherState<{
        key: DynamoItemKey | null;
    }>({
        initialPeekData: () => {
            if (!initialPeekData) return null;

            return {
                spacePath: initialPeekData.spacePath,
                hydrationData: initialPeekData.hydrationData,
                extra: {key: findItemKeyForSpacePathIfExists(initialPeekData.spacePath)},
            };
        },
    });

    // If we don't know the item key for our peek, try searching the query whenever
    // we load new data to see if an item was loaded that matches our peek's path.
    //
    // This will happen when we server-side render a peek who's item is not
    // included in the initial set of inbox entries.
    useEffect(() => {
        if (activePeek && !activePeek.extra.key) {
            const key = findItemKeyForSpacePathIfExists(activePeek.initialSpacePath);

            if (key) {
                activePeek.setExtra({key});
            }
        }
    }, [activePeek, findItemKeyForSpacePathIfExists]);

    const activeEntry = useMemo(
        () => (activePeek?.extra.key ? query.getItemByKeyIfExists(activePeek.extra.key) : null),
        [activePeek?.extra.key, query],
    );

    const selectedEntryKey = selectedPeek?.extra.key ?? null;

    const selectedEntry = useMemo(
        () => (selectedEntryKey ? query.getItemByKeyIfExists(selectedEntryKey) : null),
        [query, selectedEntryKey],
    );

    // Whenever a new entry is selected we want to call our `onPeekChange()`
    // callback which changes the URL.
    const lastSelectedEntryKeyRef = useRef(selectedEntryKey ?? null);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (lastSelectedEntryKeyRef.current === selectedEntryKey) return;
        lastSelectedEntryKeyRef.current = selectedEntryKey ?? null;

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

    const selectEntry = useCallback(
        (entry: DynamoGeneralRealtimeItem<InboxEntryModel> | null): Promise<void> => {
            if (!entry) {
                return switchPeek(null);
            }

            // Don't select the same entry twice in a row since that would cause two
            // data fetches.
            if (selectedEntryKey === entry.key) return Promise.resolve();

            return switchPeek({
                spacePath: getInboxEntryPath(entry.model, routeLayout),
                extra: {key: entry.key},
            });
        },
        [routeLayout, selectedEntryKey, switchPeek],
    );

    const navigation = useMemo(
        (): InboxContextNavigation => ({filter, nextEntry, previousEntry, selectEntry}),
        [filter, nextEntry, previousEntry, selectEntry],
    );

    return (
        <GlobalKeyDownEvent
            onGlobalKeyDown={event => {
                switch (event.key) {
                    case "ArrowUp": {
                        // Ignore modified arrow up/down events like cmd-up which scrolls.
                        if (isModifiedKeyboardEvent(event)) break;

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
                        // Ignore modified arrow up/down events like cmd-down which scrolls.
                        if (isModifiedKeyboardEvent(event)) break;

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
            <Box flexGrow="1" overflow="hidden" display="flex">
                <Box
                    flexShrink="0"
                    width={inboxEntryWidth}
                    overflow="hidden"
                    backgroundColor="grey-0"
                    borderLeft="grey-5"
                    borderRight="grey-5"
                >
                    <InboxViewTopBar filter={filter} />
                    {query.getItemCount() === 0 ? (
                        <InboxViewEntriesEmpty filter={filter} />
                    ) : (
                        <InboxViewEntries
                            filter={filter}
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
                        <Box position="relative" flexGrow="1" overflow="hidden">
                            {activePeek && (
                                <InboxContextProvider
                                    entry={activeEntry?.item ?? null}
                                    navigation={navigation}
                                >
                                    <InboxViewPeekContent
                                        // Fully remount whenever the peek changes...
                                        key={activePeek.id}
                                        peekId={activePeek.id}
                                        routerResult={activePeek.routerResult}
                                    />
                                </InboxContextProvider>
                            )}
                        </Box>
                    ),
                    [activeEntry?.item, activePeek, navigation],
                )}
            </Box>
        </GlobalKeyDownEvent>
    );
}

function InboxViewEntries({
    filter,
    query,
    tryLoadingMore,
    itemsDeletedByLastChangeForAnimation,
    selectedEntryKey,
    selectEntry,
}: {
    filter: "New" | "Archive";
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
    selectEntry: Memo<(entry: DynamoGeneralRealtimeItem<InboxEntryModel>) => Promise<void>>;
}) {
    const archiveInboxEntry = useArchiveInboxEntry();
    const unarchiveInboxEntry = useUnarchiveInboxEntry();

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

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

    const lastSelectedEntryKeyRef = useRef(selectedEntryKey);
    useLayoutEffectWithoutServerSideWarning(() => {
        const view = assertExists(viewRef.current);

        if (lastSelectedEntryKeyRef.current === selectedEntryKey) return;
        lastSelectedEntryKeyRef.current = selectedEntryKey ?? null;

        // When a new entry is selected, make sure it is visible in our scroll window. Scroll to
        // it if it is not visible.
        if (selectedEntryKey) {
            view.scrollToKeyIfExists(`Loaded:${selectedEntryKey}`, {withAnchor: true});
        }
    }, [selectedEntryKey]);

    const {deletedItemAnimationsState, deletedItemAnimations} = useInboxDeletedItemAnimationState({
        viewRef,
        itemCount,
        itemsDeletedByLastChangeForAnimation,
    });

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
                style={{
                    height: `calc(100% - ${spacing[inboxBannerHeight]})`,
                }}
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
                                                filter={filter}
                                                entry={animation.deletedItem.item.model}
                                                isSelected={false}
                                                onPressStart={() => {}}
                                                withMarginTop={isFirstItem}
                                                withMarginBottom={isLastItem}
                                                withBorderTop={isFirstItem}
                                                deletedItemAnimation={
                                                    animation ===
                                                    deletedItemAnimationsState.activeAnimations
                                                        ?.currentAnimation
                                                        ? animation
                                                        : deletedItemAnimation
                                                }
                                                onArchive={() => {
                                                    // Ignore archive/unarchive interactions in deleted items
                                                }}
                                                onUnarchive={() => {
                                                    // Ignore archive/unarchive interactions in deleted items
                                                }}
                                            />
                                        ),
                                    };
                                } else if (index > animation.deletedItem.index) {
                                    index--;

                                    if (
                                        animation ===
                                        deletedItemAnimationsState.activeAnimations
                                            ?.currentAnimation
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
                                                filter={filter}
                                                entry={item.item.model}
                                                isSelected={selectedEntryKey === item.item.key}
                                                // We use `onPressStart` to select so the selected style is applied immediately.
                                                // We use the selected style to indicate interaction to the user instead of an
                                                // `isPressed` style. The benefit of using selection is the previous item loses
                                                // its style.
                                                onPressStart={() => {
                                                    void selectEntry(item.item);
                                                }}
                                                withMarginTop={isFirstItem}
                                                withMarginBottom={isLastItem}
                                                withBorderTop={isFirstItem}
                                                aria-posinset={index}
                                                aria-setsize={ariaSetsize}
                                                deletedItemAnimation={deletedItemAnimation}
                                                onArchive={async ({withAnimation}) => {
                                                    archiveInboxEntry({
                                                        entry: item.item,
                                                        withAnimation,
                                                    });

                                                    // If we are archiving the select entry then navigate the user to the
                                                    // next entry.
                                                    if (selectedEntryKey === item.item.key) {
                                                        const nextEntry =
                                                            index + 1 < query.getItemCount()
                                                                ? query.getItem(index + 1)
                                                                : null;

                                                        if (nextEntry?.type === "Loaded") {
                                                            await selectEntry(nextEntry.item);
                                                        } else {
                                                            const previousEntry =
                                                                index - 1 >= 0
                                                                    ? query.getItem(index - 1)
                                                                    : null;

                                                            if (previousEntry?.type === "Loaded") {
                                                                await selectEntry(
                                                                    previousEntry.item,
                                                                );
                                                            }
                                                        }
                                                    }
                                                }}
                                                onUnarchive={async () => {
                                                    unarchiveInboxEntry({
                                                        entry: item.item,
                                                        withAnimation: false,
                                                    });

                                                    // If we are unarchiving the select entry then navigate the user to the
                                                    // next entry.
                                                    if (selectedEntryKey === item.item.key) {
                                                        const nextEntry =
                                                            index + 1 < query.getItemCount()
                                                                ? query.getItem(index + 1)
                                                                : null;

                                                        if (nextEntry?.type === "Loaded") {
                                                            await selectEntry(nextEntry.item);
                                                        } else {
                                                            const previousEntry =
                                                                index - 1 >= 0
                                                                    ? query.getItem(index - 1)
                                                                    : null;

                                                            if (previousEntry?.type === "Loaded") {
                                                                await selectEntry(
                                                                    previousEntry.item,
                                                                );
                                                            }
                                                        }
                                                    }
                                                }}
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
                            itemCountWithDeletedItemAnimations,
                            query,
                            deletedItemAnimations,
                            filter,
                            deletedItemAnimationsState.activeAnimations?.currentAnimation,
                            archiveInboxEntry,
                            unarchiveInboxEntry,
                            selectedEntryKey,
                            ariaSetsize,
                            selectEntry,
                        ],
                    )}
                    extraChildrenOutsideContentElement={({contentHeight}) => (
                        // Our items all have a bottom border. This is good when there's less content
                        // than room to scroll since it creates a clear shape for the last item in the
                        // list.
                        //
                        // However, if there are enough items to scroll then when the user has fully
                        // scrolled we want the last item to *not* have a border bottom since the
                        // bottom of the screen creates that boundary. We don't need to render an extra
                        // line in the margins.
                        //
                        // This div covers the bottom border of the last item but only when there's
                        // enough content to scroll. Otherwise the bottom border needs to be visible to
                        // visually contain the last item. To debug this it's helpful to switch the
                        // `backgroundColor` to `red-30` or something similar.
                        <Box
                            position="absolute"
                            left="0"
                            right="0"
                            top="0"
                            style={{height: `max(100%, ${contentHeight}px)`}}
                        >
                            <Box
                                position="absolute"
                                left="0"
                                right="0"
                                bottom="0"
                                height="1"
                                backgroundColor="grey-0"
                            />
                        </Box>
                    )}
                />
            </Box>
        </FocusRing>
    );
}

function InboxViewPeekContent({
    peekId,
    routerResult,
}: {
    peekId: PeekId;
    routerResult: Result<PeekRemixEmbedRouter>;
}) {
    if (!routerResult.ok) throw routerResult.error;
    const router = routerResult.value;

    return (
        <Box width="full" height="full" overflow="hidden" display="flex" flexDirection="column">
            <ContentBlockWidthContextProvider
                keepAssumedPadding={true}
                paddingLeft={inboxEntryWidth}
            >
                <PeekRemixEmbed peekId={peekId} layout="wide" router={router} />
            </ContentBlockWidthContextProvider>
        </Box>
    );
}
