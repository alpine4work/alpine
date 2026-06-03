import {SpinnerGap} from "phosphor-react";
import {useCallback, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {
    useArchiveInboxEntry,
    useUnarchiveInboxEntry,
} from "~/client/web/inbox/archive_inbox_entry_optimistically.js";
import {InboxEntryView} from "~/client/web/inbox/inbox_entry_view.js";
import {InboxViewEntriesEmpty} from "~/client/web/inbox/inbox_view_entries_empty.js";
import {useInboxDeletedItemAnimationState} from "~/client/web/inbox/internal/use_inbox_deleted_item_animation_state.js";
import {useInboxState} from "~/client/web/inbox/use_inbox_state.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {inboxEntryViewMinHeight} from "~/client/web/styles/inbox_shared_styles.js";
import {colorSchemeVars, spinAnimationClassName} from "~/client/web/styles/styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRef,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {addRemLengths, screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {RynamoIndexQueryResult, RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {InboxEntryStatus} from "~/shared/notifications/inbox_entry_status.js";
import {InboxEntryModel, getInboxEntryPath} from "~/shared/notifications/inbox_model.js";

export function InboxMobileView({
    filter,
    initialEntriesResult,
}: {
    filter: InboxEntryStatus;
    initialEntriesResult: RynamoIndexQueryResult<InboxEntryModel>;
}) {
    // This component only supports rendering on mobile platforms. Unlike
    // `<SearchMobileView>` where the `/s/:spaceId/search` route also renders the
    // mobile UI on desktop. On desktop the `/s/:spaceId/inbox` route renders
    // `<InboxView>`.
    assert(usePlatform() === "mobile");

    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const {
        query,
        tryLoadingMore,
        // Animations are important on mobile when swiping to archive an inbox entry.
        itemsDeletedByLastChangeForAnimation,
    } = useInboxState({
        filter,
        initialEntriesResult,
    });

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        title: filter === "New" ? "Inbox" : "Inbox (done)",
        withoutDisappearingTitle: true,
        titleJustifyContent: "center",
        // This is a route for a root tab in our mobile app so don't show the back button.
        // It wouldn't work.
        withoutMobileBackButton: true,
        menuActions: [
            [
                {
                    label: "New notifications",
                    isSelected: filter === "New",
                    pressErrorTitle: "Can\u2019t open new notifications",
                    onPress: async () => {
                        if (filter === "New") return;
                        await navigate(`/s/${space.id}/inbox`, {replace: true});
                    },
                },
                {
                    label: "Done notifications",
                    isSelected: filter === "Done",
                    pressErrorTitle: "Can\u2019t open done notifications",
                    onPress: async () => {
                        if (filter === "Done") return;
                        await navigate(`/s/${space.id}/inbox?tab=done`, {replace: true});
                    },
                },
            ],
        ],
    });

    const itemCount = query.getItemCount();

    const {deletedItemAnimationsState, deletedItemAnimations} = useInboxDeletedItemAnimationState({
        viewRef,
        itemCount,
        itemsDeletedByLastChangeForAnimation,
    });

    const itemCountWithDeletedItemAnimations = itemCount + deletedItemAnimations.length;

    const renderItem = useCallback(
        (index: number): VirtualizedScrollViewItem => {
            if (index === 0) {
                return {
                    key: "Header",
                    minHeight: addRemLengths(navigationBarHeight),
                    node: (
                        <>
                            <Box height="safe-area-inset-top" />
                            <Box height={navigationBarHeight} />
                            {itemCountWithDeletedItemAnimations === 0 && (
                                <Box style={{height: "50vh"}}>
                                    <InboxViewEntriesEmpty filter={filter} />
                                </Box>
                            )}
                        </>
                    ),
                };
            }

            index -= 1;

            const isFirstItem = index === 0;
            const isLastItem = index === itemCountWithDeletedItemAnimations - 1;

            let deletedItemAnimation = null;

            for (const animation of deletedItemAnimations) {
                if (index === animation.deletedItem.index) {
                    return {
                        key: `Loaded:${animation.deletedItem.item.key}`,
                        minHeight: inboxEntryViewMinHeight,
                        node: (
                            <>
                                <InboxMobileEntryView
                                    filter={filter}
                                    entry={animation.deletedItem.item}
                                    isFirstItem={isFirstItem}
                                    isLastItem={isLastItem}
                                    deletedItemAnimation={deletedItemAnimation}
                                />
                                {isLastItem && <Box height="safe-area-inset-bottom" />}
                            </>
                        ),
                    };
                } else if (index > animation.deletedItem.index) {
                    index--;

                    if (
                        animation === deletedItemAnimationsState.activeAnimations?.currentAnimation
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
                            <>
                                <InboxMobileEntryView
                                    filter={filter}
                                    entry={item.item}
                                    isFirstItem={isFirstItem}
                                    isLastItem={isLastItem}
                                    deletedItemAnimation={deletedItemAnimation}
                                />
                                {isLastItem && <Box height="safe-area-inset-bottom" />}
                            </>
                        ),
                    };
                }
                case "LoadingIndicator": {
                    return {
                        key: "LoadingIndicator",
                        minHeight: inboxEntryViewMinHeight,
                        node: (
                            <>
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
                                {isLastItem && <Box height="safe-area-inset-bottom" />}
                            </>
                        ),
                    };
                }
                default:
                    throw exhaustive(item);
            }
        },
        [
            deletedItemAnimations,
            deletedItemAnimationsState.activeAnimations?.currentAnimation,
            filter,
            itemCountWithDeletedItemAnimations,
            query,
        ],
    );

    return (
        <VirtualizedScrollView
            ref={viewRef}
            elementRef={scrollViewRef}
            scrollbarInsetTop={scrollbarInsetTop}
            extraChildren={navigationBar}
            itemCount={1 + itemCountWithDeletedItemAnimations}
            bufferedItemHeight={inboxEntryViewMinHeight}
            renderItem={renderItem}
            onRenderedRangeChange={renderedRange => {
                const view = assertExists(viewRef.current);

                // Shift the rendered range back 1 to exclude the header item.
                let shiftedRenderedRange: typeof renderedRange;
                if (!renderedRange) {
                    return null;
                } else {
                    const startIndex = renderedRange.startIndex - 1;
                    const endIndex = renderedRange.endIndex - 1;
                    if (endIndex < 0) {
                        shiftedRenderedRange = null;
                    } else {
                        shiftedRenderedRange = {
                            startIndex: Math.max(0, startIndex),
                            endIndex,
                        };
                    }
                }

                tryLoadingMore(view.getHeight(), shiftedRenderedRange);
            }}
            extraChildrenOutsideContentElement={({contentHeight}) => (
                // Our items all have a bottom border. This is good when there's less content than
                // room to scroll since it creates a clear shape for the last item in the list.
                //
                // However, if there are enough items to scroll then when the user has fully
                // scrolled we want the last item to _not_ have a border bottom since the bottom of
                // the screen creates that boundary. We don't need to render an extra line in the
                // margins.
                //
                // This div covers the bottom border of the last item but only when there's enough
                // content to scroll. Otherwise the bottom border needs to be visible to visually
                // contain the last item. To debug this it's helpful to switch the
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
                        height="1"
                        backgroundColor="grey-0"
                        style={{bottom: "var(--safe-area-inset-bottom, 0px)"}}
                    />
                </Box>
            )}
        />
    );
}

