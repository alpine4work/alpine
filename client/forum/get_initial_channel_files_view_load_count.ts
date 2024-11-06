import {
    channelFilesViewFileMinSize,
    channelFilesViewFileRowFileCount,
} from "~/client/styles/forum_shared_styles.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/get_initial_virtualized_scroll_view_rendered_item_count.js";
import {
    convertRemLengthToPx,
    getRemPxFromWindowWidth,
    spacing,
} from "~/shared/design/core/spacing.js";
import {ClientInfo} from "~/shared/remix/client_info.js";

export function getInitialChannelFilesViewFileLoadCount(clientInfo: ClientInfo) {
    return (
        getInitialVirtualizedScrollViewRenderedItemCount(
            clientInfo,
            convertRemLengthToPx(
                spacing[channelFilesViewFileMinSize],
                getRemPxFromWindowWidth(clientInfo.screenWidth),
            ),
        ) * channelFilesViewFileRowFileCount
    );
}
