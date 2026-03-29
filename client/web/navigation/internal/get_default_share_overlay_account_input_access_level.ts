import {
    AccessLevel,
    EffectiveAccessPolicy,
    ResolvedAccessPolicy,
    maxAccessLevel,
} from "~/shared/access/access_policy.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * The default access level for `<ShareOverlayAccountInput>` is:
 *
 * 1. The merged access level from immediate/inherited `defaultGrant` if available
 * 2. `Edit` if there's any account grant already at `Edit` (it means someone
 *    discovered the hold-alt key trick)
 * 3. `Manage` otherwise
 *
 * We default to `Edit` if there's any account grant already at `Edit` as a
 * convenience to help the user avoid accidentally granting share access to a
 * person who shouldn't be allowed share access.
 */
export function getDefaultShareOverlyAccountInputAccessLevel(
    accessPolicy: ResolvedAccessPolicy,
    inheritedAccessPolicy: EffectiveAccessPolicy | null,
): AccessLevel {
    const defaultGrantLevel = maxAccessLevel(
        accessPolicy.defaultGrant?.level ?? null,
        inheritedAccessPolicy?.defaultGrant?.level ?? null,
    );
    if (defaultGrantLevel) return defaultGrantLevel;

    // Merge account grants by account with max access level, then use that merged map
    // to decide if any account has `Edit` access.
    const accountGrantLevelByAccountId = new Map<AccountId, AccessLevel>();

    for (const [accountId, accountGrant] of accessPolicy.accountGrantById) {
        accountGrantLevelByAccountId.set(
            accountId,
            maxAccessLevel(accountGrantLevelByAccountId.get(accountId) ?? null, accountGrant.level),
        );
    }

    for (const [accountId, accountGrant] of inheritedAccessPolicy?.accountGrantById ?? []) {
        accountGrantLevelByAccountId.set(
            accountId,
            maxAccessLevel(accountGrantLevelByAccountId.get(accountId) ?? null, accountGrant.level),
        );
    }

    for (const accountGrantLevel of accountGrantLevelByAccountId.values()) {
        if (accountGrantLevel === "Edit") return "Edit";
    }

    return "Manage";
}
