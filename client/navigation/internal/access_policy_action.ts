import {
    AccessLevel,
    AccessPolicy,
    AccessPolicyAccountGrant,
    AccessPolicyDefaultGrant,
} from "~/shared/access/access_policy.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export type AccessPolicyAction =
    | {
          readonly type: "AddAccountGrants";
          readonly accountGrantById: ReadonlyMap<AccountId, AccessPolicyAccountGrant>;
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
          readonly defaultGrant: AccessPolicyDefaultGrant;
      }
    | {
          readonly type: "DeleteDefaultGrant";
      }
    | {
          readonly type: "SetDefaultGrantLevel";
          readonly level: AccessLevel;
      };

export function reduceAccessPolicy(
    accessPolicy: AccessPolicy,
    action: AccessPolicyAction,
): AccessPolicy {
    switch (action.type) {
        case "AddAccountGrants": {
            const newAccountGrantById = new Map(accessPolicy.accountGrantById);

            for (const [accountId, accountGrant] of action.accountGrantById) {
                if (newAccountGrantById.has(accountId)) continue;
                newAccountGrantById.set(accountId, accountGrant);
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
            if (accountGrant) {
                newAccountGrantById.set(action.accountId, {...accountGrant, level: action.level});
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
                    ? action.defaultGrant
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
                    accessPolicy.defaultGrant !== null
                        ? {...accessPolicy.defaultGrant, level: action.level}
                        : accessPolicy.defaultGrant,
            };
        }
        default:
            throw exhaustive(action);
    }
}
