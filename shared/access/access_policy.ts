import {createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType, UnionSchema} from "~/shared/schema/schema.js";

/**
 * Level of access someone may have against an entity in our system.
 *
 * - `View`: The person can view the entity but can't do anything else.
 *
 * - `Comment`: The person can view and comment on the entity but
 *   can't do anything else.
 *
 * - `Edit`: The person can make any change to the entity but can't make
 *   certain changes that require an extra level of privilege that require
 *   the `Manage` access level (for example, editing the access policy).
 *
 * - `Manage`: The person can do anything to the entity.
 */
export type AccessLevel = SchemaType<typeof AccessLevelSchema>;

export const allAccessLevels = ["View", "Comment", "Edit", "Manage"] as const;

export const AccessLevelSchema = Schema.enum(allAccessLevels);

/**
 * Does someone's access level high enough to take an action at the expected
 * access level?
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
 * Return the lower of the two access levels. If the access level is null then
 * null is considered the lower of the two.
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
 * Compare two access levels for sorting. Lower access levels will appear
 * first. For example `View` will appear before `Edit`.
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
         * Imagine the scenario, Alice invites Bob with manage access. Should Bob be
         * able to revoke Alice's manage access? We believe the main use for this
         * pattern is when Bob is a malicious actor who wants to take over whatever
         * target he was invited to. Therefore, we've decided you should not be able to
         * remove permissions from the account that invited you.
         *
         * Now let's say Alice invites Bob with manage permissions and Bob invites
         * Carol with manage permissions. Carol can't revoke Bob's manage permissions
         * but can Carol revoke Alice's manage permissions? If Bob and Carol are both
         * malicious actors working in concert there's no real difference to our first
         * example. Bob worked around not being able to change Alice's permissions by
         * recruiting a friend Carol. Therefore, not only should you not be allowed to
         * remove permissions from the account that invited you but you also shouldn't
         * be able to remove permissions from the account that invited the account that
         * invited you. This applies recursively up to the creator of the entity.
         *
         * We implement this with the concept of "generations". If Alice creates an
         * entity she has manage permissions at generation 0. If Alice invites Bob with
         * manage permissions then Bob has manage permissions at generation 1. If Bob
         * invites Carol with manage permissions then Carol has manage permissions at
         * generation 2. Users at higher generation numbers can't revoke the
         * permissions of users at lower generations. With this rule we defend against
         * a malicious invitee completely taking over an entity.
         *
         * We only track generations for users with `Manage` access since only users
         * with `Manage` access can share. If someone sets a `defaultGrant` to `Manage`
         * then the `defaultGrant` gets a generation. Users with `Manage` access
         * through the `defaultGrant` shouldn't be allowed to change the access of
         * whoever setup the `defaultGrant`.
         *
         * We track generations with an integer instead of keeping track of the inviter
         * account so we can gracefully handle the inviter being removed from the
         * access policy. For example, if Alice invites Bob and Bob invites Carol then
         * Alice removes Bob's access, Carol still shouldn't be allowed to revoke
         * Alice's access.
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
 * covered by the default grant. Guests will only have access to entities
 * they're specifically granted access to.
 */
export type AccessPolicyDefaultGrant = SchemaType<typeof AccessPolicyDefaultGrantSchema>;

const AccessPolicyDefaultGrantSchema = UnionSchema.unionWithKey("level", {
    Manage: Schema.object({
        level: Schema.value("Manage"),
        // See the documentation on `AccessPolicyAccountGrant`'s `generation` property
        // for more information about what this is.
        generation: Schema.integer.min(0).default(0),
    }),
    Edit: Schema.object({level: Schema.value("Edit")}),
    Comment: Schema.object({level: Schema.value("Comment")}),
    View: Schema.object({level: Schema.value("View")}),
});

/**
 * Access granted to everyone who knows the URL of the entity in question. This
 * grant allows users to share content with people outside of their space or
 * who don't have an Alpine account at all.
 *
 * After enabling a URL grant, the user is responsible for keeping the URL
 * secure if they care about the privacy of their document. We ask search
 * engines not to index the URL so the user's information doesn't leak.
 *
 * If an entity has a `urlGrant` but doesn't have a `defaultGrant` then members
 * of the space are allowed to view the entity but only if they have the URL.
 * The entity won't be made available in search and won't appear on the
 * algorithmic home feed.
 */
export type AccessPolicyUrlGrant = SchemaType<typeof AccessPolicyUrlGrantSchema>;

const AccessPolicyUrlGrantSchema = Schema.object({
    level: Schema.value("View"),
});

/**
 * Policy designating who is allowed to interact with some entity and what they
 * are allowed to do.
 */
export type AccessPolicy = SchemaType<typeof AccessPolicySchema>;

export const AccessPolicySchema = Schema.object({
    accountGrantById: Schema.map(Schema.id<AccountId>(), AccessPolicyAccountGrantSchema),
    defaultGrant: AccessPolicyDefaultGrantSchema.nullable(),
    urlGrant: AccessPolicyUrlGrantSchema.nullable().default(null),
});

export const AccessPolicyRegister = createCrdtRegister(AccessPolicySchema);

/**
 * Get the access level of the provided `AccountId` assuming the `AccountId`
 * has access to the space. Which means we can use the space's `defaultGrant`
 * if there's no account grant.
 */
