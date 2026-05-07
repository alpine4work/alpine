import {FailedPreconditionError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {SiteContainerId} from "~/shared/sites/site_entry_id.js";
import {SiteTreeBase, SiteTreeEntry} from "~/shared/sites/site_tree_base.js";

export function validateSiteContainerIsEmpty<Entry extends SiteTreeEntry>(
    containerId: SiteContainerId,
    tree: SiteTreeBase<Entry>,
): void {
    const containerChildren = tree.getChildrenForParent(containerId);
    if (containerChildren.length > 0) {
        throw new FailedPreconditionError("Can\u2019t delete a container that has children", {
            displayMessage: errorDisplayMessage`Can\u2019t delete a container that has children. Remove all children and then try again.`,
        });
    }
}
