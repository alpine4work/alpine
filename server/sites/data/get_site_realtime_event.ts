import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {authorizeSiteAccess} from "~/server/sites/data/authorize_site_access.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {RynamoEventStub} from "~/shared/dynamo/rynamo_types.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {SiteId} from "~/shared/id/types/id_types.open_source.js";
import {RynamoSiteEvent} from "~/shared/sites/site_realtime_protocol.js";

/**
 * Allowed sort range types we may return from `getSiteRealtimeEvent`. Using a
 * `Record<...>` keyed by every possible sort range type so TypeScript forces us to
 * consider new sort ranges as they're added to `SitesTable`.
 */
const allowedSiteSortRangeTypesForGetSiteRealtimeEvent: Record<
    "Attributes" | "TopBar" | "SideBar" | "SideBarSection" | "Entity",
    boolean
> = {
    Attributes: true,
    TopBar: true,
    SideBar: true,
    SideBarSection: true,
    Entity: true,
};

/**
 * Converts realtime event stubs into full realtime event objects for a site. The
 * site's realtime durable object calls this for every event it broadcasts so the
 * connected clients receive the full item models — not just the opaque stubs.
 *
 * Authorization: the session actor must have at least `View` access on the site
 * referenced by the stubs. Stubs that point to items outside the authorized site
 * are rejected with `PermissionDeniedError`.
 */
export async function getSiteRealtimeEvent(
    context: ServerSessionActionContext,
    siteId: SiteId,
    events: ReadonlyArray<RynamoEventStub>,
): Promise<ReadonlyArray<RynamoSiteEvent>> {
    const [, actualEvents] = await runAllPromises([
        // Authorizing in parallel means the site read in `authorizeSiteAccess()` batches
        // with any DynamoDB reads from `SitesTable.getRealtimeEvent()`.
        authorizeSiteAccess(context, siteId, "View"),

        SitesTable.getRealtimeEvent(
            context,
            events.map(eventStub => {
                const itemKey = SitesTable.deserializeOpaqueItemKey(eventStub.item.key);

                // Stubs may only target items in the authorized site.
                if (
                    itemKey.partitionType === "Site" &&
                    itemKey.siteId === siteId &&
                    allowedSiteSortRangeTypesForGetSiteRealtimeEvent[itemKey.sortRangeType]
                ) {
                    return {...eventStub, itemKey};
                }

                throw new PermissionDeniedError(
                    "Can\u2019t get realtime event for item that\u2019s not associated with the designated site",
                );
            }),
        ),
    ]);

    return actualEvents as ReadonlyArray<RynamoSiteEvent>;
}
