import {taskRowViewMinHeight} from "~/client/web/styles/tasks_shared_styles.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/web/virtualized/get_initial_virtualized_scroll_view_rendered_item_count.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {ClientInfo} from "~/shared/remix/client_info.js";

/**
 * Get the number of tasks to load when fetching a query.
 *
 * We load two times the virtualization height to give more room to scroll. The
 * initial virtualized scroll view rendered item count assumes you underestimate
 * the height of your items. In the case of tasks we know the exact height. So the
 * underestimated item count is lower than we'd like.
 */
export function getTaskGridViewLoadQueryLimit(clientInfo: ClientInfo) {
    return (
        getInitialVirtualizedScrollViewRenderedItemCount(
            clientInfo,
            spacing[taskRowViewMinHeight],
        ) * 2
    );
}
