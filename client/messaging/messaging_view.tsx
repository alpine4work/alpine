import {useCallback, useEffect, useRef, useState} from "react";
import {useRemPx} from "~/client/design/helpers/use_rem_px";
import {Spacer} from "~/client/design/spacer";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {MessageShimmer} from "~/client/messaging/message_shimmer";
import {
    MessageView,
    bufferedMessageViewHeight,
    messageViewMinHeight,
} from "~/client/messaging/message_view";
import {
    PaginatedMessageList,
    maxMessageId,
    minMessageId,
} from "~/client/messaging/paginated_message_list";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    getInitialVirtualizedScrollViewRenderedItemCount,
} from "~/client/virtualized/virtualized_scroll_view";
import {convertRemLengthToPx} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {MessageInterface} from "~/shared/models/message_interface";
import {ClientInfo} from "~/shared/remix/client_info";

/**
 * Get the initial number of messages to load.
 */
export function getInitialLoadMessageCount(clientInfo: ClientInfo) {
    return getInitialVirtualizedScrollViewRenderedItemCount(clientInfo, messageViewMinHeight);
}

export function MessagingView<Message extends MessageInterface>({
    initialState,
    shimmerRandomSeed,
    onLoadFromStart,
    onLoadFromEnd,
}: {
    initialState:
        | {
              readonly from: "Start";
              readonly totalMessageCount: number;
              readonly hasMoreMessagesAfter: boolean;
              readonly messages: ReadonlyArray<Message>;
          }
        | {
              readonly from: "End";
              readonly totalMessageCount: number;
              readonly hasMoreMessagesBefore: boolean;
              readonly messages: ReadonlyArray<Message>;
          };
    shimmerRandomSeed: string;
    onLoadFromStart: (options: {
        limit: number;
        afterMessageId: number | null;
        beforeMessageId: number | null;
    }) => Promise<{
        messages: ReadonlyArray<Message>;
        hasMoreMessagesAfter: boolean;
    }>;
    onLoadFromEnd: (options: {
        limit: number;
        afterMessageId: number | null;
        beforeMessageId: number | null;
    }) => Promise<{
        messages: ReadonlyArray<Message>;
        hasMoreMessagesBefore: boolean;
    }>;
}) {
    const viewRef = useRef<VirtualizedScrollViewRef>(null);
    const remPx = useRemPx();

    const [state, setState] = useState(
        (): {
            pinTo: "top" | "bottom";
            list: PaginatedMessageList<Message>;
            isLoading: boolean;
            errorState: {hasError: false} | {hasError: true; error: unknown};
        } => {
            switch (initialState.from) {
                case "Start": {
                    return {
                        pinTo: "top",
                        list: PaginatedMessageList.new<Message>(
                            initialState.totalMessageCount,
                        ).loadMessages({
                            afterMessageId: minMessageId - 1,
                            beforeMessageId:
                                initialState.messages.length > 0
                                    ? initialState.messages[initialState.messages.length - 1]!.id +
                                      1
                                    : maxMessageId + 1,
                            mayHaveMoreMessagesBefore: false,
                            mayHaveMoreMessagesAfter: initialState.hasMoreMessagesAfter,
                            messages: initialState.messages,
                        }),
                        isLoading: false,
                        errorState: {hasError: false},
                    };
                }
                case "End": {
                    return {
                        pinTo: "bottom",
                        list: PaginatedMessageList.new<Message>(
                            initialState.totalMessageCount,
                        ).loadMessages({
                            afterMessageId:
                                initialState.messages.length > 0
                                    ? initialState.messages[0]!.id - 1
                                    : minMessageId - 1,
                            beforeMessageId: maxMessageId + 1,
                            mayHaveMoreMessagesBefore: initialState.hasMoreMessagesBefore,
                            mayHaveMoreMessagesAfter: false,
                            messages: initialState.messages,
                        }),
                        isLoading: false,
                        errorState: {hasError: false},
                    };
                }
                default:
                    throw exhaustive(initialState);
            }
        },
    );

    // Escalate network errors to component errors.
    if (state.errorState.hasError) throw state.errorState.error;

    // This is an event function so that every time it is called it uses the
    // latest props.
    //
    // IMPORTANT: In this function be careful about using props after an
    // asynchronous callback! Those props may be stale.
    const tryLoadingMore = useEvent(() => {
        // If we're already loading, don't try to load more data.
        if (state.isLoading) return;

        const view = assertExists(viewRef.current);
        const range = view.getRenderedRange();
        if (!range) return;

        const startMessage = state.list.getMessage(range.startIndex);
        const endMessage = state.list.getMessage(range.endIndex);

        // Everything rendered is loaded. Yay! Proceed if we need to load some data.
        if (startMessage.isLoaded && endMessage.isLoaded) return;

        // The limit of items we will load is two views worth of messages. This gives
        // the user some space to scroll and read before we need to load more messages.
        //
        // If the user did a jump scroll then we will load three views worth of
        // messages.
        const viewHeight = view.getHeight();
        const limit = Math.max(
            20,
            Math.ceil((viewHeight * 2) / convertRemLengthToPx(messageViewMinHeight, remPx)),
        );
        const jumpLimitViewCount = 3;
        const jumpLimit = Math.max(
            20,
            Math.ceil(
                (viewHeight * jumpLimitViewCount) /
                    convertRemLengthToPx(messageViewMinHeight, remPx),
            ),
        );

        const loadFromStart = ({
            afterMessageId,
            beforeMessageId,
            limit,
        }: {
            afterMessageId: number;
            beforeMessageId: number | null;
            limit: number;
        }) => {
            setState(state => ({...state, isLoading: true}));

            onLoadFromStart({
                afterMessageId,
                beforeMessageId,
                limit,
            }).then(
                result => {
                    setState(state => ({
                        ...state,
                        isLoading: false,
                        list: state.list.loadMessagesFromStart({
                            afterMessageId,
                            beforeMessageId,
                            limit,
                            hasMoreMessagesAfter: result.hasMoreMessagesAfter,
                            messages: result.messages,
                        }),
                    }));
                },
                error => {
                    setState(state => ({
                        ...state,
                        isLoading: false,
                        errorState: {hasError: true, error},
                    }));
                },
            );
        };

        if (startMessage.isLoaded && !endMessage.isLoaded) {
            const afterMessageId = assertExists(
                state.list.getLastLoadedMessageBefore(range.endIndex),
                "Start message is loaded so there should be a loaded message after our end index",
            ).message.id;

            const beforeMessageId =
                state.list.getFirstLoadedMessageAfter(range.endIndex)?.message.id ?? null;

            loadFromStart({
                afterMessageId,
                beforeMessageId,
                limit,
            });
            return;
        }

        if (!startMessage.isLoaded && endMessage.isLoaded) {
            setState(state => ({...state, isLoading: true}));

            const afterMessageId =
                state.list.getLastLoadedMessageBefore(range.startIndex)?.message.id ?? null;

            const beforeMessageId = assertExists(
                state.list.getFirstLoadedMessageAfter(range.startIndex),
                "End message is loaded so there should be a loaded message after our start index",
            ).message.id;

            onLoadFromEnd({
                afterMessageId,
                beforeMessageId,
                limit,
            }).then(
                result => {
                    setState(state => ({
                        ...state,
                        isLoading: false,
                        list: state.list.loadMessagesFromEnd({
                            afterMessageId,
                            beforeMessageId,
                            limit,
                            hasMoreMessagesBefore: result.hasMoreMessagesBefore,
                            messages: result.messages,
                        }),
                    }));
                },
                error => {
                    setState(state => ({
                        ...state,
                        isLoading: false,
                        errorState: {hasError: true, error},
                    }));
                },
            );
            return;
        }

        // If neither of the messages in our rendered range are loaded then this is a
        // jump scroll. During a jump scroll we take advantage of the fact that message
        // `id`s are mostly dense to pick a message `id` at roughly the same percentage
        // the user has scrolled. We load data in at that point and scroll it
        // into view.
        assert(!startMessage.isLoaded && !endMessage.isLoaded);

        const messageBeforeUnloadedSegment = state.list.getLastLoadedMessageBefore(
            range.startIndex,
        );
        const messageAfterUnloadedSegment = state.list.getFirstLoadedMessageAfter(range.endIndex);

        const unloadedSegmentStartMessageId =
            messageBeforeUnloadedSegment?.message.id ?? minMessageId - 1;
        const unloadedSegmentEndMessageId =
            messageAfterUnloadedSegment?.message.id ??
            Math.max(state.list.getEstimatedMessageCount() + 1, unloadedSegmentStartMessageId + 1);

        const unloadedSegmentStartIndex = messageBeforeUnloadedSegment?.index ?? 0;
        const unloadedSegmentEndIndex =
            messageAfterUnloadedSegment?.index ?? state.list.getEstimatedMessageCount() - 1;

        const rangeStartFraction =
            (range.startIndex - unloadedSegmentStartIndex) /
            (unloadedSegmentEndIndex - unloadedSegmentStartIndex);

        // Pick a message `id` to start loading data from taking advantage of the fact
        // that messages are mostly dense.
        const afterMessageId = Math.min(
            Math.max(0, unloadedSegmentEndMessageId - jumpLimit),
            Math.round(
                unloadedSegmentStartMessageId +
                    (unloadedSegmentEndMessageId - unloadedSegmentStartMessageId) *
                        rangeStartFraction,
            ),
        );

        // Jump scrolls switch us into pin to top mode.
        setState(state => ({...state, pinTo: "top"}));

        loadFromStart({
            afterMessageId,
            beforeMessageId: messageAfterUnloadedSegment?.message.id ?? null,
            limit: jumpLimit,
        });
    });

    // Whenever we stop loading, try loading more messages. Maybe while we were
    // loading the user scrolled and so there are new unloaded messages in view.
    useEffect(() => {
        if (!state.isLoading) {
            tryLoadingMore();
        }
    }, [state.isLoading, tryLoadingMore]);

    return (
        <VirtualizedScrollView
            ref={viewRef}
            pinTo={state.pinTo}
            bufferedItemHeight={bufferedMessageViewHeight}
            itemCount={state.list.getEstimatedMessageCount()}
            renderItem={useCallback(
                index => {
                    const messageResult = state.list.getMessage(index);

                    const previousMessageResult =
                        index > 0 ? state.list.getMessage(index - 1) : null;
                    const nextMessageResult =
                        index < state.list.getEstimatedMessageCount() - 1
                            ? state.list.getMessage(index + 1)
                            : null;

                    const previousMessage = previousMessageResult?.isLoaded
                        ? previousMessageResult.message
                        : null;
                    const nextMessage = nextMessageResult?.isLoaded
                        ? nextMessageResult.message
                        : null;

                    const node = messageResult.isLoaded ? (
                        <MessageView
                            message={messageResult.message}
                            previousMessage={previousMessage}
                            nextMessage={nextMessage}
                        />
                    ) : (
                        <MessageShimmer
                            randomSeed={shimmerRandomSeed}
                            index={index}
                            previousMessage={previousMessage}
                            nextMessage={nextMessage}
                            messages={state.list}
                        />
                    );

                    return {
                        minHeight: messageViewMinHeight,
                        key: messageResult.isLoaded
                            ? `MessageView:${messageResult.message.id}`
                            : `MessageShimmer:${index}`,
                        node:
                            index === 0 ? (
                                <>
                                    <Spacer space="3" />
                                    {node}
                                </>
                            ) : (
                                node
                            ),
                    };
                },
                [state.list, shimmerRandomSeed],
            )}
            onRenderedRangeChange={tryLoadingMore}
        />
    );
}
