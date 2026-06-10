import {Memo} from "react";
import {
    ChatMessagingViewHeader,
    chatMessagingViewHeaderMinHeight,
} from "~/client/web/chat/internal/chat_messaging_view_header.js";
import {VirtualizedScrollViewItem} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";

/**
 * The messaging header is empty space. It fills up the view height so your first
 * messages are pushed to the bottom of the screen. In the future we should do
 * something interesting with this empty space.
 */
export const chatMessagingViewHeaderItem = ((): DistributiveOmit<
    VirtualizedScrollViewItem,
    "key"
> => {
    return {
        minHeight: chatMessagingViewHeaderMinHeight,
        withManualLayout: true,
        render: ({
            ref,
            shouldRenderWithRelativePositioning,
            offset,
            height: originalHeight,
            viewHeight,
            originalContentHeight,
        }) => (
            <ChatMessagingViewHeader
                itemRef={ref}
                shouldRenderWithRelativePositioning={shouldRenderWithRelativePositioning}
                offset={offset}
                originalHeight={originalHeight}
                viewHeight={viewHeight}
                originalContentHeight={originalContentHeight}
            />
        ),
    };
})() as Memo<DistributiveOmit<VirtualizedScrollViewItem, "key">>;
