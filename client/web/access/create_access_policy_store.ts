import {SiteRegistry} from "~/client/web/sites/site_registry.js";
import {AccessPolicy, ResolvedAccessPolicyWithGenerations} from "~/shared/access/access_policy.js";
import {AccessPolicyModel} from "~/shared/access/model/access_policy_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";
import {ConstStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";

export function createAccessPolicyStore(
    accessPolicy: AccessPolicyModel,
    siteRegistry: SiteRegistry,
): Store<ResolvedAccessPolicyWithGenerations> {
    switch (accessPolicy.data.type) {
        case "Local":
            return new ConstStore(accessPolicy.data);
        case "Site":
            return siteRegistry.getSiteStore(accessPolicy.data.site).map(site => ({
                ...site.accessPolicy,
                type: "Site",
                siteId: site.id,
            }));
        default:
            throw exhaustive(accessPolicy.data);
    }
}

export function createAccessPolicyStoreFromReferences(
    accessPolicy: AccessPolicy,
    siteById: ReadonlyMap<SiteId, SitePreviewModel>,
    siteRegistry: SiteRegistry,
): Store<ResolvedAccessPolicyWithGenerations> {
    switch (accessPolicy.type) {
        case "Local": {
            return new ConstStore(accessPolicy);
        }
        case "Site": {
            const site = assertExists(siteById.get(accessPolicy.siteId));
            return siteRegistry.getSiteStore(site).map(site => ({
                ...site.accessPolicy,
                type: "Site",
                siteId: site.id,
            }));
        }
        default:
            throw exhaustive(accessPolicy);
    }
}
