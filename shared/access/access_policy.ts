import {createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

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

const allAccessLevels = ["View", "Comment", "Edit", "Manage"] as const;

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
 * Get the access level of the provided `AccountId` assuming the `AccountId`
 * has access to the space. Which means we can use the space's `defaultGrant`
 * if there's no account grant.
 */
export function getAccountAccessLevelAssumingSpaceAccess(
    accessPolicy: AccessPolicy,
    accountId: AccountId,
): AccessLevel | null {
    const accountGrant = accessPolicy.accountGrantById.get(accountId);

    if (accountGrant && accessPolicy.defaultGrant?.type === "Space")
        return maxAccessLevel(accountGrant.level, accessPolicy.defaultGrant.level);

    if (accountGrant) return accountGrant.level;
    if (accessPolicy.defaultGrant?.type === "Space") return accessPolicy.defaultGrant.level;

    return null;
}

/**
 * Access grant to a single account.
 */
export type AccessPolicyAccountGrant = SchemaType<typeof AccessPolicyAccountGrantSchema>;

const AccessPolicyAccountGrantSchema = Schema.object({
    level: AccessLevelSchema,
});

/**
 * Access granted to everyone in the space.
 *
 * Eventually we want to add a "guest" account type to spaces which'll won't be
 * covered by the default grant. Guests will only have access to entities
 * they're specifically granted access to.
 */
export type AccessPolicyDefaultGrant = SchemaType<typeof AccessPolicyDefaultGrantSchema>;

// TODO(calebmer, #sharing): Public internet level access?
const AccessPolicyDefaultGrantSchema = Schema.union({
    Space: Schema.object({
        type: Schema.value("Space"),
        level: AccessLevelSchema,
    }),
});

/**
 * Policy designating who is allowed to interact with some entity and what they
 * are allowed to do.
 */
export type AccessPolicy = SchemaType<typeof AccessPolicySchema>;

export const AccessPolicySchema = Schema.object({
    accountGrantById: Schema.map(Schema.id<AccountId>(), AccessPolicyAccountGrantSchema),
    defaultGrant: AccessPolicyDefaultGrantSchema.nullable(),
});

export const AccessPolicyRegister = createCrdtRegister(AccessPolicySchema);