export function getAccountAccessLevelAssumingSpaceAccess(
    accessPolicy: AccessPolicy,
    accountId: AccountId | null | undefined,
): AccessLevel | null {
    const accessLevels: Array<AccessLevel> = [];

    // If there's a URL grant than everyone gets that access level even if they're
    // anonymous.
    if (accessPolicy.urlGrant !== null) accessLevels.push(accessPolicy.urlGrant.level);

    if (typeof accountId === "string") {
        // You only get the default grant if your account is a member of the space.
        // Which this function assumes.
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
    accessPolicy: AccessPolicy,
): number | null {
    const accountGrant = accessPolicy.accountGrantById.get(accountId);

    if (accountGrant?.level === "Manage" && accessPolicy.defaultGrant?.level === "Manage") {
        return Math.min(accountGrant.generation, accessPolicy.defaultGrant.generation);
    } else if (accountGrant?.level === "Manage") {
        return accountGrant.generation;
    } else if (accessPolicy.defaultGrant?.level === "Manage") {
        return accessPolicy.defaultGrant.generation;
    } else {
        return null;
    }
}

export type ValidateAccessPolicyUpdateResult =
    | {ok: true}
    | {
          ok: false;
          reason:
              | "Can’t update access policy unless actor has manage access"
              | "Can’t set new account grant manage generation to be less than or equal to our actor’s manage generation"
              | "Can’t change account grant manage generation"
              | "Can’t revoke manage access from an account with a manage generation less than our actor"
              | "Can’t change default grant manage generation"
              | "Can’t set new default grant manage generation to be less than or equal to our actor’s manage generation"
              | "Can’t update access policy so that no one has manage access";
      };

/**
 * Validate that an access policy update is allowed for the given actor. This
 * performs critical authorization logic so we must run this on the backend
 * when an access policy is updated to make sure the update is safe.
 */
export function validateAccessPolicyUpdate(
    actorAccountId: AccountId,
    oldAccessPolicy: AccessPolicy,
    newAccessPolicy: AccessPolicy,
): ValidateAccessPolicyUpdateResult {
    // Make sure the actor has manage access and record the actor's generation.
    const actorManageGeneration = getAccountAccessPolicyManageGeneration(
        actorAccountId,
        oldAccessPolicy,
    );
    if (actorManageGeneration === null) {
        return {ok: false, reason: "Can’t update access policy unless actor has manage access"};
    }

    let hasManageAccessLevelAccountGrant = false;

    for (const [accountId, newAccountGrant] of newAccessPolicy.accountGrantById) {
        hasManageAccessLevelAccountGrant ||= hasAccessLevel(newAccountGrant.level, "Manage");

        const oldAccountGrant = oldAccessPolicy.accountGrantById.get(accountId);

        // Make sure that we're not:
        //
        // 1. Changing manage generations
        // 2. Setting a new manage generation to one less than or equal to our own
        // 3. Revoking access for a manage generation less than our own
        if (newAccountGrant.level === "Manage" && oldAccountGrant?.level === "Manage") {
            if (newAccountGrant.generation !== oldAccountGrant.generation) {
                return {ok: false, reason: "Can’t change account grant manage generation"};
            }
        } else if (newAccountGrant.level === "Manage" && oldAccountGrant?.level !== "Manage") {
            if (newAccountGrant.generation <= actorManageGeneration) {
                return {
                    ok: false,
                    reason: "Can’t set new account grant manage generation to be less than or equal to our actor’s manage generation",
                };
            }
        } else if (newAccountGrant.level !== "Manage" && oldAccountGrant?.level === "Manage") {
            if (oldAccountGrant.generation < actorManageGeneration) {
                return {
                    ok: false,
                    reason: "Can’t revoke manage access from an account with a manage generation less than our actor",
                };
            }
        }
    }

    for (const [accountId, oldAccountGrant] of oldAccessPolicy.accountGrantById) {
        if (newAccessPolicy.accountGrantById.has(accountId)) continue;

        // Make sure that we're not revoking access for a manage generation less than
        // our own.
        if (
            oldAccountGrant.level === "Manage" &&
            oldAccountGrant.generation < actorManageGeneration
        ) {
            return {
                ok: false,
                reason: "Can’t revoke manage access from an account with a manage generation less than our actor",
            };
        }
    }

    // Make sure that we're not:
    //
    // 1. Changing manage generations
    // 2. Setting a new manage generation to one less than or equal to our own
    if (
        newAccessPolicy.defaultGrant?.level === "Manage" &&
        oldAccessPolicy.defaultGrant?.level === "Manage"
    ) {
        if (newAccessPolicy.defaultGrant.generation !== oldAccessPolicy.defaultGrant.generation) {
            return {ok: false, reason: "Can’t change default grant manage generation"};
        }
    } else if (
        newAccessPolicy.defaultGrant?.level === "Manage" &&
        oldAccessPolicy.defaultGrant?.level !== "Manage"
    ) {
        if (newAccessPolicy.defaultGrant.generation <= actorManageGeneration) {
            return {
                ok: false,
                reason: "Can’t set new default grant manage generation to be less than or equal to our actor’s manage generation",
            };
        }
    }

    const hasManageAccessLevel =
        hasManageAccessLevelAccountGrant ||
        (newAccessPolicy.defaultGrant &&
            hasAccessLevel(newAccessPolicy.defaultGrant.level, "Manage"));

    // Make sure someone has manage access in the new access policy.
    if (!hasManageAccessLevel) {
        return {ok: false, reason: "Can’t update access policy so that no one has manage access"};
    }

    return {ok: true};
}
