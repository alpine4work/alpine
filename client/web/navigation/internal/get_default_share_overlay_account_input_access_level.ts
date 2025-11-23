import {AccessLevel, AccessPolicy} from "~/shared/access/access_policy.js";

/**
 * The default access level for `<ShareOverlayAccountInput>` is:
 *
 * 1. The access level from `defaultGrant` if available
 * 2. `Edit` if there's any account grant already at `Edit` (it means someone
 *    discovered the hold-alt key trick)
 * 3. `Manage` otherwise
 *
 * We default to `Edit` if there's any account grant already at `Edit` as a
 * convenience to help the user avoid accidentally granting share access to a
 * person who shouldn't be allowed share access.
 */
export function getDefaultShareOverlyAccountInputAccessLevel(
    accessPolicy: AccessPolicy,
): AccessLevel {
    if (accessPolicy.defaultGrant) return accessPolicy.defaultGrant.level;

    for (const accountGrant of accessPolicy.accountGrantById.values()) {
        if (accountGrant.level === "Edit") return "Edit";
    }

    return "Manage";
}
