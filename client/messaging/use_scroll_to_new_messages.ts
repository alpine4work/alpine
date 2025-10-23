import {Key, Memo, RefObject, useRef} from "react";
import {MessageInputRef} from "~/client/content/messaging/message_input_base.js";
import {flushNavigationBarScrollEventEmitter} from "~/client/design/navigation_bar_helpers.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {MessageList, MessageListItem} from "~/client/messaging/message_list.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {messageViewMinHeightPx} from "~/client/styles/messaging_shared_styles.js";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MessageModel} from "~/shared/messaging/message_model.js";

export function useScrollToNewMessages<Message extends MessageModel>({
    viewRef,
    inputRef,
    isInputStickyPositioned,
    messages,
    getItemKey,
}: {
    viewRef: RefObject<VirtualizedScrollViewRef>;
    inputRef: RefObject<MessageInputRef>;
    isInputStickyPositioned: boolean;
    messages: MessageList<Message> | null;
    getItemKey: Memo<(item: MessageListItem<Message>) => Key>;
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
    const lastItemCountRef = useRef(messages?.getItemCount() ?? null);
    const lastHasTypingIndicatorsItemRef = useRef(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (messages === null) return;

        // If this ref was previously null, set it to the current item count.
        lastItemCountRef.current ??= messages.getItemCount();

        const lastItemCount = lastItemCountRef.current;
        const itemCount = messages.getItemCount();
        lastItemCountRef.current = itemCount;

        const lastHasTypingIndicatorsItem = lastHasTypingIndicatorsItemRef.current;
        const hasTypingIndicatorsItem = messages.hasTypingIndicatorsItem();
        lastHasTypingIndicatorsItemRef.current = hasTypingIndicatorsItem;

        // No new item changes, don't perform a scroll adjustment.
        if (lastItemCount === itemCount && lastHasTypingIndicatorsItem === hasTypingIndicatorsItem)
            return;

        const run = () => {
            const firstNewItemIndex =
                lastItemCount -
                // If we previously had typing indicators item but now we don't, we want to
                // scroll to the item which replaced the typing indicator.
                (lastHasTypingIndicatorsItem && !hasTypingIndicatorsItem ? 1 : 0);

            // No new items.
            if (firstNewItemIndex >= itemCount) return;

            const view = assertExists(viewRef.current);
            const input = assertExists(inputRef.current);

            const firstNewItem = messages.getItem(firstNewItemIndex);
            const firstNewItemKey = getItemKey(firstNewItem);
            const firstNewItemPosition = view.getPositionByKeyIfExists(firstNewItemKey);

            // If a position doesn't exist (maybe because the item is offscreen), don't
            // perform a scroll adjustment.
            if (!firstNewItemPosition) return;

            const lastNewItemViewIndex =
                firstNewItemPosition.getIndex() + (messages.getItemCount() - firstNewItemIndex) - 1;
            const lastNewItemPosition = view.getPositionByIndex(lastNewItemViewIndex);

            const viewRect = view.getElement().getBoundingClientRect();
            const inputRect = input.getBoundingClientRect();

            const newItemsOffset = firstNewItemPosition.offset;
            const newItemsHeight =
                lastNewItemPosition.offset +
                lastNewItemPosition.height -
                newItemsOffset -
                // Subtract margin added for safe area from new item heights. Particularly
                // meaningful when the keyboard is open and there's lots of safe area.
                //
                // TODO(calebmer): Sticky positioned inputs will commonly be above
                // `viewRect.bottom` based on their scroll position. I think we'll need
                // different handling for sticky positioned inputs on mobile.
                (!isInputStickyPositioned ? Math.max(0, viewRect.bottom - inputRect.top) : 0);

            const actualNewItemsTop =
                viewRect.top + (firstNewItemPosition.offset - view.getScrollOffset());

            const idealNewItemsTop = inputRect.top - newItemsHeight;

            let scrollDelta = actualNewItemsTop - idealNewItemsTop;

            // NOTE(calebmer, #mobile-webkit-weirdness): So mobile WebKit doesn't
            // automatically adjust scroll when content in a scrollable element shrinks
            // until the user or JavaScript initiates a scroll. This may happen when we
            // have a typing indicator that's replaced by a message that's smaller than
            // the typing indicator (will happen if the message merges with the previous
            // one).
            //
            // So if our scroll delta is 0 (well between -1 and 1 to support fractions like
            // 0.5) then move our scroll just a smidge so WebKit automatic scroll
            // adjustment kicks in. This seems to work fine on desktop WebKit.
            //
            // To test this, open the keyboard in a chat at the end of messages. In another
            // window (desktop or mobile) type a short one line message. Wait for typing
            // indicators to appear on your first test mobile device then send from your
            // second window (the message needs to merge with the previous message).
            //
            // We use this same trick in `useScrollToAvoidBottomBarsAndMobileKeyboard()`.
            if (
                isMobileWebKit &&
                view.getScrollOffset() + view.getHeight() === view.getContentHeight() &&
                -1 < scrollDelta &&
                scrollDelta < 1
            ) {
                scrollDelta = -0.1;
            }

            const spacingScale = getSpacingScaleWithoutListening();

            const newScrollOffset = view.getScrollOffset() + scrollDelta;

            // Only scroll if we're near the bottom. If we'd have to scroll more than ~4
            // message views then don't do it since messages would jump unexpectedly and
            // the user might be disturbed while reading.
            if (scrollDelta <= newItemsHeight + messageViewMinHeightPx[spacingScale] * 4) {
                view.setScrollOffset(newScrollOffset);
                flushNavigationBarScrollEventEmitter.emit(view.getElement());
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
    }, [getItemKey, inputRef, isInputStickyPositioned, messages, viewRef]);
}
