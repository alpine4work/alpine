import {SiteId} from "~/shared/id/types/id_types.open_source.js";
import {TaskCollectionModelData} from "~/shared/tasks/model/task_collection_model.js";

/**
 * Get all the `SiteId`s referenced by a task collection model.
 *
 * `prepareTaskCollectionForClient()` will replace accounts and sites we're not
 * allowed to see with `unknownSiteId`. So we skip over any sites with an unknown
 * `SiteId` in this function.
 */
export function collectReferencedIdsFromTaskCollectionModelData(
    siteIds: Set<SiteId>,
    collection: TaskCollectionModelData,
) {
    if (collection.accessPolicy?.value.type === "Site") {
        siteIds.add(collection.accessPolicy.value.siteId);
    }
}
