import {
    AccessLevel,
    AccessPolicy,
    AccessPolicyAccountGrant,
    AccessPolicyDefaultGrant,
    AccessPolicyUrlGrant,
    getAccountAccessPolicyManageGeneration,
} from "~/shared/access/access_policy.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export type AccessPolicyAction =
    | {
          readonly type: "AddAccountGrants";
          readonly accountGrantById: ReadonlyMap<
              AccountId,
              DistributiveOmit<AccessPolicyAccountGrant, "generation">
          >;
      }
    | {
          readonly type: "DeleteAccountGrant";
          readonly accountId: AccountId;
      }
    | {
          readonly type: "SetAccountGrantLevel";
          readonly accountId: AccountId;
          readonly level: AccessLevel;
      }
    | {
          readonly type: "AddDefaultGrant";
          readonly defaultGrant: DistributiveOmit<AccessPolicyDefaultGrant, "generation">;
      }
    | {
          readonly type: "DeleteDefaultGrant";
      }
    | {
          readonly type: "SetDefaultGrantLevel";
          readonly level: AccessLevel;
      }
    | {
          readonly type: "AddUrlGrant";
          readonly urlGrant: AccessPolicyUrlGrant;
      }
    | {
          readonly type: "DeleteUrlGrant";
      }
    | {
          readonly type: "SetUrlGrantLevel";
          readonly level: "View";
      }
    | {
          readonly type: "DeleteDefaultGrantAndUrlGrant";
      };

export function reduceAccessPolicy(
    actorAccountId: AccountId,
    accessPolicy: AccessPolicy,
    action: AccessPolicyAction,
): AccessPolicy {
    const actorManageGeneration = getAccountAccessPolicyManageGeneration(
        actorAccountId,
        accessPolicy,
    );

    switch (action.type) {
        case "AddAccountGrants": {
            const newAccountGrantById = new Map(accessPolicy.accountGrantById);

            for (const [accountId, accountGrant] of action.accountGrantById) {
                if (newAccountGrantById.has(accountId)) continue;

                if (accountGrant.level !== "Manage") {
                    newAccountGrantById.set(accountId, {level: accountGrant.level});
                } else {
                    newAccountGrantById.set(accountId, {
                        level: accountGrant.level,
                        generation: actorManageGeneration + 1,
                    });
                }
            }

            return {
                ...accessPolicy,
                accountGrantById: newAccountGrantById,
            };
        }
        case "DeleteAccountGrant": {
            const newAccountGrantById = new Map(accessPolicy.accountGrantById);

            newAccountGrantById.delete(action.accountId);

            return {
                ...accessPolicy,
                accountGrantById: newAccountGrantById,
            };
        }
        case "SetAccountGrantLevel": {
            const newAccountGrantById = new Map(accessPolicy.accountGrantById);

            const accountGrant = newAccountGrantById.get(action.accountId);
            if (accountGrant?.level !== action.level) {
                if (action.level !== "Manage") {
                    newAccountGrantById.set(action.accountId, {level: action.level});
                } else {
                    newAccountGrantById.set(action.accountId, {
                        level: action.level,
                        generation: actorManageGeneration + 1,
                    });
                }
            }

            return {
                ...accessPolicy,
                accountGrantById: newAccountGrantById,
            };
        }
        case "AddDefaultGrant": {
            return {
                ...accessPolicy,
                defaultGrant: !accessPolicy.defaultGrant
                    ? action.defaultGrant.level !== "Manage"
                        ? action.defaultGrant
                        : {
                              level: action.defaultGrant.level,
                              generation: actorManageGeneration + 1,
                          }
                    : accessPolicy.defaultGrant,
            };
        }
        case "DeleteDefaultGrant": {
            return {
                ...accessPolicy,
                defaultGrant: null,
            };
        }
        case "SetDefaultGrantLevel": {
            return {
                ...accessPolicy,
                defaultGrant:
                    accessPolicy.defaultGrant?.level !== action.level
                        ? action.level !== "Manage"
                            ? {level: action.level}
                            : {level: action.level, generation: actorManageGeneration + 1}
                        : accessPolicy.defaultGrant,
            };
        }
        case "AddUrlGrant": {
            return {
                ...accessPolicy,
                urlGrant: !accessPolicy.urlGrant ? action.urlGrant : accessPolicy.urlGrant,
            };
        }
        case "DeleteUrlGrant": {
            return {
                ...accessPolicy,
                urlGrant: null,
            };
        }
        case "SetUrlGrantLevel": {
            return {
                ...accessPolicy,
                urlGrant:
                    accessPolicy.urlGrant?.level !== action.level
                        ? {level: action.level}
                        : accessPolicy.urlGrant,
            };
        }
        case "DeleteDefaultGrantAndUrlGrant": {
            return {
                ...accessPolicy,
                defaultGrant: null,
                urlGrant: null,
            };
        }
        default:
            throw exhaustive(action);
    }
}
