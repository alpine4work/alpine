import type {ServerActionContext} from "~/server/context/server_action_context.js";
import type {AccessPolicy, LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export async function resolveDatabaseTableAccessPolicyForDurableObject(
    context: ServerActionContext,
    accessPolicy: AccessPolicy,
): Promise<LocalAccessPolicy> {
    switch (accessPolicy.type) {
        case "Local":
            return accessPolicy;
        case "Site":
            return await context.sitesInjection.dangerouslyGetSiteAccessPolicyWithoutAuthorization(
                accessPolicy.siteId,
                {consistency: "StrongWithinCache"},
            );
        default:
            throw exhaustive(accessPolicy);
    }
}
