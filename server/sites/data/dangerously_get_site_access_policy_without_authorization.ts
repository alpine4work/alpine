import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getSiteItemForAuthorization} from "~/server/sites/data/internal/get_site_item_for_authorization.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {SiteId} from "~/shared/id/types/id_types.js";

export async function dangerouslyGetSiteAccessPolicyWithoutAuthorization(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<LocalAccessPolicy> {
    const siteItem = await getSiteItemForAuthorization(context, siteId, options);
    return siteItem.accessPolicy;
}
