import {Key, Memo, RefObject, useRef} from "react";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {MessageList} from "~/client/messaging/message_list";
import {
    messageViewMarginY,
    messageViewMergedMarginY,
    shouldMergeMessages,
} from "~/client/messaging/message_view";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view";
import {RemLength, convertRemLengthToPx, spacing} from "~/shared/design/spacing";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping";
import {MessageModel} from "~/shared/models/message_model";

export function useScrollToNewMessages<Message extends MessageModel>({
    viewRef,
    messages,
    getMessageViewKey,
    stickyInputHeight = "0rem",
}: {
    viewRef: RefObject<VirtualizedScrollViewRef>;
    messages: MessageList<Message>;
    getMessageViewKey: Memo<(messageIndex: number) => Key>;
    stickyInputHeight?: RemLength;
}) {
    // When new messages are added and the user is near the end of the scroll
    // view, we want to scroll our view down so that the user can see the new
    // message. There are two cases where this is important:
    //
    // 1. The user is actively having a conversation at the end of the messaging
    //    view. When they send a message we scroll their new message into view so
    //    they can see it.
    // 2. The user is actively having a conversation at the end of the messaging
    //    view and another person in the conversation sends a message.
    const lastMessageCountRef = useRef(messages.getMessageCount());
    useLayoutEffectWithoutServerSideWarning(() => {
        const lastMessageCount = lastMessageCountRef.current;
        const messageCount = messages.getMessageCount();
        lastMessageCountRef.current = messageCount;

        // No new comments, don't perform a scroll adjustment.
        if (lastMessageCount === messageCount) return;

        const run = () => {
            const view = assertExists(viewRef.current);

            let newMessagesOffset: number | null = null;
            let newMessagesHeight = 0;
            for (let messageIndex = lastMessageCount; messageIndex < messageCount; messageIndex++) {
                const position = view.getPositionByKeyIfExists(getMessageViewKey(messageIndex));

                // If any position doesn't exist, don't perform a scroll adjustment.
                if (!position) return;

                if (newMessagesOffset === null) newMessagesOffset = position.offset;
                newMessagesHeight += position.height;
            }

            // No new comments were found.
            if (newMessagesOffset === null) return;

            const previousMessage =
                lastMessageCount > 0 ? messages.getMessage(lastMessageCount - 1).message : null;
            const firstNewMessage = messages.getMessage(lastMessageCount).message;

            const remPx = getRemPxWithoutListening();

            const maybeNewScrollOffset =
                view.getScrollOffset() +
                newMessagesHeight -
                // When a new message is added we also remove some margin from the previous
                // message. Adjust our new scroll height so we don't overshoot and consider the
                // fact that some margin is lost.
                (lastMessageCount > 0 &&
                previousMessage &&
                firstNewMessage &&
                shouldMergeMessages(previousMessage, firstNewMessage)
                    ? convertRemLengthToPx(spacing[messageViewMarginY], remPx) -
                      convertRemLengthToPx(spacing[messageViewMergedMarginY], remPx)
                    : 0);

            // If the view has a sticky input then the view height alone is larger then
            // what the user perceives as the visible message view window. This is used for
            // posts which have a sticky comment input that occludes comments in the view.
            const viewHeightWithoutStickyInput =
                view.getHeight() - convertRemLengthToPx(stickyInputHeight, remPx);
            if (
                // If the new messages are completely visible with our existing scroll offset
                // then don't perform an adjustment.
                !(
                    view.getScrollOffset() <= newMessagesOffset &&
                    newMessagesOffset + newMessagesHeight <=
                        view.getScrollOffset() + viewHeightWithoutStickyInput
                ) &&
                // Only set the new scroll offset if it would put the new messages onscreen.
                // Otherwise the messages you're looking at will jump in a way that doesn't
                // make sense.
                areRangesOverlapping(
                    maybeNewScrollOffset,
                    maybeNewScrollOffset + viewHeightWithoutStickyInput,
                    newMessagesOffset,
                    newMessagesOffset + newMessagesHeight,
                )
            ) {
                view.setScrollOffset(maybeNewScrollOffset);
            }
        };

        // Run our effect after a microtask so that refs from the parent component
        // are populated.
        let isCancelled = false;
        scheduleMicrotask(() => {
            if (isCancelled) return;
            run();
        });
        return () => {
            isCancelled = true;
        };
    }, [getMessageViewKey, messages, stickyInputHeight, viewRef]);
}
