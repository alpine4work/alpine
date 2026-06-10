import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {AccessPolicyModel} from "~/shared/access/model/access_policy_model.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Converts a raw access policy into an access policy model. In practice, this
 * means resolving the site preview if the access policy is a site policy.
 */
export async function intoAccessPolicyModel(
    context: ServerMinimalActionContext,
    accessPolicy: AccessPolicy,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<AccessPolicyModel> {
    switch (accessPolicy.type) {
        case "Local":
            return new AccessPolicyModel(accessPolicy);
        case "Site":
            return new AccessPolicyModel({
                type: "Site",
                site: await context.sitesInjection.getSitePreview(accessPolicy.siteId, options),
            });
        default:
            throw exhaustive(accessPolicy);
    }
}
