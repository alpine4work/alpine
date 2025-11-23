import {getInitialAppRenderSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {messageViewMinHeightPx} from "~/client/web/styles/messaging_shared_styles.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/web/virtualized/get_initial_virtualized_scroll_view_rendered_item_count.js";
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
