import {getInitialAppRenderSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {messageViewMinHeightPx} from "~/client/styles/messaging_shared_styles.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/get_initial_virtualized_scroll_view_rendered_item_count.js";
import {ClientInfo} from "~/shared/remix/client_info.js";

/**
 * Get the initial number of messages to load.
 */
export function getInitialLoadMessageCount(clientInfo: ClientInfo) {
    return getInitialVirtualizedScrollViewRenderedItemCount(
        clientInfo,
        messageViewMinHeightPx[getInitialAppRenderSpacingScale(clientInfo)],
    );
}
