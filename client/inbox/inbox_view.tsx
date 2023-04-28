import {SpinnerGap} from "phosphor-react";
import {useCallback, useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {DynamoGeneralRealtimeIndexQuery} from "~/client/dynamo/dynamo_general_realtime_index_query";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {InboxEntryView, inboxEntryViewMinHeight} from "~/client/inbox/inbox_entry_view";
import {useSpaceContext} from "~/client/spaces/space_context";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view";
import {convertRemLengthToPx, spacing} from "~/shared/design/spacing";
import {DynamoGeneralRealtimeIndexQueryResult} from "~/shared/dynamo/dynamo_general_realtime_types";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {InboxEntryModel} from "~/shared/models/inbox_model";
import {getInboxEntries} from "~/shared/rpc/notifications_rpc_definitions";
import {colorSchemeVars, spinAnimationClassName} from "~/shared/styles/styles";

export function InboxView({
    initialEntriesResult,
}: {
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>;
}) {
    const entriesViewRef = useRef<VirtualizedScrollViewRef>(null);
    const context = useAppContext();
    const {space} = useSpaceContext();
    const [query, setQuery] = useState(() =>
        DynamoGeneralRealtimeIndexQuery.new(initialEntriesResult),
    );

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
                                        node: <InboxEntryView entry={item.item.model} />,
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
                        [query],
                    )}
                />
            </Box>
            <Box flexGrow="1" overflow="hidden"></Box>
        </Box>
    );
}
