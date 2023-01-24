import {useCallback} from "react";
import {ClientInfo} from "~/client/helpers/client_info_context";
import {MessageShimmer} from "~/client/messaging/message_shimmer";
import {MessageView, messageViewMinHeight} from "~/client/messaging/message_view";
import {
    VirtualizedScrollView,
    getInitialVirtualizedScrollViewRenderedItemCount,
} from "~/client/virtualized/virtualized_scroll_view";
import {MessageInterface} from "~/shared/models/message_interface";

/**
 * Get the initial number of messages to load.
 */
export function getInitialLoadMessageCount(clientInfo: ClientInfo) {
    return getInitialVirtualizedScrollViewRenderedItemCount(clientInfo, messageViewMinHeight);
}

export function MessagingView({
    initialMessageCount,
    messages,
    shimmerRandomSeed,
}: {
    initialMessageCount: number;
    messages: ReadonlyArray<MessageInterface>;
    shimmerRandomSeed: string;
}) {
    return (
        <VirtualizedScrollView
            pinTo="bottom"
            itemCount={initialMessageCount}
            renderItem={useCallback(
                index => {
                    const adjustedIndex = index - (initialMessageCount - messages.length);

                    const message = messages[adjustedIndex] ?? null;
                    const lastMessage = messages[adjustedIndex - 1] ?? null;
                    const nextMessage = messages[adjustedIndex + 1] ?? null;

                    return {
                        minHeight: messageViewMinHeight,
                        key: message?.id ?? index,
                        item: message ? (
                            <MessageView
                                message={message}
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
                [initialMessageCount, messages, shimmerRandomSeed],
            )}
        />
    );
}
