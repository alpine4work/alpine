import {ArrowUpRight, SpinnerGap} from "phosphor-react";
import {Memo, useCallback, useEffect, useRef, useState} from "react";
import {usePress} from "react-aria";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {useShowToast} from "~/client/design/toast.js";
import {DynamoGeneralRealtimeIndexQuery} from "~/client/dynamo/dynamo_general_realtime_index_query.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {usePromise} from "~/client/helpers/use_promise.js";
import {InboxEntryView} from "~/client/inbox/inbox_entry_view.js";
import {InboxViewEntriesEmpty} from "~/client/inbox/inbox_view_entries_empty.js";
import {InboxViewTopBarModeToggleButton} from "~/client/inbox/inbox_view_top_bar_mode_toggle_button.js";
import {useInboxState} from "~/client/inbox/use_inbox_state.js";
import {usePeekStackContext} from "~/client/peek/peek_stack.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {InboxEntryShimmer} from "~/client/shimmer/inbox_entry_shimmer.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/spacing.js";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {
    archiveInboxEntry,
    unarchiveInboxEntry,
} from "~/shared/rpc/notifications_rpc_definitions.js";
import {inboxEntryViewMinHeight} from "~/shared/styles/inbox_shared_styles.js";
import {colorSchemeVars, inboxStyles, spinAnimationClassName} from "~/shared/styles/styles.js";

const spaceLayoutSideBarInboxOverlayHeaderHeight: Spacing = "9";

export const spaceLayoutSideBarInboxOverlayHeight: Spacing = "128";

export function SpaceLayoutSideBarInboxOverlay({
    filter,
    initialEntriesResultPromise,
    onNewPress,
    onArchivePress,
    onClose,
}: {
    filter: "New" | "Archive";
    initialEntriesResultPromise: PromiseImmediate<
        DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>
    >;
    onNewPress: () => MaybePromise<void>;
    onArchivePress: () => MaybePromise<void>;
    onClose: Memo<() => void>;
}) {
    const initialEntriesResult = usePromise(initialEntriesResultPromise);

    return (
        <>
            <Box
                flexShrink="0"
                height={spaceLayoutSideBarInboxOverlayHeaderHeight}
                borderBottom="grey-10"
                display="flex"
                alignItems="center"
                paddingRight="1.5"
            >
                <SpaceLayoutSideBarInboxOverlayExpandButton
                    filter={filter}
                    withoutAnimation={
                        initialEntriesResult.isPending ||
                        initialEntriesResult.value.items.length <= 3
                    }
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
                <Box flexGrow="1" width="full" height="full" overflow="hidden" padding="1">
                    <InboxEntryShimmer titleRagRight="0" subtitleRagRight="8" />
                    <InboxEntryShimmer titleRagRight="6" subtitleRagRight="4" />
                    <InboxEntryShimmer titleRagRight="4" subtitleRagRight="6" />
                    <InboxEntryShimmer titleRagRight="0" subtitleRagRight="2" />
                    <InboxEntryShimmer titleRagRight="6" subtitleRagRight="4" />
                </Box>
            ) : (
                <SpaceLayoutTopBarInboxOverlayEntries
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
    onClose,
}: {
    filter: "New" | "Archive";
    withoutAnimation: boolean;
    onClose: () => void;
}) {
    const rootNavigate = useRootNavigate();
    const {space} = useSpaceContext();

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
            if (filter === "New") {
                void rootNavigate(`/s/${space.id}/inbox`).then(onClose);
            } else {
                void rootNavigate(`/s/${space.id}/inbox?tab=old`).then(onClose);
            }
        },
    });

    const [withAnimation, setWithAnimation] = useState(false);

    // Keep re-applying the animation CSS class so the user notices the inbox arrow
    // bounce encouraging them to open the fullscreen inbox. We believe the
    // fullscreen inbox is a better UX when managing many notifications. If the
    // user is spending a lot of time in the overlay when they have many
    // notifications, we hope the animation will subtly prompt them into opening
    // the fullscreen inbox.
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
        <Box
            {...pressProps}
            flexShrink="0"
            paddingX="3"
            paddingY="2"
            display="flex"
            alignItems="center"
            gap="0.5"
            // Pointer to indicate this is a clickable link. Otherwise it's not entirely
            // clear this element is clickable.
            cursor="pointer"
            opacity={isPressed ? "60" : undefined}
        >
            <Box fontSize="100" fontStyle="semi-bold">
                Inbox
            </Box>
            <ArrowUpRight
                className={
                    withAnimation ? inboxStyles.overlayArrowUpRightAnimationClassName : undefined
                }
                size={spacing["3"]}
                weight="bold"
                style={{
                    position: "relative",
                    top: "0.09375rem",
                }}
            />
        </Box>
    );
}

