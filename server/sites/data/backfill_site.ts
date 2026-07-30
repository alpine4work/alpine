import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeSiteAccess} from "~/server/sites/data/authorize_site_access.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {RynamoBackfillResult} from "~/shared/dynamo/rynamo_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {SiteOrSiteEntryModel} from "~/shared/sites/site_model.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

/**
 * Backfill site realtime updates after reconnecting to WebSocket.
 *
 * Called when a client reconnects to catch up on any changes that occurred while
 * disconnected.
 */
export async function backfillSite(
    context: ServerActionContext,
    {
        siteId,
        checkpoint,
    }: {
        siteId: SiteId;
        checkpoint: ServerSynchronizationCheckpoint;
    },
): Promise<RynamoBackfillResult<SiteOrSiteEntryModel>> {
    const [, result] = await runAllPromises([
        authorizeSiteAccess(context, siteId, "View"),
        SitesTable.backfillRealtimeQuery(context, {
            partitionKey: {partitionType: "Site", siteId},
            checkpoint,
        }),
    ]);
    return result;
}
