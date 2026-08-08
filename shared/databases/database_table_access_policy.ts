import type {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.open_source.js";
import type {AccountId} from "~/shared/id/types/id_types.open_source.js";

export const emptyDatabaseTableAccessPolicy: LocalAccessPolicy = {
    type: "Local",
    accountGrantById: emptyMap,
    defaultGrant: null,
    urlGrant: null,
};

export function databaseTableAccessPolicyForCreator(accountId: AccountId): LocalAccessPolicy {
    return {
        type: "Local",
        accountGrantById: new Map([[accountId, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };
}
