import {SiteContainerId} from "~/shared/sites/site_entry_id.js";
import {SiteTreeBase, SiteTreeEntry} from "~/shared/sites/site_tree_base.js";

/**
 * Validate that moving an item to a new parent would not create a cycle.
 *
 * Example: If you have SideBar -> Section A -> Section B -> Section C, and try to
 * move Section A under Section C, you'd create a cycle: C -> A -> B -> C -> A ->
 * ...
 *
 * To detect this, walk up from the new parent. If we hit the item being moved
 * before reaching root, it's a cycle. This is O(depth).
 */
export function doesSiteEntryMoveIntroduceCycle<Entry extends SiteTreeEntry>(
    itemBeingMovedId: SiteContainerId,
    newParentId: SiteContainerId,
    siteTree: SiteTreeBase<Entry>,
): boolean {
    let currentContainerId: SiteContainerId | null = newParentId;

    // Pre-seed the item being moved into the set of visited IDs. In the above example,
    // this means that Section A is pre-seeded into the set of visited IDs, and as we
    // traverse up from Section C, we'll throw if we see Section A again.
    const visitedIds = new Set<SiteContainerId>([itemBeingMovedId]);

    while (currentContainerId !== null) {
        if (visitedIds.has(currentContainerId)) return true;

        const currentItem = siteTree.getEntry(currentContainerId);
        visitedIds.add(currentContainerId);

        currentContainerId = currentItem.parentId;
    }

    return false;
}
