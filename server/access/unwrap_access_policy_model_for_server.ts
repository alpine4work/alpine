import {ResolvedAccessPolicyWithGenerations} from "~/shared/access/access_policy.js";
import {AccessPolicyModel} from "~/shared/access/model/access_policy_model.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export function unwrapAccessPolicyModelForServer(
    accessPolicy: AccessPolicyModel,
): ResolvedAccessPolicyWithGenerations {
    switch (accessPolicy.data.type) {
        case "Local":
            return accessPolicy.data;
        case "Site":
            return {
                ...accessPolicy.data.site.initialData.accessPolicy,
                type: "Site",
                siteId: accessPolicy.data.site.id,
            };
        default:
            throw exhaustive(accessPolicy.data);
    }
}
