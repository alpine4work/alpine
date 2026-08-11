import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getSiteItemForAuthorization} from "~/server/sites/data/internal/get_site_item_for_authorization.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {SiteId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get a site's access policy together with the version that orders it, without
 * authorizing the actor against the site. Dangerous for the same reason as
 * `dangerouslyGetSiteAccessPolicyWithoutAuthorization`: the caller must only use
 * the policy for authorization decisions or replicate it to a trusted destination
 * (e.g. a database group durable object), never surface it to the actor.
 */
export async function dangerouslyGetSiteAccessPolicyReplicaWithoutAuthorization(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{accessPolicy: LocalAccessPolicy; version: number}> {
    const siteItem = await getSiteItemForAuthorization(context, siteId, options);
    return {
        accessPolicy: siteItem.accessPolicy,
        version: siteItem.updateLockVersion ?? 0,
    };
}