function InboxMobileEntryView({
    filter,
    entry,
    isFirstItem,
    isLastItem,
    deletedItemAnimation,
}: {
    filter: InboxEntryStatus;
    entry: RynamoItem<InboxEntryModel>;
    isFirstItem: boolean;
    isLastItem: boolean;
    deletedItemAnimation: {
        offset: number;
        deletedItem: {item: RynamoItem<InboxEntryModel>};
    } | null;
}) {
    const navigate = useNavigate();
    const archiveInboxEntry = useArchiveInboxEntry();
    const unarchiveInboxEntry = useUnarchiveInboxEntry();

    const [isPending, setIsPending] = useState(false);

    return (
        <InboxEntryView
            paddingX={screenPaddingX}
            marginX="0"
            filter={filter}
            entry={entry.model}
            onPress={() => {
                if (isPending) return;
                setIsPending(true);

                navigate(getInboxEntryPath(entry.model, "narrow")).finally(() => {
                    setIsPending(false);
                });
            }}
            withBorderTop={isFirstItem}
            withMarginBottom={isLastItem}
            withBackgroundIfPressed={true}
            deletedItemAnimation={deletedItemAnimation}
            onArchive={({withAnimation}) => {
                archiveInboxEntry({
                    entry,
                    withAnimation,
                });
            }}
            onUnarchive={() => {
                unarchiveInboxEntry({
                    entry,
                    withAnimation: false,
                });
            }}
        />
    );
}
