import {Key, Memo, RefObject, useRef} from "react";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {MessageList, MessageListItem} from "~/client/messaging/message_list.js";
import {
    messageViewMarginY,
    messageViewMergedMarginY,
    shouldMergeMessages,
} from "~/client/messaging/message_view.js";
import {messagingTypingIndicatorsMinHeight} from "~/client/messaging/messaging_typing_indicators.js";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view.js";
import {RemLength, convertRemLengthToPx, spacing} from "~/shared/design/spacing.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.js";
import {MessageModel} from "~/shared/messaging/message_model.js";

export function useScrollToNewMessages<Message extends MessageModel>({
    viewRef,
    messages,
    getItemKey,
    stickyInputHeight = "0rem",
}: {
    viewRef: RefObject<VirtualizedScrollViewRef>;
    messages: MessageList<Message>;
    getItemKey: Memo<(item: MessageListItem<Message>) => Key>;
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
    const lastItemCountRef = useRef(messages.getItemCount());
    const lastTypingIndicatorsHeightRef = useRef(0);
    useLayoutEffectWithoutServerSideWarning(() => {
        const lastItemCount = lastItemCountRef.current;
        const itemCount = messages.getItemCount();
        lastItemCountRef.current = itemCount;

        const lastTypingIndicatorsHeight = lastTypingIndicatorsHeightRef.current;
        const lastHasTypingIndicatorsItem = lastTypingIndicatorsHeight !== 0;
        const hasTypingIndicatorsItem = messages.hasTypingIndicatorsItem();

        // This should be set to the correct value in our `run()` function but just in
        // case the effect is cancelled, set it to a default here so it's at least
        // non-zero next effect run.
        lastTypingIndicatorsHeightRef.current = hasTypingIndicatorsItem
            ? convertRemLengthToPx(messagingTypingIndicatorsMinHeight, getRemPxWithoutListening())
            : 0;

        // No new item changes, don't perform a scroll adjustment.
        if (lastItemCount === itemCount && lastHasTypingIndicatorsItem === hasTypingIndicatorsItem)
            return;

        const run = () => {
            const view = assertExists(viewRef.current);

            let newItemsOffset: number | null = null;
            let newItemsHeight = 0;
            let newTypingIndicatorsHeight = 0;

            for (
                let itemIndex =
                    lastItemCount -
                    // If we previously had the typing indicators item but now we don't, we want to
                    // measure the height of the message which replaced the typing indicator.
                    (lastHasTypingIndicatorsItem && !hasTypingIndicatorsItem ? 1 : 0);
                itemIndex < itemCount;
                itemIndex++
            ) {
                const item = messages.getItem(itemIndex);
                const position = view.getPositionByKeyIfExists(getItemKey(item));

                // If any position doesn't exist, don't perform a scroll adjustment.
                if (!position) return;

                if (newItemsOffset === null) newItemsOffset = position.offset;
                newItemsHeight += position.height;

                if (item.type === "TypingIndicators") newTypingIndicatorsHeight += position.height;
            }

            // If this render removed our typing indicator then we want to scroll the
            // difference of the old typing indicator height and the new message replacing
            // the typing indicator.
            if (lastHasTypingIndicatorsItem && !hasTypingIndicatorsItem)
                newItemsHeight -= lastTypingIndicatorsHeight;

            lastTypingIndicatorsHeightRef.current = newTypingIndicatorsHeight;

            // No new comments were found.
            if (newItemsOffset === null) return;

            const previousMessage =
                lastItemCount > 0 ? messages.getItem(lastItemCount - 1).message ?? null : null;
            const firstNewMessage =
                lastItemCount < messages.getItemCount() - 1
                    ? messages.getItem(lastItemCount).message ?? null
                    : null;

            const remPx = getRemPxWithoutListening();

            const maybeNewScrollOffset =
                view.getScrollOffset() +
                newItemsHeight -
                // When a new message is added we also remove some margin from the previous
                // message. Adjust our new scroll height so we don't overshoot and consider the
                // fact that some margin is lost.
                (lastItemCount > 0 &&
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
                    view.getScrollOffset() <= newItemsOffset &&
                    newItemsOffset + newItemsHeight <=
                        view.getScrollOffset() + viewHeightWithoutStickyInput
                ) &&
                // Only set the new scroll offset if it would put the new messages onscreen.
                // Otherwise the messages you're looking at will jump in a way that doesn't
                // make sense.
                areRangesOverlapping(
                    maybeNewScrollOffset,
                    maybeNewScrollOffset + viewHeightWithoutStickyInput,
                    newItemsOffset,
                    newItemsOffset + newItemsHeight,
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
    }, [getItemKey, messages, stickyInputHeight, viewRef]);
}
