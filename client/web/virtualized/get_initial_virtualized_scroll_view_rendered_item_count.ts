import {getInitialAppRenderSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {getVirtualizationWindowHeight} from "~/client/web/virtualized/virtualized_scroll_view_state.js";
import {RemLength, convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {ClientInfo} from "~/shared/remix/client_info.js";

/**
 * How many items will the virtualized scroll view initially render assuming
 * every item has the same minimum height? This function is used to determine
 * how much data we need to load on the server to fill the screen.
 */
export function getInitialVirtualizedScrollViewRenderedItemCount(
    clientInfo: ClientInfo,
    minItemHeight: number | RemLength,
) {
    const maxRenderedHeight =
        getVirtualizationWindowHeight(clientInfo.screenHeight) *
        // Load a bit more data than's necessary to fill the initial virtualization
        // window height. Since if an item is removed (e.g. you mark an entry as done
        // in inbox) we don't want to immediately go load more.
        1.05;

    const spacingScale = getInitialAppRenderSpacingScale(clientInfo);
    const minItemHeightPx =
        typeof minItemHeight === "string"
            ? convertRemLengthToPx(minItemHeight, spacingScale)
            : minItemHeight;

    return Math.ceil(maxRenderedHeight / minItemHeightPx);
}
