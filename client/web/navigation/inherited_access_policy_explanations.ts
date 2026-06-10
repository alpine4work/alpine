import {AccessLevel} from "~/shared/access/access_policy.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * The description that shows (in a modal) when you try to perform some action
 * that's not allowed by the shareable entity's inherited access policy.
 *
 * For instance, if a parent has a default grant and you try to remove that default
 * grant from the share overlay you get the message from `DeleteDefaultGrant()`.
 *
 * The implementor of these messages should figure out where specifically access is
 * inherited from and tell that to the user.
 */
export type InheritedAccessPolicyExplanations = {
    readonly DeleteDefaultGrant: () => string;
    readonly SetDefaultGrantLevel: (accessLevel: AccessLevel) => string;
    readonly DeleteUrlGrant: () => string;
    readonly DeleteAccountGrant: (accountId: AccountId) => string;
    readonly SetAccountGrantLevel: (accountId: AccountId, accessLevel: AccessLevel) => string;
};
