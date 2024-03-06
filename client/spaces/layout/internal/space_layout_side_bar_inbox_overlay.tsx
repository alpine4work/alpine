import {SpinnerGap} from "phosphor-react";
import {Memo, useCallback, useEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {useShowToast} from "~/client/design/toast.js";
import {DynamoGeneralRealtimeIndexQuery} from "~/client/dynamo/dynamo_general_realtime_index_query.js";
import {usePromise} from "~/client/helpers/use_promise.js";
import {InboxEntryView, inboxEntryViewMinHeight} from "~/client/inbox/inbox_entry_view.js";
import {InboxViewEntriesEmpty} from "~/client/inbox/inbox_view_entries_empty.js";
import {InboxViewTopBarModeToggleButton} from "~/client/inbox/inbox_view_top_bar_mode_toggle_button.js";
import {useInboxState} from "~/client/inbox/use_inbox_state.js";
import {usePeekStackContext} from "~/client/peek/peek_stack.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/spacing.js";
import {DynamoGeneralRealtimeIndexQueryResult} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {colorSchemeVars, spinAnimationClassName} from "~/shared/styles/styles.js";

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
                paddingLeft="2.5"
                paddingRight="1.5"
            >
                <Box flexGrow="1" fontSize="100" fontStyle="semi-bold">
                    Inbox
                </Box>
                <Box flexShrink="0">
                    <InboxViewTopBarModeToggleButton
                        filter={filter}
                        onNewPress={onNewPress}
                        onArchivePress={onArchivePress}
                    />
                </Box>
            </Box>
            {initialEntriesResult.isPending ? (
                <Box flexGrow="1" display="flex" justifyContent="center" alignItems="center">
                    <SpinnerGap
                        className={spinAnimationClassName}
                        color={colorSchemeVars["grey-70"]}
                        size={spacing["6"]}
                    />
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

function SpaceLayoutTopBarInboxOverlayEntries({
    filter,
    initialEntriesResult,
    onClose,
}: {
    filter: "New" | "Archive";
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>;
    onClose: Memo<() => void>;
}) {
    const {query, tryLoadingMore} = useInboxState({
        filter,
        initialEntriesResult,
    });

    if (query.getItemCount() === 0) {
        return <InboxViewEntriesEmpty filter={filter} />;
    }

    return (
        <SpaceLayoutTopBarInboxOverlayEntriesInner
            query={query}
            tryLoadingMore={tryLoadingMore}
            onClose={onClose}
        />
    );
}

function SpaceLayoutTopBarInboxOverlayEntriesInner({
    query,
    tryLoadingMore,
    onClose,
}: {
    query: DynamoGeneralRealtimeIndexQuery<InboxEntryModel>;
    tryLoadingMore: (
        viewHeight: number,
        renderedRange: {startIndex: number; endIndex: number} | null,
    ) => void;
    onClose: () => void;
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
                                        entry={item.item.model}
                                        isFirstEntry={index === 0}
                                        isLastEntry={index === itemCount - 1}
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
                [itemCount, onClose, query],
            )}
            // Render a div at the bottom of the notification list that covers the bottom
            // border of the last entry but only when there's enough content to scroll. If
            // there are only 2 entries, we want to show that last border.
            extraChildren={
                <Box
                    position="absolute"
                    zIndex="50"
                    left="0"
                    right="0"
                    top="0"
                    height="full"
                    style={{minHeight: virtualizedViewHeight}}
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
            }
        />
    );
}

function SpaceLayoutTopBarInboxOverlayEntry({
    entry,
    isFirstEntry,
    isLastEntry,
    onClose,
}: {
    entry: InboxEntryModel;
    isFirstEntry: boolean;
    isLastEntry: boolean;
    onClose: () => void;
}) {
    const showToast = useShowToast();
    const peekStackContext = usePeekStackContext();

    const [isPending, setIsPending] = useState(false);

    return (
        <InboxEntryView
            entry={entry}
            withinOverlay={true}
            isFirstEntry={isFirstEntry}
            isLastEntry={isLastEntry}
            onPress={() => {
                if (isPending) return;

                // TODO(calebmer, #global-loading-indicator): Some kind of global loading
                // indicator?
                peekStackContext.push(entry.getPath()).then(
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
        />
    );
}
