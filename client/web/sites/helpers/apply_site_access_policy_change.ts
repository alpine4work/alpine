import {AppContext} from "~/client/web/context/app_context.js";
import {ResolvedAccessPolicyWithGenerations} from "~/shared/access/access_policy.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {updateSiteAccessPolicy} from "~/shared/rpc/sites_rpc_definitions.js";
import {SiteOrSiteEntryModel} from "~/shared/sites/site_model.js";

/**
 * Apply a site-level access policy change initiated from an entity whose resolved
 * access policy lives on a site. Entity views narrow
 * `accessPolicy.type === "Site"` in their `onAccessPolicyChange` callback and
 * delegate here so the site is updated and the optimistic site tree picks up the
 * resulting events.
 */
export async function applySiteAccessPolicyChange({
    context,
    accessPolicy,
    handleEventForSite,
}: {
    context: AppContext;
    accessPolicy: ResolvedAccessPolicyWithGenerations & {type: "Site"};
    handleEventForSite: (events: ReadonlyArray<RynamoEvent<SiteOrSiteEntryModel>>) => void;
}): Promise<void> {
    const {events} = await updateSiteAccessPolicy(context, {
        siteId: accessPolicy.siteId,
        accessPolicy: {
            type: "Local",
            accountGrantById: accessPolicy.accountGrantById,
            defaultGrant: accessPolicy.defaultGrant,
            urlGrant: accessPolicy.urlGrant,
        },
    });
    handleEventForSite([events]);
}
