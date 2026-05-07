import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSiteAccess} from "~/server/sites/data/authorize_site_access.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {DynamoGeneralRealtimeQueryResult} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoItemKey, DynamoItemPartitionKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {SiteOrSiteEntryModel} from "~/shared/sites/site_model.js";

/**
 * Get a site with all its items using realtime query format.
 *
 * Returns data in DynamoGeneralRealtimeQueryResult format which includes a
 * checkpoint for realtime synchronization.
 *
 * The result includes:
 *
 * - Site attributes (as SitePreviewModel)
 * - All containers (TopBar, SideBar, SideBarSection) as SiteItemModel
 * - All EntityRefs as SiteItemModel
 */
export async function getSite(
    context: ServerActionContext,
    {
        siteId,
        afterItemKey = null,
        consistency = "Eventual",
    }: {
        siteId: SiteId;
        afterItemKey?: DynamoItemKey | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<DynamoGeneralRealtimeQueryResult<SiteOrSiteEntryModel>> {
    const [, result] = await runAllPromises([
        authorizeSiteAccess(context, siteId, "View"),
        SitesTable.realtimeQuery(context, {
            consistency,
            partitionKey: {partitionType: "Site", siteId},
            paginate: {type: "FromStart", afterItemKey},
            limit: "All",
        }),
    ]);
    return result;
}

/**
 * Get the partition key for a site's realtime query. Used for comparing partition
 * keys in realtime events.
 */
export function getSiteRealtimePartitionKey(siteId: SiteId): DynamoItemPartitionKey {
    return SitesTable.getRealtimeQueryPartitionKey({partitionType: "Site", siteId});
}
