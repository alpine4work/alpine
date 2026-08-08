import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSiteAccessIfPossible} from "~/server/sites/data/authorize_site_access.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {DynamoItemKey, DynamoItemPartitionKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {RynamoQueryResult} from "~/shared/dynamo/rynamo_types.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {SiteId} from "~/shared/id/types/id_types.open_source.js";
import {SiteOrSiteEntryModel} from "~/shared/sites/site_model.js";

/**
 * Get a site with all its items using realtime query format.
 *
 * Returns data in RynamoQueryResult format which includes a checkpoint for
 * realtime synchronization.
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
): Promise<RynamoQueryResult<SiteOrSiteEntryModel>> {
    return unwrapResult(await getSiteIfPossible(context, {siteId, afterItemKey, consistency}));
}

export async function getSiteIfPossible(
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
): Promise<Result<RynamoQueryResult<SiteOrSiteEntryModel>, ErrorBase>> {
    const [authorizationResult, result] = await runAllPromises([
        authorizeSiteAccessIfPossible(context, siteId, "View"),
        captureResultPromise(
            SitesTable.realtimeQuery(context, {
                consistency,
                partitionKey: {partitionType: "Site", siteId},
                paginate: {type: "FromStart", afterItemKey},
                limit: "All",
            }),
        ),
    ]);
    if (!authorizationResult.ok) return {ok: false, error: authorizationResult.error};

    // If the authorization succeeded, the result should be a valid RynamoQueryResult.
    assert(result.ok);
    return result;
}

/**
 * Get the partition key for a site's realtime query. Used for comparing partition
 * keys in realtime events.
 */
export function getSiteRealtimePartitionKey(siteId: SiteId): DynamoItemPartitionKey {
    return SitesTable.getRealtimeQueryPartitionKey({partitionType: "Site", siteId});
}
