import {AccessPolicy, ResolvedAccessPolicy} from "~/shared/access/access_policy.js";
import {SiteId} from "~/shared/id/types/id_types.js";

/**
 * If the access policy inherits from a site, return that site's id. Otherwise
 * `null`. Used by call sites that record search affinity to opt into the 80%
 * cascade-to-site bonus when the entity lives in a site.
 */
export function getSiteIdFromAccessPolicyIfExists(
    accessPolicy: AccessPolicy | ResolvedAccessPolicy,
): SiteId | null {
    return accessPolicy.type === "Site" ? accessPolicy.siteId : null;
}
