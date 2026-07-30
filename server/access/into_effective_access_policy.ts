import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    AccessPolicy,
    EffectiveAccessPolicy,
    ResolvedAccessPolicy,
} from "~/shared/access/access_policy.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Converts a raw access policy into an effective access policy. If the policy is
 * already an effective access policy, returns it unchanged.
 */
export async function intoEffectiveAccessPolicy(
    context: ServerMinimalActionContext,
    accessPolicy: AccessPolicy | ResolvedAccessPolicy,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<EffectiveAccessPolicy> {
    switch (accessPolicy.type) {
        case "Local":
            return accessPolicy;
        case "Site":
            return await context.sitesInjection.dangerouslyGetSiteAccessPolicyWithoutAuthorization(
                accessPolicy.siteId,
                options,
            );
        default:
            throw exhaustive(accessPolicy);
    }
}
