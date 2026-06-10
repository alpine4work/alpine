import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {SiteContainerId, SiteRootContainerId} from "~/shared/sites/site_entry_id.js";
import {SiteTreeBase, SiteTreeEntry} from "~/shared/sites/site_tree_base.js";

/**
 * Compute the first entity ID in the site tree via Depth-First Search.
 */
export function computeFirstEntityId<Entry extends SiteTreeEntry>(
    rootContainerId: SiteRootContainerId,
    siteTree: SiteTreeBase<Entry>,
): SiteItemSearchEntityId | null {
    return findFirstEntityIdRecursively(rootContainerId, siteTree);
}

function findFirstEntityIdRecursively<Entry extends SiteTreeEntry>(
    containerId: SiteContainerId,
    siteTree: SiteTreeBase<Entry>,
): SiteItemSearchEntityId | null {
    const children = siteTree.getChildrenForParent(containerId);
    if (children.length === 0) {
        return null;
    }

    for (const child of children) {
        if (child.type === "Entity") {
            return child.id;
        }

        // Container - recurse into it first (DFS)
        const result = findFirstEntityIdRecursively(child.id, siteTree);
        if (result !== null) {
            return result;
        }
    }

    return null;
}
