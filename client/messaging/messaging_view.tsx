import {useCallback, useEffect, useRef, useState} from "react";
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
import {tryLoadingMessages} from "~/client/messaging/try_loading_messages";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    getInitialVirtualizedScrollViewRenderedItemCount,
} from "~/client/virtualized/virtualized_scroll_view";
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

    const tryLoadingMore = useEvent(() => {
        // If we're already loading, don't try to load more data.
        if (state.isLoading) return;

        const view = assertExists(viewRef.current);
        const range = view.getRenderedRange();
        if (!range) return;

        const result = tryLoadingMessages({
            viewHeight: view.getHeight(),
            messages: state.list,
            range,
            onLoadFromStart,
            onLoadFromEnd,
            onFinishLoadingMessages: result => {
                if (result.ok) {
                    setState(state => ({
                        ...state,
                        isLoading: false,
                        list: result.value.updateMessages(state.list),
                    }));
                } else {
                    setState(state => ({
                        ...state,
                        isLoading: false,
                        errorState: {hasError: true, error: result.error},
                    }));
                }
            },
        });

        if (result.isLoading) {
            setState(state => ({
                ...state,
                isLoading: true,
                // Jump scrolls switch us into pin to top mode.
                pinTo: result.wasJump ? "top" : state.pinTo,
            }));
        }
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
