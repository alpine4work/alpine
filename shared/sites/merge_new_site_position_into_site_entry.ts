import {InvalidArgumentError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {
    SiteContainerId,
    isSiteSideBarContainerId,
    isSiteSideBarSectionContainerId,
} from "~/shared/sites/site_entry_id.js";
import {SiteTreeEntry} from "~/shared/sites/site_tree_base.js";

export function mergeNewSitePositionIntoSiteEntry<Entry extends SiteTreeEntry>(
    entry: Entry,
    newPosition: {
        parentId: SiteContainerId;
        orderKey: OrderKey;
    },
): Entry {
    const {parentId: newParentId, orderKey: newOrderKey} = newPosition;
    switch (entry.type) {
        case "SideBarSection": {
            assert(
                isSiteSideBarSectionContainerId(newParentId) ||
                    isSiteSideBarContainerId(newParentId),
            );
            return {
                ...entry,
                parentId: newParentId,
                orderKey: newOrderKey,
            };
        }
        case "Entity":
            return {
                ...entry,
                parentId: newParentId,
                orderKey: newOrderKey,
            };
        case "TopBar":
        case "SideBar":
            throw new InvalidArgumentError("Can\u2019t move the top bar or side bar");
        default:
            throw exhaustive(entry);
    }
}
