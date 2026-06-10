import {SiteSideBarSectionContainerId} from "~/shared/sites/site_entry_id.js";
import {SiteSideBarSectionModel} from "~/shared/sites/site_model.js";

export type CollapsedSectionsState = ReadonlyMap<
    SiteSideBarSectionContainerId,
    true | false | undefined
>;

export function isSectionCollapsed(
    collapsedSections: CollapsedSectionsState,
    row: {depth: number; entry: SiteSideBarSectionModel},
): true | false {
    const collapsedState = collapsedSections.get(row.entry.id);
    if (collapsedState === undefined) return getDefaultCollapseStateForSection(row);

    return collapsedState;
}

function getDefaultCollapseStateForSection(row: {
    depth: number;
    entry: SiteSideBarSectionModel;
}): true | false {
    // Sections at the root are not collapsed by default
    if (row.depth === 0) return false;

    // All nested sections are collapsed by default
    return true;
}
