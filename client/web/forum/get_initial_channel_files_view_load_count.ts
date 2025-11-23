import {getInitialAppRenderSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {
    channelFilesViewFileMinSize,
    channelFilesViewFileRowFileCount,
} from "~/client/web/styles/forum_shared_styles.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/web/virtualized/get_initial_virtualized_scroll_view_rendered_item_count.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {ClientInfo} from "~/shared/remix/client_info.js";

export function getInitialChannelFilesViewFileLoadCount(clientInfo: ClientInfo) {
    return (
        getInitialVirtualizedScrollViewRenderedItemCount(
            clientInfo,
            convertRemLengthToPx(
                channelFilesViewFileMinSize,
                getInitialAppRenderSpacingScale(clientInfo),
            ),
        ) * channelFilesViewFileRowFileCount
    );
}
