import {SpinnerGap} from "phosphor-react";
import {useCallback, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {navigationBarHeight, useNavigationBar} from "~/client/design/navigation_bar.js";
import {InboxEntryView} from "~/client/inbox/inbox_entry_view.js";
import {InboxViewEntriesEmpty} from "~/client/inbox/inbox_view_entries_empty.js";
import {
    useArchiveInboxEntry,
    useUnarchiveInboxEntry,
} from "~/client/inbox/use_archive_inbox_entry.js";
import {useInboxState} from "~/client/inbox/use_inbox_state.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {addRemLengths, screenPaddingX, spacing} from "~/shared/design/spacing.js";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {inboxEntryViewMinHeight} from "~/shared/styles/inbox_shared_styles.js";
import {colorSchemeVars, spinAnimationClassName} from "~/shared/styles/styles.js";

// NOCOMMIT: Old filtered inbox
// NOCOMMIT: Swipe to mark notification as done

export function InboxMobileView({
    filter,
    initialEntriesResult,
}: {
    filter: "New" | "Archive";
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>;
}) {
    // This component only supports rendering on mobile platforms. Unlike
    // `<SearchMobileView>` where the `/s/:spaceId/search` route also renders the
    // mobile UI on desktop. On desktop the `/s/:spaceId/inbox` route renders
    // `<InboxView>`.
    assert(useIsMobile());

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const {query, tryLoadingMore} = useInboxState({
        filter,
        initialEntriesResult,
        withoutAnimation: true,
    });

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        withMobileLayout: true,
        title: "Inbox",
        withoutDisappearingTitle: true,
        titleJustifyContents: "center",
        // This is a route for a root tab in our mobile app so don't show the back
        // button. It wouldn't work.
        withoutMobileBackButton: true,
    });

    const renderItem = useCallback(
        (index: number): VirtualizedScrollViewItem => {
            if (index === 0) {
                return {
                    key: "Header",
                    minHeight: addRemLengths(spacing[navigationBarHeight.mobile]),
                    node: (
                        <>
                            <Box height="safe-area-inset-top" />
                            <Box height={navigationBarHeight} />
                            <Box style={{height: "50vh"}}>
                                {query.getItemCount() === 0 && (
                                    <InboxViewEntriesEmpty filter={filter} />
                                )}
                            </Box>
                        </>
                    ),
                };
            }

            index -= 1;

            const item = query.getItem(index);

            const isFirstItem = index === 0;
            const isLastItem = index === query.getItemCount() - 1;

            switch (item.type) {
                case "Loaded": {
                    return {
                        key: `Loaded:${item.item.key}`,
                        minHeight: inboxEntryViewMinHeight,
                        node: (
                            <InboxMobileEntryView
                                filter={filter}
                                entry={item.item}
                                isFirstItem={isFirstItem}
                                isLastItem={isLastItem}
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
        [filter, query],
    );

    return (
        <VirtualizedScrollView
            ref={viewRef}
            elementRef={scrollViewRef}
            scrollbarInsetTop={scrollbarInsetTop}
            extraChildren={navigationBar}
            itemCount={1 + query.getItemCount()}
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
}: {
    filter: "New" | "Archive";
    entry: DynamoGeneralRealtimeItem<InboxEntryModel>;
    isFirstItem: boolean;
    isLastItem: boolean;
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

                const url = new URL(entry.model.getPath(), window.location.href);
                url.searchParams.set("inbox", "show");

                // TODO(calebmer, #global-loading-indicator): Some kind of global loading
                // indicator?
                navigate({
                    pathname: url.pathname,
                    search: url.search,
                    hash: url.hash,
                }).finally(() => {
                    setIsPending(false);
                });
            }}
            withBorderTop={isFirstItem}
            withMarginBottom={isLastItem}
            withBackgroundIfPressed={true}
            onArchive={() => {
                archiveInboxEntry({
                    entry,
                    withAnimation: false,
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
