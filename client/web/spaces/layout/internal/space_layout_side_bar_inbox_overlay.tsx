import {ArrowUpRight, SpinnerGap} from "phosphor-react";
import {
    Memo,
    Ref,
    RefObject,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {RynamoIndexQuery} from "~/client/web/dynamo/rynamo_index_query.js";
import {usePromise} from "~/client/web/helpers/use_promise.js";
import {
    useArchiveInboxEntry,
    useUnarchiveInboxEntry,
} from "~/client/web/inbox/archive_inbox_entry_optimistically.js";
import {InboxEntryView} from "~/client/web/inbox/inbox_entry_view.js";
import {InboxViewEntriesEmpty} from "~/client/web/inbox/inbox_view_entries_empty.js";
import {InboxViewTopBarModeToggleButton} from "~/client/web/inbox/inbox_view_top_bar_mode_toggle_button.js";
import {useInboxState} from "~/client/web/inbox/use_inbox_state.js";
import {usePeekStackContext} from "~/client/web/peek/peek_stack_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {InboxEntryShimmer} from "~/client/web/shimmer/inbox_entry_shimmer.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {inboxEntryViewMinHeight} from "~/client/web/styles/inbox_shared_styles.js";
import {colorSchemeVars, inboxStyles, spinAnimationClassName} from "~/client/web/styles/styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {RynamoIndexQueryResult, RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {InboxEntryStatus} from "~/shared/notifications/inbox_entry_status.js";
import {
    InboxEntryModel,
    getEncodedInboxEntryPath,
    getInboxEntryPath,
} from "~/shared/notifications/inbox_model.js";

const spaceLayoutSideBarInboxOverlayHeaderHeight: Spacing = "9";

export const spaceLayoutSideBarInboxOverlayHeight: Spacing = "128";

export function SpaceLayoutSideBarInboxOverlay({
    filter,
    initialEntriesResultPromise,
    onNewPress,
    onArchivePress,
    onClose,
}: {
    filter: InboxEntryStatus;
    initialEntriesResultPromise: PromiseImmediate<RynamoIndexQueryResult<InboxEntryModel>>;
    onNewPress: () => MaybePromise<void>;
    onArchivePress: () => MaybePromise<void>;
    onClose: Memo<() => void>;
}) {
    const entriesRef = useRef<SpaceLayoutTopBarInboxOverlayEntriesRef>(null);

    const initialEntriesResult = usePromise(initialEntriesResultPromise);

    return (
        <>
            <Box
                data-testid="SpaceLayoutSideBarInboxOverlay"
                flexShrink="0"
                height={spaceLayoutSideBarInboxOverlayHeaderHeight}
                display="flex"
                alignItems="center"
                paddingX="1.5"
            >
                <SpaceLayoutSideBarInboxOverlayExpandButton
                    filter={filter}
                    withoutAnimation={
                        initialEntriesResult.isPending ||
                        initialEntriesResult.value.items.length <= 3
                    }
                    entriesRef={entriesRef}
                    onClose={onClose}
                />
                <Box flexGrow="1" />
                <Box flexShrink="0">
                    <InboxViewTopBarModeToggleButton
                        filter={filter}
                        onNewPress={onNewPress}
                        onArchivePress={onArchivePress}
                    />
                </Box>
            </Box>
            {initialEntriesResult.isPending ? (
                <Box flexGrow="1" width="full" height="full" overflow="hidden" paddingY="1">
                    <InboxEntryShimmer titleRagRight="0" subtitleRagRight="8" />
                    <InboxEntryShimmer titleRagRight="6" subtitleRagRight="4" />
                    <InboxEntryShimmer titleRagRight="4" subtitleRagRight="6" />
                    <InboxEntryShimmer titleRagRight="0" subtitleRagRight="2" />
                    <InboxEntryShimmer titleRagRight="6" subtitleRagRight="4" />
                </Box>
            ) : (
                <SpaceLayoutTopBarInboxOverlayEntries
                    ref={entriesRef}
                    filter={filter}
                    initialEntriesResult={initialEntriesResult.value}
                    onClose={onClose}
                />
            )}
        </>
    );
}

function SpaceLayoutSideBarInboxOverlayExpandButton({
    filter,
    withoutAnimation,
    entriesRef,
    onClose,
}: {
    filter: InboxEntryStatus;
    withoutAnimation: boolean;
    entriesRef: RefObject<SpaceLayoutTopBarInboxOverlayEntriesRef | null>;
    onClose: () => void;
}) {
    const rootNavigate = useRootNavigate();
    const {space} = useSpaceContext();

    const [withAnimation, setWithAnimation] = useState(false);

    // Keep re-applying the animation CSS class so the user notices the inbox arrow
    // bounce encouraging them to open the fullscreen inbox. We believe the fullscreen
    // inbox is a better UX when managing many notifications. If the user is spending a
    // lot of time in the overlay when they have many notifications, we hope the
    // animation will subtly prompt them into opening the fullscreen inbox.
    useEffect(() => {
        if (withoutAnimation) {
            setWithAnimation(false);
            return;
        }

        if (!withAnimation) {
            const timeout = createTimeout(() => {
                setWithAnimation(true);
            }, inboxStyles.overlayArrowUpRightAnimationDelay);

            return () => {
                timeout.clear();
            };
        } else {
            const timeout = createTimeout(() => {
                setWithAnimation(false);
            }, inboxStyles.overlayArrowUpRightAnimationDuration);

            return () => {
                timeout.clear();
            };
        }
    }, [withAnimation, withoutAnimation]);

    return (
        <Button
            height="6"
            paddingX="1.5"
            fontSize="100"
            // The inbox will show a loading shimmer when it opens. We don't need to also show
            // a loading indicator here.
            withoutLoadingIndicator
            iconGap="0.5"
            iconPlacement="end"
            icon={
                <ArrowUpRight
                    className={
                        withAnimation
                            ? inboxStyles.overlayArrowUpRightAnimationClassName
                            : undefined
                    }
                    size={spacing["3"]}
                    weight="bold"
                    style={{
                        position: "relative",
                        top: "0.09375rem",
                    }}
                />
            }
            pressErrorTitle="Couldn&#x2019;t open inbox"
            onPress={async () => {
                const searchParams = new URLSearchParams();

                if (filter === "Done") {
                    searchParams.set("tab", "done");
                }

                // Optimization: Since we know the first inbox entry we can include it in the URL
                // so our backend can load data it in parallel.
                const firstItem = entriesRef.current?.getFirstItemIfExists();
                if (firstItem) {
                    searchParams.set("selected", getEncodedInboxEntryPath(firstItem.model, "wide"));
                }
                await rootNavigate(
                    `/s/${space.id}/inbox${
                        searchParams.size > 0 ? `?${searchParams.toString()}` : ""
                    }`,
                ).then(onClose);
            }}
        >
            <Box display="inline" fontStyle="semi-bold">
                Inbox
            </Box>
        </Button>
    );
}

type SpaceLayoutTopBarInboxOverlayEntriesRef = {
    getFirstItemIfExists(): RynamoItem<InboxEntryModel> | null;
};

const SpaceLayoutTopBarInboxOverlayEntries = forwardRef(
    function SpaceLayoutTopBarInboxOverlayEntries(
        {
            filter,
            initialEntriesResult,
            onClose,
        }: {
            filter: InboxEntryStatus;
            initialEntriesResult: RynamoIndexQueryResult<InboxEntryModel>;
            onClose: Memo<() => void>;
        },
        ref: Ref<SpaceLayoutTopBarInboxOverlayEntriesRef>,
    ) {
        const {query, tryLoadingMore} = useInboxState({
            filter,
            initialEntriesResult,
            withoutAnimation: true,
        });

        useImperativeHandle(
            ref,
            () => ({
                getFirstItemIfExists: () => query.getFirstItemIfExists(),
            }),
            [query],
        );

        if (query.getItemCount() === 0) {
            return <InboxViewEntriesEmpty filter={filter} />;
        }

        return (
            <SpaceLayoutTopBarInboxOverlayEntriesInner
                filter={filter}
                query={query}
                tryLoadingMore={tryLoadingMore}
                onClose={onClose}
            />
        );
    },
);

function SpaceLayoutTopBarInboxOverlayEntriesInner({
    filter,
    query,
    tryLoadingMore,
    onClose,
}: {
    filter: InboxEntryStatus;
    query: RynamoIndexQuery<InboxEntryModel>;
    tryLoadingMore: (
        viewHeight: number,
        renderedRange: {startIndex: number; endIndex: number} | null,
    ) => void;
    onClose: Memo<() => void>;
}) {
    const viewRef = useRef<VirtualizedScrollViewRef>(null);
    const spacingScale = useSpacingScale();

    // Whenever our query data changes, try loading more entries. In case our rendered
    // range stayed the same but we now see the loading indicator.
    //
    // This effect should also fire when `tryLoadingMore()` completes in case it didn't
    // fully load the query.
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        query;

        const view = assertExists(viewRef.current);
        tryLoadingMore(view.getHeight(), view.getRenderedRange());
    }, [query, tryLoadingMore]);

    const itemCount = query.getItemCount();

    const virtualizedViewHeight =
        convertRemLengthToPx(spacing[spaceLayoutSideBarInboxOverlayHeight], spacingScale) -
        convertRemLengthToPx(spacing[spaceLayoutSideBarInboxOverlayHeaderHeight], spacingScale);

    return (
        <VirtualizedScrollView
            ref={viewRef}
            bufferedItemHeight={inboxEntryViewMinHeight}
            initialViewHeight={virtualizedViewHeight}
            onRenderedRangeChange={renderedRange => {
                const view = assertExists(viewRef.current);
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
                                    <SpaceLayoutTopBarInboxOverlayEntry
                                        filter={filter}
                                        entry={item.item}
                                        isFirstItem={index === 0}
                                        isLastItem={index === itemCount - 1}
                                        onClose={onClose}
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
                [filter, itemCount, onClose, query],
            )}
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
                        bottom="0"
                        height="1"
                        backgroundColor="grey-0"
                    />
                </Box>
            )}
        />
    );
}

function SpaceLayoutTopBarInboxOverlayEntry({
    filter,
    entry,
    isFirstItem,
    isLastItem,
    onClose,
}: {
    filter: InboxEntryStatus;
    entry: RynamoItem<InboxEntryModel>;
    isFirstItem: boolean;
    isLastItem: boolean;
    onClose: () => void;
}) {
    const reporter = useReporter();
    const peekStackContext = usePeekStackContext();
    const archiveInboxEntry = useArchiveInboxEntry();
    const unarchiveInboxEntry = useUnarchiveInboxEntry();

    const [isPending, setIsPending] = useState(false);

    return (
        <InboxEntryView
            filter={filter}
            entry={entry.model}
            withBackgroundIfPressed={true}
            withMarginTop={isFirstItem}
            withMarginBottom={isLastItem}
            withBorderTop={isFirstItem}
            onPress={() => {
                if (isPending) return;
                setIsPending(true);

                peekStackContext.push(getInboxEntryPath(entry.model, "narrow")).then(
                    () => {
                        setIsPending(false);
                        onClose();
                    },
                    error => {
                        setIsPending(false);
                        reporter.displayError("Couldn\u2019t open notification", error);
                    },
                );
            }}
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
