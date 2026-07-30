import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {SiteContainerId} from "~/shared/sites/site_entry_id.js";
import {SiteEntryModel} from "~/shared/sites/site_model.js";
import {SiteTreeBase} from "~/shared/sites/site_tree_base.js";

/**
 * Find the entity to navigate to when `entityId` is removed from the site.
 *
 * Walks up the tree first — looking at preceding siblings at each ancestor level
 * for the rightmost entity in their subtree (i.e. the previous entity in DFS
 * pre-order). If none is found, walks down — looking at following siblings at each
 * ancestor level for the leftmost entity (i.e. the next entity in DFS pre-order).
 *
 * Returns null when `entityId` is the only entity in the tree.
 *
 * Call this with the pre-removal tree.
 */
export function computeAdjacentEntityId(
    entityId: SiteItemSearchEntityId,
    siteTree: SiteTreeBase<SiteEntryModel>,
): SiteItemSearchEntityId | null {
    return (
        findEntityIdInAncestorSiblings(entityId, siteTree, "preceding") ??
        findEntityIdInAncestorSiblings(entityId, siteTree, "following")
    );
}

function findEntityIdInAncestorSiblings(
    entityId: SiteItemSearchEntityId,
    siteTree: SiteTreeBase<SiteEntryModel>,
    direction: "preceding" | "following",
): SiteItemSearchEntityId | null {
    let currentKey: SiteContainerId | SiteItemSearchEntityId = entityId;

    while (true) {
        const current = siteTree.getEntry(currentKey);
        if (current.parentId === null) return null;

        const siblings = siteTree.getChildrenForParent(current.parentId);
        const index = siblings.findIndex(s => s.id === currentKey);

        const start = direction === "preceding" ? index - 1 : index + 1;
        const step = direction === "preceding" ? -1 : 1;
        for (let i = start; i >= 0 && i < siblings.length; i += step) {
            const result = findEdgeEntityIdInSubtree(siblings[i]!, siteTree, direction);
            if (result !== null) return result;
        }

        currentKey = current.parentId;
    }
}

/**
 * Within a subtree rooted at `entry`, find the leftmost (`"following"`) or
 * rightmost (`"preceding"`) entity in DFS order. Returns null for empty containers
 * or non-entity leaves.
 */
function findEdgeEntityIdInSubtree(
    entry: SiteEntryModel,
    siteTree: SiteTreeBase<SiteEntryModel>,
    direction: "preceding" | "following",
): SiteItemSearchEntityId | null {
    if (entry.type === "Entity") return entry.id;

    const children = siteTree.getChildrenForParent(entry.id);

    const start = direction === "preceding" ? children.length - 1 : 0;
    const step = direction === "preceding" ? -1 : 1;
    for (let i = start; i >= 0 && i < children.length; i += step) {
        const result = findEdgeEntityIdInSubtree(children[i]!, siteTree, direction);
        if (result !== null) return result;
    }

    return null;
}
