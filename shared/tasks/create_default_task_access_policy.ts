import {AccessPolicy} from "~/shared/access/access_policy.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export function createDefaultTaskAccessPolicy(creatorId: AccountId): AccessPolicy {
    return {
        accountGrantById: new Map([[creatorId, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };
}
