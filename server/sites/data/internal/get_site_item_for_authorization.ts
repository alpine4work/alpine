import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {SiteAttributesItem, SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {createSiteNotFoundError} from "~/shared/sites/site_error_messages.js";

export const SiteItemAuthorizationCache = new DynamoContextCache<SiteId, SiteAttributesItem | null>(
    {
        // Allow sharing this cache because the loaded DynamoDB item doesn't depend on who
        // the actor is.
        whenActorChanges: "DangerouslyShare",
    },
);

/**
 * Get a site's attributes for authorization purposes. Throws NotFoundError if the
 * site doesn't exist.
 */
export async function getSiteItemForAuthorization(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<SiteAttributesItem> {
    const item = await getSiteItemForAuthorizationIfExists(context, siteId, options);

    if (!item) throw createSiteNotFoundError(siteId);

    return item;
}

/**
 * Get a site's attributes for authorization purposes. Throws NotFoundError if the
 * site doesn't exist.
 */
export async function getSiteItemForAuthorizationIfExists(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<SiteAttributesItem | null> {
    return SiteItemAuthorizationCache.get(context, consistency, siteId, consistency =>
        SitesTable.getItemIfExists(
            context,
            {
                partitionType: "Site",
                sortRangeType: "Attributes",
                siteId,
            },
            {consistency},
        ),
    );
}