function SpaceLayoutTopBarInboxOverlayEntries({
    filter,
    initialEntriesResult,
    onClose,
}: {
    filter: "New" | "Archive";
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>;
    onClose: Memo<() => void>;
}) {
    const {query, updateQueryOptimistically, tryLoadingMore} = useInboxState({
        filter,
        initialEntriesResult,
    });

    const deleteEntryOptimistically = useEvent(
        ({
            promise,
            entry,
            withAnimation,
        }: {
            promise: Promise<unknown> | null;
            entry: DynamoGeneralRealtimeItem<InboxEntryModel>;
            withAnimation: boolean;
        }) => {
            updateQueryOptimistically({
                promise,
                withAnimation,
                update: query =>
                    query.optimisticallyDeleteItemByKeyIfExistsAtVersion(entry.key, entry.version),
            });
        },
    );

    if (query.getItemCount() === 0) {
        return <InboxViewEntriesEmpty filter={filter} />;
    }

    return (
        <SpaceLayoutTopBarInboxOverlayEntriesInner
            filter={filter}
            query={query}
            tryLoadingMore={tryLoadingMore}
            deleteEntryOptimistically={deleteEntryOptimistically}
            onClose={onClose}
        />
    );
}

function SpaceLayoutTopBarInboxOverlayEntriesInner({
    filter,
    query,
    tryLoadingMore,
    deleteEntryOptimistically,
    onClose,
}: {
    filter: "New" | "Archive";
    query: DynamoGeneralRealtimeIndexQuery<InboxEntryModel>;
    tryLoadingMore: (
        viewHeight: number,
        renderedRange: {startIndex: number; endIndex: number} | null,
    ) => void;
    deleteEntryOptimistically: Memo<
        ({
            promise,
            entry,
            withAnimation,
        }: {
            promise: Promise<unknown> | null;
            entry: DynamoGeneralRealtimeItem<InboxEntryModel>;
            withAnimation: boolean;
        }) => void
    >;
    onClose: Memo<() => void>;
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

    const virtualizedViewHeight =
        convertRemLengthToPx(spacing[spaceLayoutSideBarInboxOverlayHeight], remPx) -
        convertRemLengthToPx(spacing[spaceLayoutSideBarInboxOverlayHeaderHeight], remPx);

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
                                        isFirstEntry={index === 0}
                                        isLastEntry={index === itemCount - 1}
                                        deleteEntryOptimistically={deleteEntryOptimistically}
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
                [deleteEntryOptimistically, filter, itemCount, onClose, query],
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
    );
}

function SpaceLayoutTopBarInboxOverlayEntry({
    filter,
    entry,
    isFirstEntry,
    isLastEntry,
    deleteEntryOptimistically,
    onClose,
}: {
    filter: "New" | "Archive";
    entry: DynamoGeneralRealtimeItem<InboxEntryModel>;
    isFirstEntry: boolean;
    isLastEntry: boolean;
    deleteEntryOptimistically: Memo<
        ({
            promise,
            entry,
            withAnimation,
        }: {
            promise: Promise<unknown> | null;
            entry: DynamoGeneralRealtimeItem<InboxEntryModel>;
            withAnimation: boolean;
        }) => void
    >;
    onClose: () => void;
}) {
    const context = useAppContext();
    const showToast = useShowToast();
    const peekStackContext = usePeekStackContext();
    const {space} = useSpaceContext();

    const [isPending, setIsPending] = useState(false);

    return (
        <InboxEntryView
            filter={filter}
            entry={entry.model}
            withinOverlay={true}
            isFirstEntry={isFirstEntry}
            isLastEntry={isLastEntry}
            onPress={() => {
                if (isPending) return;

                // TODO(calebmer, #global-loading-indicator): Some kind of global loading
                // indicator?
                peekStackContext.push(entry.model.getPath()).then(
                    () => {
                        setIsPending(false);
                        onClose();
                    },
                    error => {
                        setIsPending(false);
                        showToast({
                            type: "Error",
                            title: "Couldn’t open notification",
                            error,
                        });
                    },
                );
            }}
            onArchive={async () => {
                await archiveInboxEntry(context, {
                    spaceId: space.id,
                    key: entry.model.getKey(),
                });

                // Wait until the backend has successfully archived the entry, then delete it
                // from our query without waiting for a WebSocket realtime message.
                deleteEntryOptimistically({
                    promise: null,
                    entry,
                    withAnimation: false,
                });
            }}
            onUnarchive={async () => {
                await unarchiveInboxEntry(context, {
                    spaceId: space.id,
                    key: entry.model.getKey(),
                });

                // Wait until the backend has successfully archived the entry, then delete it
                // from our query without waiting for a WebSocket realtime message.
                deleteEntryOptimistically({
                    promise: null,
                    entry,
                    withAnimation: false,
                });
            }}
        />
    );
}
