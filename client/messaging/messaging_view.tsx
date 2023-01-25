import {useCallback, useRef, useState} from "react";
import {useRemPx} from "~/client/design/helpers/use_rem_px";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {MessageShimmer} from "~/client/messaging/message_shimmer";
import {MessageView, messageViewMinHeight} from "~/client/messaging/message_view";
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

    const [{pinTo, list, isLoading, errorState}, setState] = useState(
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
    if (errorState.hasError) throw errorState.error;

    // This is an event function so that every time it is called it uses the
    // latest props.
    //
    // IMPORTANT: In this function be careful about using props after an
    // asynchronous callback! Those props may be stale.
    const tryLoadingMore = useEvent(() => {
        // If we're already loading, don't try to load more data.
        if (isLoading) return;

        const view = assertExists(viewRef.current);
        const range = view.getRenderedRange();
        if (!range) return;

        const startMessage = list.getMessage(range.startIndex);
        const endMessage = list.getMessage(range.endIndex);

        // Everything rendered is loaded. Yay! Proceed if we need to load some data.
        if (startMessage.isLoaded && endMessage.isLoaded) return;

        // The limit of items we will load is two views worth of messages. This gives
        // the user some space to scroll and read before we need to load more messages.
        const viewHeight = view.getHeight();
        const limit = Math.max(
            20,
            Math.ceil((viewHeight * 2) / convertRemLengthToPx(messageViewMinHeight, remPx)),
        );

        if (startMessage.isLoaded && !endMessage.isLoaded) {
            setState(state => ({...state, isLoading: true}));

            const afterMessageId = assertExists(
                list.getLastLoadedMessageBefore(range.endIndex),
                "Start message is loaded so there should be a loaded message after our end index",
            ).id;

            const beforeMessageId = list.getFirstLoadedMessageAfter(range.endIndex)?.id ?? null;

            onLoadFromStart({
                afterMessageId,
                beforeMessageId,
                limit,
            }).then(
                result => {
                    const hasExceededLimit = result.messages.length >= limit;

                    setState(state => ({
                        ...state,
                        isLoading: false,
                        list: state.list.loadMessages({
                            // If we exceeded the limit, we don't want to use the actual `afterMessageId`
                            // because our list will think the messages between our first message `id` and
                            // `afterMessageId` were deleted.
                            afterMessageId: hasExceededLimit
                                ? result.messages[0]!.id - 1
                                : afterMessageId,
                            beforeMessageId: beforeMessageId ?? maxMessageId + 1,
                            mayHaveMoreMessagesBefore: true,
                            mayHaveMoreMessagesAfter:
                                beforeMessageId !== null || result.hasMoreMessagesAfter,
                            messages: result.messages,
                        }),
                    }));

                    // The user might have scrolled while we were loading so try loading more now
                    // that we're done.
                    tryLoadingMore();
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

        if (!startMessage.isLoaded && endMessage.isLoaded) {
            setState(state => ({...state, isLoading: true}));

            const afterMessageId = list.getLastLoadedMessageBefore(range.startIndex)?.id ?? null;

            const beforeMessageId = assertExists(
                list.getFirstLoadedMessageAfter(range.startIndex),
                "End message is loaded so there should be a loaded message after our start index",
            ).id;

            onLoadFromEnd({
                afterMessageId,
                beforeMessageId,
                limit,
            }).then(
                result => {
                    const hasExceededLimit = result.messages.length >= limit;

                    setState(state => ({
                        ...state,
                        isLoading: false,
                        list: state.list.loadMessages({
                            afterMessageId: afterMessageId ?? minMessageId - 1,
                            // If we exceeded the limit, we don't want to use the actual `beforeMessageId`
                            // because our list will think the messages between our last message `id` and
                            // `beforeMessageId` were deleted.
                            beforeMessageId: hasExceededLimit
                                ? result.messages[result.messages.length - 1]!.id + 1
                                : beforeMessageId,
                            mayHaveMoreMessagesBefore:
                                afterMessageId !== null || result.hasMoreMessagesBefore,
                            mayHaveMoreMessagesAfter: true,
                            messages: result.messages,
                        }),
                    }));

                    // The user might have scrolled while we were loading so try loading more now
                    // that we're done.
                    tryLoadingMore();
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

        console.log("TODO");
    });

    return (
        <VirtualizedScrollView
            ref={viewRef}
            pinTo={pinTo}
            itemCount={list.getEstimatedMessageCount()}
            renderItem={useCallback(
                index => {
                    const messageResult = list.getMessage(index);

                    const lastMessageResult = index > 0 ? list.getMessage(index - 1) : null;
                    const nextMessageResult =
                        index < list.getEstimatedMessageCount() - 1
                            ? list.getMessage(index + 1)
                            : null;

                    const lastMessage = lastMessageResult?.isLoaded
                        ? lastMessageResult.message
                        : null;
                    const nextMessage = nextMessageResult?.isLoaded
                        ? nextMessageResult.message
                        : null;

                    return {
                        minHeight: messageViewMinHeight,
                        key: messageResult.isLoaded
                            ? `MessageView:${messageResult.message.id}`
                            : `MessageShimmer:${index}`,
                        item: messageResult.isLoaded ? (
                            <MessageView
                                message={messageResult.message}
                                lastMessage={lastMessage}
                                nextMessage={nextMessage}
                            />
                        ) : (
                            <MessageShimmer
                                randomSeed={shimmerRandomSeed}
                                index={index}
                                lastMessage={lastMessage}
                                nextMessage={nextMessage}
                            />
                        ),
                    };
                },
                [list, shimmerRandomSeed],
            )}
            onRenderedRangeChange={tryLoadingMore}
        />
    );
}
