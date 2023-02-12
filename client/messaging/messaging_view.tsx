import {useCallback, useEffect, useRef, useState} from "react";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {MessageList} from "~/client/messaging/message_list";
import {bufferedMessageViewHeight, messageViewMinHeight} from "~/client/messaging/message_view";
import {tryLoadingMessages} from "~/client/messaging/try_loading_messages";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    getInitialVirtualizedScrollViewRenderedItemCount,
} from "~/client/virtualized/virtualized_scroll_view";
import {UnimplementedError} from "~/shared/error/error";
import {assertExists} from "~/shared/helpers/control/assert_exists";
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
    initialState: {
        readonly pinTo: "top" | "bottom";
        readonly messageCount: number;
        readonly messages: ReadonlyArray<Message>;
    };
    shimmerRandomSeed: string;
    onLoadFromStart: (options: {
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    }) => Promise<{
        messageCount: number;
        messages: ReadonlyArray<Message>;
    }>;
    onLoadFromEnd: (options: {
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    }) => Promise<{
        messageCount: number;
        messages: ReadonlyArray<Message>;
    }>;
}) {
    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const [state, setState] = useState(
        (): {
            pinTo: "top" | "bottom";
            list: MessageList<Message>;
            isLoading: boolean;
            errorState: {hasError: false} | {hasError: true; error: unknown};
        } => ({
            pinTo: initialState.pinTo,
            list: MessageList.new<Message>(initialState.messageCount).setMessages(
                initialState.messages,
            ),
            isLoading: false,
            errorState: {hasError: false},
        }),
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
                        list: state.list
                            .setMessageCount(result.value.messageCount)
                            .setMessages(result.value.messages),
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
            itemCount={state.list.getMessageCount()}
            renderItem={useCallback(index => {
                throw new UnimplementedError("TODO");
            }, [])}
            onRenderedRangeChange={tryLoadingMore}
        />
    );
}
