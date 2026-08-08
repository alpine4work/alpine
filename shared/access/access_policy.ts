import {createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {okResult} from "~/shared/helpers/control/ok_result.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {clamp} from "~/shared/helpers/number/clamp.open_source.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.open_source.js";
import {AccountId, SiteId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType, UnionSchema} from "~/shared/schema/schema.open_source.js";

/**
 * Level of access someone may have against an entity in our system.
 *
 * - `View`: The person can view the entity but can't do anything else.
 *
 * - `Comment`: The person can view and comment on the entity but can't do anything
 *   else.
 *
 * - `Edit`: The person can make any change to the entity but can't make certain
 *   changes that require an extra level of privilege that require the `Manage`
 *   access level (for example, editing the access policy).
 *
 * - `Manage`: The person can do anything to the entity.
 */
export type AccessLevel = SchemaType<typeof AccessLevelSchema>;

export const allAccessLevels = ["View", "Comment", "Edit", "Manage"] as const;

export const AccessLevelSchema = Schema.enum(allAccessLevels);

export function isAccessLevel(value: string): value is AccessLevel {
    return allAccessLevels.includes(value as AccessLevel);
}

/**
 * Does someone's access level high enough to take an action at the expected access
 * level?
 */
export function hasAccessLevel(
    actualLevel: AccessLevel | null,
    expectedLevel: AccessLevel | null,
): boolean {
    if (actualLevel === null) return expectedLevel === null;
    if (expectedLevel === null) return true;

    const actualIndex = allAccessLevels.indexOf(actualLevel);
    const expectedIndex = allAccessLevels.indexOf(expectedLevel);
    assert(actualIndex >= 0 && expectedIndex >= 0);
    return actualIndex >= expectedIndex;
}

/**
 * Return the higher of the two access levels. If the access level is null then
 * null is considered the lower of the two.
 */
export function maxAccessLevel(level1: AccessLevel, level2: AccessLevel): AccessLevel;
export function maxAccessLevel(level1: AccessLevel, level2: AccessLevel | null): AccessLevel;
export function maxAccessLevel(level1: AccessLevel | null, level2: AccessLevel): AccessLevel;
export function maxAccessLevel(
    level1: AccessLevel | null,
    level2: AccessLevel | null,
): AccessLevel | null;
export function maxAccessLevel(
    level1: AccessLevel | null,
    level2: AccessLevel | null,
): AccessLevel | null {
    if (level1 === null) return level2;
    if (level2 === null) return level1;

    const index1 = allAccessLevels.indexOf(level1);
    const index2 = allAccessLevels.indexOf(level2);
    assert(index1 >= 0 && index2 >= 0);

    if (index2 > index1) return level2;
    return level1;
}

/**
 * Return the lower of the two access levels. If the access level is null then null
 * is considered the lower of the two.
 */
export function minAccessLevel(level1: AccessLevel, level2: AccessLevel): AccessLevel;
export function minAccessLevel(
    level1: AccessLevel | null,
    level2: AccessLevel | null,
): AccessLevel | null;
export function minAccessLevel(
    level1: AccessLevel | null,
    level2: AccessLevel | null,
): AccessLevel | null {
    if (level1 === null) return level1;
    if (level2 === null) return level2;

    const index1 = allAccessLevels.indexOf(level1);
    const index2 = allAccessLevels.indexOf(level2);
    assert(index1 >= 0 && index2 >= 0);

    if (index2 < index1) return level2;
    return level1;
}

/**
 * Compare two access levels for sorting. Lower access levels will appear first.
 * For example `View` will appear before `Edit`.
 */
export function compareAccessLevel(
    level1: AccessLevel | null,
    level2: AccessLevel | null,
): -1 | 0 | 1 {
    if (level1 === null) return level2 === null ? 0 : -1;
    if (level2 === null) return level1 === null ? 0 : 1;

    const index1 = allAccessLevels.indexOf(level1);
    const index2 = allAccessLevels.indexOf(level2);
    assert(index1 >= 0 && index2 >= 0);

    return clamp(-1, index1 - index2, 1) as -1 | 0 | 1;
}

/**
 * Access grant to a single account.
 */
export type AccessPolicyAccountGrant = SchemaType<typeof AccessPolicyAccountGrantSchema>;

const AccessPolicyAccountGrantSchema = UnionSchema.unionWithKey("level", {
    Manage: Schema.object({
        level: Schema.value("Manage"),

        /**
         * Imagine the scenario, Alice invites Bob with manage access. Should Bob be able
         * to revoke Alice's manage access? We believe the main use for this pattern is
         * when Bob is a malicious actor who wants to take over whatever target he was
         * invited to. Therefore, we've decided you should not be able to remove
         * permissions from the account that invited you.
         *
         * Now let's say Alice invites Bob with manage permissions and Bob invites Carol
         * with manage permissions. Carol can't revoke Bob's manage permissions but can
         * Carol revoke Alice's manage permissions? If Bob and Carol are both malicious
         * actors working in concert there's no real difference to our first example. Bob
         * worked around not being able to change Alice's permissions by recruiting a
         * friend Carol. Therefore, not only should you not be allowed to remove
         * permissions from the account that invited you but you also shouldn't be able to
         * remove permissions from the account that invited the account that invited you.
         * This applies recursively up to the creator of the entity.
         *
         * We implement this with the concept of "generations". If Alice creates an entity
         * she has manage permissions at generation 0. If Alice invites Bob with manage
         * permissions then Bob has manage permissions at generation 1. If Bob invites
         * Carol with manage permissions then Carol has manage permissions at generation 2.
         * Users at higher generation numbers can't revoke the permissions of users at
         * lower generations. With this rule we defend against a malicious invitee
         * completely taking over an entity.
         *
         * We only track generations for users with `Manage` access since only users with
         * `Manage` access can share. If someone sets a `defaultGrant` to `Manage` then the
         * `defaultGrant` gets a generation. Users with `Manage` access through the
         * `defaultGrant` shouldn't be allowed to change the access of whoever setup the
         * `defaultGrant`.
         *
         * We track generations with an integer instead of keeping track of the inviter
         * account so we can gracefully handle the inviter being removed from the access
         * policy. For example, if Alice invites Bob and Bob invites Carol then Alice
         * removes Bob's access, Carol still shouldn't be allowed to revoke Alice's access.
         *
         * Anyone is allowed to change the `defaultGrant` even if they have a higher
         * `generation`.
         */
        generation: Schema.integer.min(0).default(0),
    }),
    Edit: Schema.object({level: Schema.value("Edit")}),
    Comment: Schema.object({level: Schema.value("Comment")}),
    View: Schema.object({level: Schema.value("View")}),
});

assertEqualTypes<AccessPolicyAccountGrant["level"], AccessLevel>();

/**
 * Access granted to everyone in the space.
 *
 * Eventually we want to add a "guest" account type to spaces which'll won't be
 * covered by the default grant. Guests will only have access to entities they're
 * specifically granted access to.
 */
export type AccessPolicyDefaultGrant = SchemaType<typeof AccessPolicyDefaultGrantSchema>;

const AccessPolicyDefaultGrantSchema = UnionSchema.unionWithKey("level", {
    Manage: Schema.object({
        level: Schema.value("Manage"),
        // See the documentation on `AccessPolicyAccountGrant`'s `generation` property for
        // more information about what this is.
        generation: Schema.integer.min(0).default(0),
    }),
    Edit: Schema.object({level: Schema.value("Edit")}),
    Comment: Schema.object({level: Schema.value("Comment")}),
    View: Schema.object({level: Schema.value("View")}),
});

/**
 * Access granted to everyone who knows the URL of the entity in question. This
 * grant allows users to share content with people outside of their space or who
 * don't have an Alpine account at all.
 *
 * After enabling a URL grant, the user is responsible for keeping the URL secure
 * if they care about the privacy of their document. We ask search engines not to
 * index the URL so the user's information doesn't leak.
 *
 * If an entity has a `urlGrant` but doesn't have a `defaultGrant` then members of
 * the space are allowed to view the entity but only if they have the URL. The
 * entity won't be made available in search and won't appear on the algorithmic
 * home feed.
 */
export type AccessPolicyUrlGrant = SchemaType<typeof AccessPolicyUrlGrantSchema>;

const AccessPolicyUrlGrantSchema = Schema.object({
    level: Schema.value("View"),
});

const AccessPolicyBase = Schema.object({
    accountGrantById: Schema.map(Schema.id<AccountId>(), AccessPolicyAccountGrantSchema),
    defaultGrant: AccessPolicyDefaultGrantSchema.nullable(),
    urlGrant: AccessPolicyUrlGrantSchema.nullable().default(null),
});
type AccessPolicyBase = SchemaType<typeof AccessPolicyBase>;

/**
 * Local access policy with explicit grants to accounts and/or everyone in the
 * space.
 */
export type LocalAccessPolicy = SchemaType<typeof LocalAccessPolicySchema>;

export const LocalAccessPolicySchema = AccessPolicyBase.merge(
    Schema.object({
        type: Schema.value("Local"),
    }),
);

/**
 * Site access policy - site entities inherit their access from a site. To evaluate
 * access, fetch the site's access policy and evaluate that.
 */
export type SiteAccessPolicy = SchemaType<typeof SiteAccessPolicySchema>;

export const SiteAccessPolicySchema = Schema.object({
    type: Schema.value("Site"),
    siteId: Schema.id<SiteId>(),
});

/**
 * Policy designating who is allowed to interact with some entity and what they are
 * allowed to do.
 *
 * Can be either:
 *
 * - `Local`: Explicit access grants defined on this entity
 * - `Site`: Entity inherits access from a site
 */
export type AccessPolicy = LocalAccessPolicy | SiteAccessPolicy;

export const AccessPolicySchema = Schema.union({
    Local: LocalAccessPolicySchema,
    Site: SiteAccessPolicySchema,
}).defaultVariant("Local");

export const AccessPolicyRegister = createCrdtRegister(AccessPolicySchema);

export type EffectiveAccessPolicy = {
    readonly accountGrantById: ReadonlyMap<AccountId, AccessPolicyAccountGrantWithoutGeneration>;
    readonly defaultGrant: AccessPolicyDefaultGrantWithoutGeneration | null;
    readonly urlGrant: AccessPolicyUrlGrant | null;
};
export type EffectiveAccessPolicyWithGenerations = AccessPolicyBase;

assertAssignableTypes<EffectiveAccessPolicyWithGenerations, EffectiveAccessPolicy>();

/**
 * The resolved access policy represents the unwrapped `AccessPolicy` for an
 * entity. The "unwrapped" part means that, if the access policy was a site, the
 * resolved access policy includes the site's permission grants.
 */
export type ResolvedAccessPolicy = EffectiveAccessPolicy &
    (
        | {
              type: "Local";
          }
        | {
              type: "Site";
              siteId: SiteId;
          }
    );

export type ResolvedAccessPolicyWithGenerations = AccessPolicyBase &
    (
        | {
              type: "Local";
          }
        | {
              type: "Site";
              siteId: SiteId;
          }
    );

assertAssignableTypes<ResolvedAccessPolicyWithGenerations, ResolvedAccessPolicy>();

/**
 * `AccessPolicyAccountGrant` but without the `generation` property for grants with
 * a `Manage` access level.
 */
export type AccessPolicyAccountGrantWithoutGeneration = DistributiveOmit<
    AccessPolicyAccountGrant,
    "generation"
>;

/**
 * `AccessPolicyDefaultGrant` but without the `generation` property for grants with
 * a `Manage` access level.
 */
export type AccessPolicyDefaultGrantWithoutGeneration = DistributiveOmit<
    AccessPolicyDefaultGrant,
    "generation"
>;

/**
 * Get the access level of the provided `AccountId` assuming the `AccountId` has
 * access to the space. Which means we can use the space's `defaultGrant` if
 * there's no account grant.
 *
 * Note: This function only works with local access policies. For site access
 * policies, you must first resolve the site's access policy.
 */
export function getAccountAccessLevelAssumingSpaceAccess(
    accessPolicy: EffectiveAccessPolicy,
    accountId: AccountId | null | undefined,
): AccessLevel | null {
    const accessLevels: Array<AccessLevel> = [];

    // If there's a URL grant than everyone gets that access level even if they're
    // anonymous.
    if (accessPolicy.urlGrant !== null) accessLevels.push(accessPolicy.urlGrant.level);

    if (typeof accountId === "string") {
        // You only get the default grant if your account is a member of the space. Which
        // this function assumes.
        if (accessPolicy.defaultGrant !== null) accessLevels.push(accessPolicy.defaultGrant.level);

        const accountGrant = accessPolicy.accountGrantById.get(accountId);
        if (accountGrant !== undefined) accessLevels.push(accountGrant.level);
    }

    if (accessLevels.length === 0) return null;

    let accessLevel = accessLevels[0]!;

    for (let i = 1; i < accessLevels.length; i++) {
        accessLevel = maxAccessLevel(accessLevel, accessLevels[i]!);
    }

    return accessLevel;
}

export function getAccountAccessPolicyManageGeneration(
    accountId: AccountId,
    accessPolicy: ResolvedAccessPolicyWithGenerations,
): number {
    const accountGrant = accessPolicy.accountGrantById.get(accountId);

    if (accountGrant?.level === "Manage" && accessPolicy.defaultGrant?.level === "Manage") {
        return Math.min(accountGrant.generation, accessPolicy.defaultGrant.generation);
    } else if (accountGrant?.level === "Manage") {
        return accountGrant.generation;
    } else if (accessPolicy.defaultGrant?.level === "Manage") {
        return accessPolicy.defaultGrant.generation;
    }

    // If the account isn't present in the `AccessPolicy` at a `Manage` access level
    // then it gets a generation that's one greater than the max generation of all
    // `Manage` grants.
    //
    // Normally, you can only update an access policy if you have manage access within
    // that access policy. However, for some entities like tasks that have an effective
    // access policy (which includes permissions from the parent task and task
    // collections) with greater permissions than the immediate access policy an
    // account may be modifying the access policy without themselves being in the
    // access policy.

    let maxGeneration = -1;

    for (const accountGrant of accessPolicy.accountGrantById.values()) {
        if (accountGrant.level === "Manage" && maxGeneration < accountGrant.generation) {
            maxGeneration = accountGrant.generation;
        }
    }

    return maxGeneration + 1;
}

export type ValidateAccessPolicyUpdateResult =
    | {ok: true}
    | {
          ok: false;
          reason:
              | "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation"
              | "Can\u2019t revoke manage access from an account with a manage generation less than our actor"
              | "Can\u2019t set new default grant manage generation to be less than or equal to our actor\u2019s manage generation"
              | "Can\u2019t update access policy so that no one has manage access"
              | "Can\u2019t reorder manage grant generations";
      };

/**
 * Validate that an access policy update is allowed for the given actor. This
 * performs critical authorization logic so we must run this on the backend when an
 * access policy is updated to make sure the update is safe.
 *
 * IMPORTANT: You must first validate that `actorAccountId` has manage access to
 * the entity. If the actor is adding the entity to a site or removing from a site,
 * you must also validate that the actor has Manage access in the new policy.
 *
 * This logic adheres to the following rules:
 *
 * 1. An account with Manage access has an effective generation equal to the
 *    `min(account.gen, defaultGrant.gen)`.
 * 2. Actors can only set Manage grants at generations strictly greater than their
 *    effective generation.
 * 3. Actors cannot manage/update Manage grants at generations less than their
 *    effective generation.
 * 4. The policy must always have at least one manager
 */
export function validateAccessPolicyUpdate(
    actorAccountId: AccountId,
    oldAccessPolicy: ResolvedAccessPolicyWithGenerations,
    newAccessPolicy: ResolvedAccessPolicyWithGenerations,
    {
        isAccountRemovedFromSpace,
    }: {
        // Accounts that were removed from the space can't manage the entity anymore, so
        // their stale manage generations shouldn't constrain the update. For example, when
        // moving an entity into a site whose policy doesn't include a removed senior
        // manager, dropping that manager shouldn't read as an illegal escalation.
        //
        // IMPORTANT: This callback is only consulted for accounts with a `Manage` grant in
        // either the old or new policy. Callers only need to provide space membership for
        // managers.
        isAccountRemovedFromSpace?: (accountId: AccountId) => boolean;
    } = {},
): ValidateAccessPolicyUpdateResult {
    const actorManageGenerationInOldPolicy = getAccountAccessPolicyManageGeneration(
        actorAccountId,
        oldAccessPolicy,
    );
    const actorManageGenerationInNewPolicy = getAccountAccessPolicyManageGeneration(
        actorAccountId,
        newAccessPolicy,
    );

    // Because we test that the actor has Manage access in the old policy outside of
    // this method, we know that if they don't have Manage access via the
    // `accountGrantById` or by the default grant, then they must have inherited Manage
    // access some other way.
    const assumingActorInheritedManageAccess =
        oldAccessPolicy.accountGrantById.get(actorAccountId)?.level !== "Manage" &&
        oldAccessPolicy.defaultGrant?.level !== "Manage";

    // Do any of the account grants in the NEW access policy have a Manage access
    // level?
    let hasManageAccessLevelAccountGrant = false;

    // If this loop runs to completion (without returning an error) then we know that
    // all accounts who had manage access granted or revoked were done so at a
    // generation greater than or equal to the current actor's manage generation in the
    // new policy.
    //
    // We don't yet know anything about
    //
    // 1.  Accounts that have manage access in the old and new policy
    // 2.  Accounts with manage access in the old policy that were removed in the new
    //     policy.
    for (const [accountId, newAccountGrant] of newAccessPolicy.accountGrantById) {
        // If the account was removed from the space, we don't need to validate generation
        // rules. Although, it's important to note that if the removed account is later
        // added back to the space, there may be unexpected behavior. For example, the
        // actor might have promoted the account to a manage generation below their own
        // (the removed account could remove the actor if re-added). These are edge cases
        // that we don't need to design for.
        if (isAccountRemovedFromSpace?.(accountId)) continue;

        hasManageAccessLevelAccountGrant ||= hasAccessLevel(newAccountGrant.level, "Manage");

        const oldAccountGrant = oldAccessPolicy.accountGrantById.get(accountId);

        // Make sure that we're not:
        //
        // 1. Setting a new manage generation to one less than or equal to our own
        // 2. Revoking access for a manage generation less than our own
        if (newAccountGrant.level === "Manage" && oldAccountGrant?.level !== "Manage") {
            if (
                !assumingActorInheritedManageAccess &&
                newAccountGrant.generation <= actorManageGenerationInNewPolicy
            ) {
                return {
                    ok: false,
                    reason: "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
                };
            }
        } else if (newAccountGrant.level !== "Manage" && oldAccountGrant?.level === "Manage") {
            // We don't need to check if the actor has inherited access here. If the actor had
            // inherited access in the old policy, their generation is greater than the largest
            // manage generation in the old policy. By definition, all grants in the old policy
            // are less than the inherited actor's generation.
            if (oldAccountGrant.generation < actorManageGenerationInOldPolicy) {
                return {
                    ok: false,
                    reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
                };
            }
        }
    }

    // After the following loop, we know:
    //
    // 1. All accounts who had manage access granted or revoked were done so at a
    //    generation greater than or equal to the current actor's manage generation in
    //    the new policy.
    // 2. There were no managers that were removed from the old policy who were more
    //    senior than the current actor.
    for (const [accountId, oldAccountGrant] of oldAccessPolicy.accountGrantById) {
        // We visited this in the above loop, no need to visit again
        if (newAccessPolicy.accountGrantById.has(accountId)) continue;

        // If the account was removed from the space, we don't need to validate generation
        // rules. Although, it's important to note that if the removed account is later
        // added back to the space, there may be unexpected behavior. For example, the
        // actor might have promoted the account to a manage generation below their own
        // (the removed account could remove the actor if re-added). These are edge cases
        // that we don't need to design for.
        if (isAccountRemovedFromSpace?.(accountId)) continue;

        // Make sure that we're not revoking access for a manage generation less than our
        // own.
        if (
            oldAccountGrant.level === "Manage" &&
            // We don't need to check if the actor has inherited access here. If the actor had
            // inherited access in the old policy, their generation is greater than the largest
            // manage generation in the old policy. By definition, all grants in the old policy
            // are less than the inherited actor's generation.
            oldAccountGrant.generation < actorManageGenerationInOldPolicy
        ) {
            return {
                ok: false,
                reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
            };
        }
    }

    const hasManageAccessLevel =
        hasManageAccessLevelAccountGrant ||
        (newAccessPolicy.defaultGrant &&
            hasAccessLevel(newAccessPolicy.defaultGrant.level, "Manage"));

    // Make sure someone has manage access in the new access policy.
    if (!hasManageAccessLevel) {
        return {
            ok: false,
            reason: "Can\u2019t update access policy so that no one has manage access",
        };
    }

    const oldManageGrantsLessThanActorGeneration = getManageGrantsLessThanActorGeneration(
        oldAccessPolicy,
        actorManageGenerationInOldPolicy,
        isAccountRemovedFromSpace,
    );
    const newManageGrantsLessThanActorGeneration = getManageGrantsLessThanActorGeneration(
        newAccessPolicy,
        actorManageGenerationInNewPolicy,
        isAccountRemovedFromSpace,
    );

    // At this point in the validation logic, we know that:
    //
    // 1. All accounts who had manage access granted or revoked were done so at a
    //    generation greater than or equal to the current actor's manage generation in
    //    the new policy (they didn't illegally promote/demote someone).
    // 2. There were no managers that were removed from the old policy who were more
    //    senior than the current actor (they didn't illegally remove someone).
    // 3. At least one account has manage access.
    //
    // So we don't known anything about the ordering of the accounts that had Manage
    // access in the _new and old_ policy. So we still need to validate Rule 3:
    //
    // > Actors cannot manage/update Manage grants at generations less than their
    // > effective generation.
    //
    // To do so, we'll iterate over the generation "groups" in the old policy and
    // validate that the groups in the old policy and new policy are in the expected
    // order until we:
    //
    // 1. Reach the end of the generation "groups" in the old policy.
    // 2. Reach the default manage grant in the old policy. The ordering beyond the
    //    Default Manage Grant does not need to be preserved, because every account
    //    with manage access _after_ the default grant is effectively the default
    //    grant's generation + 1. In other words, everyone beyond the default grant is
    //    in the same generation group.
    for (let i = 0; i < oldManageGrantsLessThanActorGeneration.length; i++) {
        const oldManageGroup = oldManageGrantsLessThanActorGeneration[i]!;
        const newManageGroup = newManageGrantsLessThanActorGeneration[i];

        // IMPORTANT: When we reach the default grant in the old access policy, we either
        // break out of the loop or return an error. For the reasons described above, we
        // only care about the generation ordering up to the default grant. We don't want
        // to continue validating the generation groups past the default grant.
        if (oldManageGroup.has("DefaultGrant")) {
            if (newAccessPolicy.defaultGrant?.level !== "Manage") {
                // If the default grant didn't have any siblings, we can break early. consider the
                // following:
                //
                // ```
                // old: [{alice}, {default}, {bob (actor)}]
                // new: [{alice}, {bob (actor)}]
                // ```
                //
                // The above case is perfectly valid because anyone can remove the default grant.
                //
                // However, the following is not valid:
                //
                // ```
                // old: [{alice}, {default}, {bob}, {charlie} (actor)]
                // new: [{alice}, {bob, charlie}]
                // ```
                //
                // Charlie just removed the default grant _and_ escalated himself to bob's level.
                // If the default grant had siblings, we make sure that the new siblings are a
                // subset of the old siblings
                if (oldManageGroup.size === 1) break;
            }

            if (!newManageGroup || newManageGroup.isSubsetOf(oldManageGroup)) break;

            return {
                ok: false,
                reason: "Can\u2019t reorder manage grant generations",
            };
        }

        // Every generation group before the actor's generation must exactly equal the
        // corresponding group in the new policy's generation groups, preserving the order.
        if (isDeepEqual(oldManageGroup, newManageGroup)) continue;

        // Each generation "group" before the actor's generation must be in the exact same
        // order in the old and new policy.
        return {
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        };
    }

    return okResult;
}

/**
 * Gets all manage grants before the actor's generation, including the Default
 * grant.
 *
 * Groups grants by generation, which ultimately enables us to account for
 * generation ties in new and old policies - if accounts were tied before, they
 * must still be tied (and vice versa). This prevents escalating or demoting within
 * the senior chain. Consider the following example:
 *
 * ```
 * old: [alice-1, bob-2, carol-3 (actor)]
 * new: [alice-1, bob-1, carol-3 (actor)]
 * ```
 *
 * In this case, alice has more seniority than Bob in the old policy but is tied
 * with him in the new policy. If we were to simply sort by generation and then
 * make sure the order is maintained, we could miss that Bob's manage privelages
 * were actually escalated in this case. This function will return the following
 * output for the above example:
 *
 * ```
 * oldGroups: [{alice}, {bob}, {carol}]
 * newGroups: [{alice, bob}, {carol}]
 * ```
 *
 * Now it's super easy to see that the first "Manage group" has changed!!
 */
function getManageGrantsLessThanActorGeneration(
    accessPolicy: ResolvedAccessPolicyWithGenerations,
    referenceGeneration: number,
    isAccountRemovedFromSpace?: (accountId: AccountId) => boolean,
): ReadonlyArray<Set<AccountId | "DefaultGrant">> {
    const generationToGrants = new Map<number, Set<AccountId | "DefaultGrant">>();

    for (const [accountId, grant] of accessPolicy.accountGrantById.entries()) {
        if (grant.level !== "Manage") continue;
        if (grant.generation >= referenceGeneration) continue;
        if (accountId !== "DefaultGrant" && isAccountRemovedFromSpace?.(accountId)) continue;

        const generation = getAccountAccessPolicyManageGeneration(accountId, accessPolicy);

        const grants = getOrSetDefaultMapValue(generationToGrants, generation, () => new Set());
        grants.add(accountId);
    }

    if (
        accessPolicy.defaultGrant &&
        accessPolicy.defaultGrant.level === "Manage" &&
        accessPolicy.defaultGrant.generation < referenceGeneration
    ) {
        const grants = getOrSetDefaultMapValue(
            generationToGrants,
            accessPolicy.defaultGrant.generation,
            () => new Set(),
        );
        grants.add("DefaultGrant");
    }

    return Array.from(generationToGrants.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, accountIdOrDefaultGrants]) => new Set(accountIdOrDefaultGrants));
}

/**
 * True when adding content to a site, removing content from a site, or change
 * content from one site to another.
 */
export function isSiteRelatedAccessPolicyUpdate(
    oldAccessPolicy: ResolvedAccessPolicyWithGenerations | null,
    newAccessPolicy: ResolvedAccessPolicyWithGenerations,
): boolean {
    const atLeastOneIsSite = oldAccessPolicy?.type === "Site" || newAccessPolicy.type === "Site";
    const bothAreSameSite =
        oldAccessPolicy?.type === "Site" &&
        newAccessPolicy.type === "Site" &&
        oldAccessPolicy?.siteId === newAccessPolicy.siteId;

    return atLeastOneIsSite && !bothAreSameSite;
}
