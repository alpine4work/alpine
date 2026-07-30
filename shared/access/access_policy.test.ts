import {enableMapSet, produce} from "immer";
import {
    AccessLevel,
    AccessPolicy,
    AccessPolicySchema,
    LocalAccessPolicy,
    ResolvedAccessPolicyWithGenerations,
    SiteAccessPolicy,
    compareAccessLevel,
    hasAccessLevel,
    isSiteRelatedAccessPolicyUpdate,
    maxAccessLevel,
    minAccessLevel,
    validateAccessPolicyUpdate,
} from "~/shared/access/access_policy.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SiteId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Test wrapper schema that contains an AccessPolicy. This simulates how
 * AccessPolicySchema is used in practice (as an object property).
 */
const TestAccessPolicyWrapperSchema = Schema.object({
    accessPolicy: AccessPolicySchema,
});

enableMapSet();

// Enumerate all possible cases. The first element is the smaller.
const testCases: Array<[AccessLevel | null, AccessLevel | null]> = [
    [null, null],
    [null, "View"],
    [null, "Comment"],
    [null, "Edit"],
    [null, "Manage"],
    ["View", "View"],
    ["View", "Comment"],
    ["View", "Edit"],
    ["View", "Manage"],
    ["Comment", "Comment"],
    ["Comment", "Edit"],
    ["Comment", "Manage"],
    ["Edit", "Edit"],
    ["Edit", "Manage"],
    ["Manage", "Manage"],
];

test("access level comparisons are correct", () => {
    // Base line hard coded tests before dynamic tests as a sanity check.
    {
        expect(hasAccessLevel(null, "View")).toEqual(false);
        expect(hasAccessLevel("View", null)).toEqual(true);

        expect(minAccessLevel(null, "View")).toEqual(null);
        expect(minAccessLevel("View", null)).toEqual(null);

        expect(maxAccessLevel(null, "View")).toEqual("View");
        expect(maxAccessLevel("View", null)).toEqual("View");

        expect(compareAccessLevel(null, "View")).toEqual(-1);
        expect(compareAccessLevel("View", null)).toEqual(1);

        expect(hasAccessLevel("Comment", "Manage")).toEqual(false);
        expect(hasAccessLevel("Manage", "Comment")).toEqual(true);

        expect(minAccessLevel("Comment", "Manage")).toEqual("Comment");
        expect(minAccessLevel("Manage", "Comment")).toEqual("Comment");

        expect(maxAccessLevel("Comment", "Manage")).toEqual("Manage");
        expect(maxAccessLevel("Manage", "Comment")).toEqual("Manage");

        expect(compareAccessLevel("Comment", "Manage")).toEqual(-1);
        expect(compareAccessLevel("Manage", "Comment")).toEqual(1);

        expect(hasAccessLevel("Edit", "Edit")).toEqual(true);

        expect(minAccessLevel("Edit", "Edit")).toEqual("Edit");

        expect(maxAccessLevel("Edit", "Edit")).toEqual("Edit");

        expect(compareAccessLevel("Edit", "Edit")).toEqual(0);
    }

    for (const [smallerAccessLevel, largerAccessLevel] of testCases) {
        expect(hasAccessLevel(smallerAccessLevel, largerAccessLevel)).toEqual(
            smallerAccessLevel === largerAccessLevel ? true : false,
        );
        expect(hasAccessLevel(largerAccessLevel, smallerAccessLevel)).toEqual(true);

        expect(minAccessLevel(smallerAccessLevel, largerAccessLevel)).toEqual(smallerAccessLevel);
        expect(minAccessLevel(largerAccessLevel, smallerAccessLevel)).toEqual(smallerAccessLevel);

        expect(maxAccessLevel(smallerAccessLevel, largerAccessLevel)).toEqual(largerAccessLevel);
        expect(maxAccessLevel(largerAccessLevel, smallerAccessLevel)).toEqual(largerAccessLevel);

        expect(compareAccessLevel(smallerAccessLevel, largerAccessLevel)).toEqual(
            smallerAccessLevel === largerAccessLevel ? 0 : -1,
        );
        expect(compareAccessLevel(largerAccessLevel, smallerAccessLevel)).toEqual(
            smallerAccessLevel === largerAccessLevel ? 0 : 1,
        );
    }
});

describe("validates access policy updates without default grants", () => {
    const accountId1 = generateId<AccountId>();
    const accountId2 = generateId<AccountId>();
    const accountId3 = generateId<AccountId>();

    const accessPolicy1: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[accountId1, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    const accessPolicy2 = produce(accessPolicy1, accessPolicy => {
        accessPolicy.accountGrantById.set(accountId2, {level: "Manage", generation: 1});
    });

    const accessPolicy3 = produce(accessPolicy2, accessPolicy => {
        accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 2});
    });

    test("actor can\u2019t add a manage account at a generation equal to its own", () => {
        expect(
            validateAccessPolicyUpdate(
                accountId1,
                accessPolicy1,
                produce(accessPolicy1, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId2, {level: "Manage", generation: 0});
                }),
            ),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
        });

        expect(
            validateAccessPolicyUpdate(
                accountId2,
                accessPolicy2,
                produce(accessPolicy2, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 1});
                }),
            ),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
        });
    });

    test("actor can add a manage account at a generation greater than its own", () => {
        expect(validateAccessPolicyUpdate(accountId1, accessPolicy1, accessPolicy2)).toEqual({
            ok: true,
        });

        expect(validateAccessPolicyUpdate(accountId2, accessPolicy2, accessPolicy3)).toEqual({
            ok: true,
        });

        expect(validateAccessPolicyUpdate(accountId1, accessPolicy2, accessPolicy3)).toEqual({
            ok: true,
        });
    });

    test("actor can remove a manage account at a generation greater than its own", () => {
        expect(validateAccessPolicyUpdate(accountId1, accessPolicy2, accessPolicy1)).toEqual({
            ok: true,
        });

        expect(validateAccessPolicyUpdate(accountId2, accessPolicy3, accessPolicy2)).toEqual({
            ok: true,
        });

        expect(validateAccessPolicyUpdate(accountId1, accessPolicy3, accessPolicy2)).toEqual({
            ok: true,
        });

        expect(
            validateAccessPolicyUpdate(
                accountId1,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.delete(accountId2);
                }),
            ),
        ).toEqual({ok: true});

        expect(
            validateAccessPolicyUpdate(
                accountId1,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.delete(accountId3);
                }),
            ),
        ).toEqual({ok: true});

        expect(
            validateAccessPolicyUpdate(
                accountId2,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.delete(accountId3);
                }),
            ),
        ).toEqual({ok: true});
    });

    test("actor can remove own access from an access policy", () => {
        expect(
            validateAccessPolicyUpdate(
                accountId2,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.delete(accountId2);
                }),
            ),
        ).toEqual({ok: true});

        expect(
            validateAccessPolicyUpdate(
                accountId3,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.delete(accountId3);
                }),
            ),
        ).toEqual({ok: true});
    });

    test("actor can\u2019t add a manage account at a generation less than its own", () => {
        expect(
            validateAccessPolicyUpdate(
                accountId2,
                accessPolicy2,
                produce(accessPolicy2, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 0});
                }),
            ),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
        });
    });

    test("actor can change the generation of a manage account at a generation greater than its own", () => {
        expect(
            validateAccessPolicyUpdate(
                accountId1,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 3});
                }),
            ),
        ).toEqual({ok: true}); // accountId1 (gen 0) can change junior accountId3 (gen 2)

        expect(
            validateAccessPolicyUpdate(
                accountId2,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 3});
                }),
            ),
        ).toEqual({ok: true}); // accountId2 (gen 1) can change junior accountId3 (gen 2)

        expect(
            validateAccessPolicyUpdate(
                accountId1,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 1});
                }),
            ),
        ).toEqual({ok: true});
    });

    test("actor can change own manage generation as long as all manage accounts at a lower generation are in the same order in both policies", () => {
        expect(
            validateAccessPolicyUpdate(
                accountId3,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 3});
                }),
            ),
        ).toEqual({ok: true});
    });

    test("actor cant escalate a manage account at a greater generation in the old policy to a lower generation in the new policy (relative to the actor)", () => {
        // The following is okay because the actor is moving accountId3 to the same
        // generation as itself. This means accountId3 can remove the actor.
        //
        // ```
        // old: [{accountId1}, {accountId2 (actor)}, {default}]
        // new: [{accountId1}, {accountId2 (actor), accountId3}, {default}]
        // ```
        expect(
            validateAccessPolicyUpdate(
                accountId2,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 1});
                }),
            ),
        ).toEqual({ok: true});
    });

    test("actor can\u2019t escalate own manage generation in new policy above accounts with manage access at a lower generation in the old policy", () => {
        // accountId3 (gen 2) can't escalate self to gen 1 - would violate senior chain
        // invariant
        expect(
            validateAccessPolicyUpdate(
                accountId3,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 1});
                }),
            ),
        ).toEqual({ok: false, reason: "Can\u2019t reorder manage grant generations"});
    });

    test("actors can\u2019t remove a manage account at a generation less than their own", () => {
        expect(
            validateAccessPolicyUpdate(
                accountId2,
                accessPolicy2,
                produce(accessPolicy2, accessPolicy => {
                    accessPolicy.accountGrantById.delete(accountId1);
                }),
            ),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        });

        expect(
            validateAccessPolicyUpdate(
                accountId2,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.delete(accountId1);
                }),
            ),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        });

        expect(
            validateAccessPolicyUpdate(
                accountId3,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.delete(accountId1);
                }),
            ),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        });

        expect(
            validateAccessPolicyUpdate(
                accountId3,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.delete(accountId2);
                }),
            ),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        });
    });

    test("actor can\u2019t revoke manage access from an account with a generation less than their own", () => {
        expect(
            validateAccessPolicyUpdate(
                accountId2,
                accessPolicy2,
                produce(accessPolicy2, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId1, {level: "Edit"});
                }),
            ),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        });

        expect(
            validateAccessPolicyUpdate(
                accountId2,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId1, {level: "Edit"});
                }),
            ),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        });

        expect(
            validateAccessPolicyUpdate(
                accountId3,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId1, {level: "Edit"});
                }),
            ),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        });

        expect(
            validateAccessPolicyUpdate(
                accountId3,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId2, {level: "Edit"});
                }),
            ),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        });
    });

    test("actor can revoke own manage access permission", () => {
        expect(
            validateAccessPolicyUpdate(
                accountId2,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId2, {level: "Edit"});
                }),
            ),
        ).toEqual({ok: true});

        expect(
            validateAccessPolicyUpdate(
                accountId3,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId3, {level: "Edit"});
                }),
            ),
        ).toEqual({ok: true});
    });

    test("actor can revoke manage access from a manage account at a generation greater than its own", () => {
        expect(
            validateAccessPolicyUpdate(
                accountId1,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId2, {level: "Edit"});
                }),
            ),
        ).toEqual({ok: true});

        expect(
            validateAccessPolicyUpdate(
                accountId1,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId3, {level: "Edit"});
                }),
            ),
        ).toEqual({ok: true});

        expect(
            validateAccessPolicyUpdate(
                accountId2,
                accessPolicy3,
                produce(accessPolicy3, accessPolicy => {
                    accessPolicy.accountGrantById.set(accountId3, {level: "Edit"});
                }),
            ),
        ).toEqual({ok: true});
    });
});

test("validates access policy updates with default grants", () => {
    const accountId1 = generateId<AccountId>();
    const accountId2 = generateId<AccountId>();
    const accountId3 = generateId<AccountId>();

    const accessPolicy1: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[accountId1, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    // The following is okay because the actor is moving the default grant to the same
    // generation as itself. This means anyone in the space can remove the actor.
    //
    // ```
    // old: [{accountId1}, {default}]
    // new: [{accountId1, default}]
    // ```
    expect(
        validateAccessPolicyUpdate(
            accountId1,
            accessPolicy1,
            produce(accessPolicy1, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 0};
            }),
        ),
    ).toEqual({ok: true});

    const accessPolicy2 = produce(accessPolicy1, accessPolicy => {
        accessPolicy.defaultGrant = {level: "Manage", generation: 1};
    });

    expect(validateAccessPolicyUpdate(accountId1, accessPolicy1, accessPolicy2)).toEqual({
        ok: true,
    });

    expect(validateAccessPolicyUpdate(accountId1, accessPolicy2, accessPolicy1)).toEqual({
        ok: true,
    });

    // The following is okay because the second account is adding the default grant at
    // a lower generation than the first account. This shouldn't happen in practice
    // because we should make sure that the actor has manage permissions on the access
    // policy before calling the function in the first place
    //
    // ```
    // old: [{accountId1}]
    // new: [{accountId1}, {default}]
    // ```
    expect(validateAccessPolicyUpdate(accountId2, accessPolicy1, accessPolicy2)).toEqual({
        ok: true,
    });

    // This is a little weird, because now accounts can technically add themselves to
    // access policies where as they could not do so before. However, there is a note
    // on the function that says that we should make sure that the actor has manage
    // permissions on the access policy before calling the function.
    //
    // ```
    // old: [{accountId1}]
    // new: [{accountId1}, {default, accountId2}]
    // ```
    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy1,
            produce(accessPolicy1, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 1};
                accessPolicy.accountGrantById.set(accountId2, {level: "Manage", generation: 1});
            }),
        ),
    ).toEqual({ok: true});

    expect(validateAccessPolicyUpdate(accountId2, accessPolicy2, accessPolicy1)).toEqual({
        ok: true,
    });

    expect(validateAccessPolicyUpdate(accountId3, accessPolicy2, accessPolicy1)).toEqual({
        ok: true,
    });

    expect(
        validateAccessPolicyUpdate(
            accountId3,
            accessPolicy2,
            produce(accessPolicy2, accessPolicy => {
                accessPolicy.accountGrantById.set(accountId2, {level: "Manage", generation: 0});
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
    });

    expect(
        validateAccessPolicyUpdate(
            accountId3,
            accessPolicy2,
            produce(accessPolicy2, accessPolicy => {
                accessPolicy.accountGrantById.set(accountId2, {level: "Manage", generation: 1});
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
    });

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy2,
            produce(accessPolicy2, accessPolicy => {
                accessPolicy.accountGrantById.set(accountId2, {level: "Manage", generation: 0});
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
    });

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy2,
            produce(accessPolicy2, accessPolicy => {
                accessPolicy.accountGrantById.set(accountId2, {level: "Manage", generation: 1});
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
    });

    const accessPolicy3 = produce(accessPolicy2, accessPolicy => {
        accessPolicy.accountGrantById.set(accountId2, {level: "Manage", generation: 2});
    });

    expect(validateAccessPolicyUpdate(accountId3, accessPolicy2, accessPolicy3)).toEqual({
        ok: true,
    });

    expect(validateAccessPolicyUpdate(accountId3, accessPolicy3, accessPolicy2)).toEqual({
        ok: true,
    });

    expect(validateAccessPolicyUpdate(accountId2, accessPolicy2, accessPolicy3)).toEqual({
        ok: true,
    });

    expect(validateAccessPolicyUpdate(accountId2, accessPolicy3, accessPolicy2)).toEqual({
        ok: true,
    });

    expect(
        validateAccessPolicyUpdate(
            accountId1,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 2};
            }),
        ),
    ).toEqual({ok: true});

    // ```
    // old: [{accountId1}, {default}, {accountId2 (actor)}]
    // new: [{accountId1}, {default}, {accountId2 (actor), accountId3}]
    // ```
    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 2};
            }),
        ),
    ).toEqual({ok: true});

    // This feels a little odd, but the actor's manage generation is that of the
    // default grant, so they can manage at or above the default grant generation.
    //
    // ```
    // old: [{accountId1}, {default}, {accountId2}]
    // new: [{accountId1}, {accountId2, default}]
    // ```
    expect(
        validateAccessPolicyUpdate(
            accountId3,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 2};
            }),
        ),
    ).toEqual({ok: true});

    // The following is okay because the actor is the "owner" in the old policy. They
    // are essentially giving up their manage privileges.
    //
    // ```
    // old: [{accountId1 (actor)}, {default}, {accountId2}]
    // new: [{accountId1 (actor), default}, {accountId2}]
    // ```
    expect(
        validateAccessPolicyUpdate(
            accountId1,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 0};
            }),
        ),
    ).toEqual({ok: true});

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 0};
            }),
        ),
    ).toEqual({ok: false, reason: "Can\u2019t reorder manage grant generations"});

    expect(
        validateAccessPolicyUpdate(
            accountId3,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 0};
            }),
        ),
    ).toEqual({ok: false, reason: "Can\u2019t reorder manage grant generations"});

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 1});
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
    });

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 2});
            }),
        ),
    ).toEqual({ok: true});

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 3});
            }),
        ),
    ).toEqual({ok: true});

    // aid-0, dg-1, aid2-2

    // aid-0, dg-2

    const accessPolicy4 = produce(accessPolicy3, accessPolicy => {
        accessPolicy.defaultGrant = null;
    });

    expect(validateAccessPolicyUpdate(accountId1, accessPolicy3, accessPolicy4)).toEqual({
        ok: true,
    });

    expect(validateAccessPolicyUpdate(accountId1, accessPolicy4, accessPolicy3)).toEqual({
        ok: true,
    });

    expect(validateAccessPolicyUpdate(accountId2, accessPolicy3, accessPolicy4)).toEqual({
        ok: true,
    });

    // The actor is sacrificing some manage privileges
    //
    // ```
    // old: [{accountId1}, {accountId2 (actor)}]
    // new: [{accountId1}, {default}, {accountId2 (actor)}]
    // ```
    expect(validateAccessPolicyUpdate(accountId2, accessPolicy4, accessPolicy3)).toEqual({
        ok: true,
    });

    expect(validateAccessPolicyUpdate(accountId3, accessPolicy3, accessPolicy4)).toEqual({
        ok: true,
    });

    // The actor is sacrificing some manage privileges
    //
    // ```
    // old: [{accountId1}, {accountId2 (actor)}]
    // new: [{accountId1}, {default}, {accountId2 (actor)}]
    // ```
    expect(validateAccessPolicyUpdate(accountId3, accessPolicy4, accessPolicy3)).toEqual({
        ok: false,
        reason: "Can\u2019t reorder manage grant generations",
    });

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy4,
            produce(accessPolicy4, accessPolicy => {
                accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 1});
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
    });

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy4,
            produce(accessPolicy4, accessPolicy => {
                accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 2});
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
    });

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy4,
            produce(accessPolicy4, accessPolicy => {
                accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 3});
            }),
        ),
    ).toEqual({ok: true});

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy4,
            produce(accessPolicy4, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 0};
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t reorder manage grant generations",
    });

    // ```
    // old: [{accountId1}, {accountId2 (actor)}]
    // new: [{accountId1}, {default}, {accountId2 (actor)}]
    // ```
    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy4,
            produce(accessPolicy4, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 1};
            }),
        ),
    ).toEqual({ok: true});

    // ```
    // old: [{accountId1}, {default}, {accountId2 (actor)}]
    // new: [{accountId1}, {default, accountId2 (actor)}]
    // ```
    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy4,
            produce(accessPolicy4, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 2};
            }),
        ),
    ).toEqual({ok: true});

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy4,
            produce(accessPolicy4, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 3};
            }),
        ),
    ).toEqual({ok: true});
});

test("validates access policy can\u2019t remove all manage access", () => {
    const accountId1 = generateId<AccountId>();

    const accessPolicy1: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[accountId1, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    expect(
        validateAccessPolicyUpdate(
            accountId1,
            accessPolicy1,
            produce(accessPolicy1, accessPolicy => {
                accessPolicy.accountGrantById.delete(accountId1);
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t update access policy so that no one has manage access",
    });

    const accessPolicy2 = produce(accessPolicy1, accessPolicy => {
        accessPolicy.defaultGrant = {level: "Manage", generation: 1};
    });

    expect(validateAccessPolicyUpdate(accountId1, accessPolicy1, accessPolicy2)).toEqual({
        ok: true,
    });

    const accessPolicy3 = produce(accessPolicy2, accessPolicy => {
        accessPolicy.accountGrantById.delete(accountId1);
    });

    expect(validateAccessPolicyUpdate(accountId1, accessPolicy2, accessPolicy3)).toEqual({
        ok: true,
    });

    expect(
        validateAccessPolicyUpdate(
            accountId1,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.defaultGrant = null;
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t update access policy so that no one has manage access",
    });

    expect(
        validateAccessPolicyUpdate(
            accountId1,
            accessPolicy2,
            produce(accessPolicy2, accessPolicy => {
                accessPolicy.defaultGrant = null;
            }),
        ),
    ).toEqual({ok: true});
});

test("validates access policy updates for actors with no manage generation", () => {
    const actorAccountId = generateId<AccountId>();
    const manageAccountId1 = generateId<AccountId>();
    const manageAccountId2 = generateId<AccountId>();

    const accessPolicy1: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([
            [manageAccountId1, {level: "Manage", generation: 0}],
            [manageAccountId2, {level: "Manage", generation: 1}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    };

    expect(
        validateAccessPolicyUpdate(
            actorAccountId,
            accessPolicy1,
            produce(accessPolicy1, accessPolicy => {
                accessPolicy.accountGrantById.delete(manageAccountId1);
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
    });

    expect(
        validateAccessPolicyUpdate(
            actorAccountId,
            accessPolicy1,
            produce(accessPolicy1, accessPolicy => {
                accessPolicy.accountGrantById.delete(manageAccountId2);
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
    });

    expect(
        validateAccessPolicyUpdate(
            actorAccountId,
            accessPolicy1,
            produce(accessPolicy1, accessPolicy => {
                accessPolicy.accountGrantById.set(manageAccountId1, {level: "Edit"});
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
    });

    expect(
        validateAccessPolicyUpdate(
            actorAccountId,
            accessPolicy1,
            produce(accessPolicy1, accessPolicy => {
                accessPolicy.accountGrantById.set(manageAccountId2, {level: "Edit"});
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
    });
});

describe("AccessPolicySchema serialization", () => {
    test("deserializes Regular access policy with type discriminant", () => {
        const accountId = generateId<AccountId>();

        const serializedData = {
            accessPolicy: {
                type: "Local",
                accountGrantById: [[accountId, {level: "Manage", generation: 0}]],
                defaultGrant: {level: "Edit"},
                urlGrant: null,
            },
        };

        const deserialized = TestAccessPolicyWrapperSchema.deserialize(serializedData);

        expect(deserialized.accessPolicy.type).toBe("Local");

        const regularPolicy = deserialized.accessPolicy as LocalAccessPolicy;
        expect(regularPolicy.accountGrantById.get(accountId)).toEqual({
            level: "Manage",
            generation: 0,
        });
        expect(regularPolicy.defaultGrant).toEqual({level: "Edit"});
        expect(regularPolicy.urlGrant).toBe(null);
    });

    test("deserializes Regular access policy with all grant types", () => {
        const accountId = generateId<AccountId>();

        const serializedData = {
            accessPolicy: {
                type: "Local",
                accountGrantById: [[accountId, {level: "Manage", generation: 0}]],
                defaultGrant: {level: "Manage", generation: 1},
                urlGrant: {level: "View"},
            },
        };

        const deserialized = TestAccessPolicyWrapperSchema.deserialize(serializedData);

        expect(deserialized.accessPolicy.type).toBe("Local");

        const regularPolicy = deserialized.accessPolicy as LocalAccessPolicy;
        expect(regularPolicy.defaultGrant).toEqual({level: "Manage", generation: 1});
        expect(regularPolicy.urlGrant).toEqual({level: "View"});
    });

    test("deserializes Site access policy", () => {
        const siteId = generateId<SiteId>();

        const serializedData = {
            accessPolicy: {
                type: "Site",
                siteId,
            },
        };

        const deserialized = TestAccessPolicyWrapperSchema.deserialize(serializedData);

        expect(deserialized.accessPolicy.type).toBe("Site");

        const sitePolicy = deserialized.accessPolicy as SiteAccessPolicy;
        expect(sitePolicy.siteId).toBe(siteId);
    });

    test("serializes Regular policy with type discriminant", () => {
        const accountId = generateId<AccountId>();

        const wrapper = {
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([[accountId, {level: "Manage", generation: 0}]]),
                defaultGrant: {level: "Edit"},
                urlGrant: null,
            } as AccessPolicy,
        };

        const serialized = TestAccessPolicyWrapperSchema.serialize(wrapper);

        expect(serialized.accessPolicy).toEqual({
            type: "Local",
            accountGrantById: [[accountId, {level: "Manage", generation: 0}]],
            defaultGrant: {level: "Edit"},
            urlGrant: null,
        });
    });

    test("serializes Site policy correctly", () => {
        const siteId = generateId<SiteId>();

        const wrapper = {
            accessPolicy: {
                type: "Site",
                siteId,
            } as AccessPolicy,
        };

        const serialized = TestAccessPolicyWrapperSchema.serialize(wrapper);

        expect(serialized.accessPolicy).toEqual({
            type: "Site",
            siteId,
        });
    });

    test("round-trips Regular policy through serialize/deserialize", () => {
        const accountId1 = generateId<AccountId>();
        const accountId2 = generateId<AccountId>();

        const wrapper = {
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([
                    [accountId1, {level: "Manage", generation: 0}],
                    [accountId2, {level: "Edit"}],
                ]),
                defaultGrant: {level: "Comment"},
                urlGrant: {level: "View"},
            } as AccessPolicy,
        };

        const serialized = TestAccessPolicyWrapperSchema.serialize(wrapper);
        const deserialized = TestAccessPolicyWrapperSchema.deserialize(serialized);

        expect(deserialized.accessPolicy.type).toBe("Local");

        const result = deserialized.accessPolicy as LocalAccessPolicy;
        expect(result.accountGrantById.get(accountId1)).toEqual({level: "Manage", generation: 0});
        expect(result.accountGrantById.get(accountId2)).toEqual({level: "Edit"});
        expect(result.defaultGrant).toEqual({level: "Comment"});
        expect(result.urlGrant).toEqual({level: "View"});
    });

    test("round-trips Site policy through serialize/deserialize", () => {
        const siteId = generateId<SiteId>();

        const wrapper = {
            accessPolicy: {
                type: "Site",
                siteId,
            } as AccessPolicy,
        };

        const serialized = TestAccessPolicyWrapperSchema.serialize(wrapper);
        const deserialized = TestAccessPolicyWrapperSchema.deserialize(serialized);

        expect(deserialized.accessPolicy.type).toBe("Site");
        expect((deserialized.accessPolicy as SiteAccessPolicy).siteId).toBe(siteId);
    });

    test("type guards correctly identify policy types", () => {
        const regularPolicy: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map(),
            defaultGrant: null,
            urlGrant: null,
        };

        const sitePolicy: AccessPolicy = {
            type: "Site",
            siteId: generateId<SiteId>(),
        };

        expect(regularPolicy.type).toBe("Local");
        expect(sitePolicy.type).toBe("Site");
    });
});

describe("validateAccessPolicyUpdate senior chain validation", () => {
    // Setup: alice (gen 0), bob (gen 1), carol (gen 2), dan (gen 3)
    const alice = generateId<AccountId>();
    const bob = generateId<AccountId>();
    const carol = generateId<AccountId>();
    const dan = generateId<AccountId>();

    const basePolicyWith4Managers: LocalAccessPolicy = {
        type: "Local",
        accountGrantById: new Map([
            [alice, {level: "Manage", generation: 0}],
            [bob, {level: "Manage", generation: 1}],
            [carol, {level: "Manage", generation: 2}],
            [dan, {level: "Manage", generation: 3}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    };

    test("actor can promote manage account at higher generation to their own generation", () => {
        const newPolicy = produce(basePolicyWith4Managers, policy => {
            policy.accountGrantById.set(dan, {level: "Manage", generation: 2});
        });

        // ```
        // old: [{alice}, {bob}, {carol (actor)}, {dan}]
        // new: [{alice}, {bob}, {carol (actor), dan}]
        // ```
        expect(validateAccessPolicyUpdate(carol, basePolicyWith4Managers, newPolicy)).toEqual({
            ok: true,
        });
    });

    test("actor can change own generation such that there are more manage accounts at a lower generation than the actor in the new policy (de-escalate own priveleges)", () => {
        const newPolicy = produce(basePolicyWith4Managers, policy => {
            policy.accountGrantById.set(carol, {level: "Manage", generation: 4});
        });

        // ```
        // old: [{alice}, {bob}, {carol (actor)}, {dan}]
        // new: [{alice}, {bob}, {dan}, {carol}]
        // ```
        expect(validateAccessPolicyUpdate(carol, basePolicyWith4Managers, newPolicy)).toEqual({
            ok: true,
        });
    });

    test("actor can\u2019t change own generation such that there are fewer manage accounts at a lower generation than the actor in the new policy (escalate own priveleges)", () => {
        // Carol (gen 2) tries to escalate to gen 1 This would add Carol to the senior
        // chain, causing a length mismatch
        const newPolicy = produce(basePolicyWith4Managers, policy => {
            policy.accountGrantById.set(carol, {level: "Manage", generation: 1});
        });

        // [{alice}, {bob}, {carol}, {dan}] -> [{alice}, {bob, carol}, {dan}]
        expect(validateAccessPolicyUpdate(carol, basePolicyWith4Managers, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });
    });

    test("actor can\u2019t reorder the manage accounts at lower generations", () => {
        // Dan (gen 3) tries to swap Alice and Bob's generations Alice: gen 0 -> gen 1,
        // Bob: gen 1 -> gen 0 Senior chain would have different order
        const newPolicy = produce(basePolicyWith4Managers, policy => {
            policy.accountGrantById.set(alice, {level: "Manage", generation: 1});
            policy.accountGrantById.set(bob, {level: "Manage", generation: 0});
        });

        expect(validateAccessPolicyUpdate(dan, basePolicyWith4Managers, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });

        expect(
            validateAccessPolicyUpdate(
                dan,
                basePolicyWith4Managers,
                produce(basePolicyWith4Managers, policy => {
                    policy.accountGrantById.set(alice, {level: "Manage", generation: 1});
                    policy.accountGrantById.set(bob, {level: "Manage", generation: 1});
                }),
            ),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });

        expect(
            validateAccessPolicyUpdate(
                dan,
                basePolicyWith4Managers,
                produce(basePolicyWith4Managers, policy => {
                    policy.accountGrantById.set(bob, {level: "Manage", generation: 1});
                    policy.accountGrantById.set(alice, {level: "Manage", generation: 1});
                }),
            ),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });
    });

    test("actor can\u2019t reorder the manage accounts at lower generations in a way that removes generation ties", () => {
        // Setup: Alice and Bob both at gen 0 (tied), Carol at gen 2
        const policyWithTie: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 0}],
                [carol, {level: "Manage", generation: 2}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Carol (gen 2) tries to change Bob from gen 0 to gen 1, breaking the tie
        const newPolicy = produce(policyWithTie, policy => {
            policy.accountGrantById.set(bob, {level: "Manage", generation: 1});
        });

        expect(validateAccessPolicyUpdate(carol, policyWithTie, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });
    });

    test("actor can\u2019t reorder the manage accounts at lower generations in a way that creates generation ties", () => {
        // Dan (gen 3) tries to change Bob from gen 1 to gen 0, creating a tie with Alice
        const newPolicy = produce(basePolicyWith4Managers, policy => {
            policy.accountGrantById.set(bob, {level: "Manage", generation: 0});
        });

        expect(validateAccessPolicyUpdate(dan, basePolicyWith4Managers, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });
    });

    test("actor with inherited access (not in policy) can add others", () => {
        // This simulates the case where an actor has manage access via inheritance (e.g.,
        // from a parent task or collection) but is not directly in the policy. They should
        // be able to add new managers at generation actorGen + 1.
        const inheritedAccessActor = generateId<AccountId>();
        const newManager = generateId<AccountId>();

        // Simple policy with just one manager at gen 0
        const simplePolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        // inheritedAccessActor is not in the policy, so their computed generation is
        // maxGeneration + 1 = 0 + 1 = 1. They should be able to add someone at gen 2
        // (which is actorGen + 1 as computed by reduceAccessPolicy).
        const newPolicy = produce(simplePolicy, policy => {
            policy.accountGrantById.set(newManager, {level: "Manage", generation: 2});
        });

        expect(validateAccessPolicyUpdate(inheritedAccessActor, simplePolicy, newPolicy)).toEqual({
            ok: true,
        });
    });

    test("must have at least one manager in new policy", () => {
        const simplePolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Alice removes self, leaving no managers
        const newPolicy = produce(simplePolicy, policy => {
            policy.accountGrantById.delete(alice);
        });

        expect(validateAccessPolicyUpdate(alice, simplePolicy, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t update access policy so that no one has manage access",
        });
    });

    test("manage accounts at the same generation can manage each other", () => {
        // Setup: Alice and Bob both at gen 0
        const policyWithPeers: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 0}],
                [carol, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Alice (gen 0) removes Bob (gen 0) - peers can remove each other
        const newPolicy = produce(policyWithPeers, policy => {
            policy.accountGrantById.delete(bob);
        });

        expect(validateAccessPolicyUpdate(alice, policyWithPeers, newPolicy)).toEqual({
            ok: true,
        });
    });

    test("adding a new manager at actor generation fails", () => {
        const eve = generateId<AccountId>();

        // Carol (gen 2) adds Eve at gen 2 (same as Carol)
        const newPolicy = produce(basePolicyWith4Managers, policy => {
            policy.accountGrantById.set(eve, {level: "Manage", generation: 2});
        });

        expect(validateAccessPolicyUpdate(carol, basePolicyWith4Managers, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
        });
    });
});

describe("validateAccessPolicyUpdate tie consistency", () => {
    // All tests use explicit policy construction to be clear about generations
    const alice = generateId<AccountId>();
    const bob = generateId<AccountId>();
    const carol = generateId<AccountId>();
    const dan = generateId<AccountId>();
    const eve = generateId<AccountId>();

    // ======================= BREAKING TIES (should fail) =======================

    test("breaking a two-person tie at gen 0 is not allowed", () => {
        // Old: Alice(0), Bob(0) tied, Carol(2) is actor New: Alice(0), Bob(1) - tie broken
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 0}],
                [carol, {level: "Manage", generation: 2}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(bob, {level: "Manage", generation: 1});
        });

        expect(validateAccessPolicyUpdate(carol, oldPolicy, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });
    });

    test("breaking a tie by promoting one member is not allowed", () => {
        // Old: Alice(1), Bob(1) tied, Carol(2) is actor New: Alice(0), Bob(1) - Alice
        // promoted out of tie
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 1}],
                [bob, {level: "Manage", generation: 1}],
                [carol, {level: "Manage", generation: 2}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(alice, {level: "Manage", generation: 0});
        });

        expect(validateAccessPolicyUpdate(carol, oldPolicy, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });
    });

    test("breaking a tie by demoting one member is not allowed", () => {
        // Old: Alice(0), Bob(0) tied, Dan(3) is actor New: Alice(0), Bob(2) - Bob demoted
        // out of tie
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 0}],
                [carol, {level: "Manage", generation: 1}],
                [dan, {level: "Manage", generation: 3}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(bob, {level: "Manage", generation: 2});
        });

        expect(validateAccessPolicyUpdate(dan, oldPolicy, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });
    });

    test("breaking a three-person tie is not allowed", () => {
        // Old: Alice(0), Bob(0), Carol(0) all tied, Eve(5) is actor New: Alice(0), Bob(0),
        // Carol(1) - Carol demoted from tie
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 0}],
                [carol, {level: "Manage", generation: 0}],
                [eve, {level: "Manage", generation: 5}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        expect(
            validateAccessPolicyUpdate(
                eve,
                oldPolicy,
                produce(oldPolicy, policy => {
                    policy.accountGrantById.set(carol, {level: "Manage", generation: 5});
                }),
            ),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });

        expect(
            validateAccessPolicyUpdate(
                eve,
                oldPolicy,
                produce(oldPolicy, policy => {
                    policy.accountGrantById.set(carol, {level: "Manage", generation: 1});
                }),
            ),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });
    });

    // ======================= CREATING TIES (should fail) =======================

    test("creating a tie where none existed is not allowed", () => {
        // Old: Alice(0), Bob(1), Carol(2) is actor New: Alice(0), Bob(0) - Bob promoted to
        // tie with Alice
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 1}],
                [carol, {level: "Manage", generation: 2}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(bob, {level: "Manage", generation: 0});
        });

        expect(validateAccessPolicyUpdate(carol, oldPolicy, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });
    });

    test("creating a tie at a generation lower than the actor\u2019s generation is not allowed", () => {
        // Old: Alice(0), Bob(1), Dan(3) is actor New: Alice(1), Bob(1) - Alice demoted to
        // tie with Bob
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 1}],
                [carol, {level: "Manage", generation: 2}],
                [dan, {level: "Manage", generation: 3}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(alice, {level: "Manage", generation: 1});
        });

        expect(validateAccessPolicyUpdate(dan, oldPolicy, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });
    });

    test("creating a new tie between two non-adjacent managers is not allowed", () => {
        // Old: Alice(0), Bob(1), Carol(2), Dan(4) is actor New: Alice(0), Bob(2),
        // Carol(2) - Bob and Carol now tied
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 1}],
                [carol, {level: "Manage", generation: 2}],
                [dan, {level: "Manage", generation: 4}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(bob, {level: "Manage", generation: 2});
        });

        expect(validateAccessPolicyUpdate(dan, oldPolicy, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });
    });

    // ======================= PRESERVING TIES (should pass) =======================

    test("preserving a tie while shifting generations is allowed", () => {
        // Old: Alice(0), Bob(0) tied, Carol(2) is actor New: Alice(1), Bob(1) - still
        // tied, just different generation
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 0}],
                [carol, {level: "Manage", generation: 2}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(alice, {level: "Manage", generation: 1});
            policy.accountGrantById.set(bob, {level: "Manage", generation: 1});
        });

        expect(validateAccessPolicyUpdate(carol, oldPolicy, newPolicy)).toEqual({
            ok: true,
        });
    });

    test("preserving multiple ties with generation shift is allowed", () => {
        // Old: Alice(0), Bob(0) tied, Carol(1), Dan(1) tied, Eve(5) is actor New:
        // Alice(2), Bob(2) still tied, Carol(3), Dan(3) still tied
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 0}],
                [carol, {level: "Manage", generation: 1}],
                [dan, {level: "Manage", generation: 1}],
                [eve, {level: "Manage", generation: 5}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(alice, {level: "Manage", generation: 2});
            policy.accountGrantById.set(bob, {level: "Manage", generation: 2});
            policy.accountGrantById.set(carol, {level: "Manage", generation: 3});
            policy.accountGrantById.set(dan, {level: "Manage", generation: 3});
        });

        expect(validateAccessPolicyUpdate(eve, oldPolicy, newPolicy)).toEqual({
            ok: true,
        });
    });

    test("no ties before and no ties after is allowed", () => {
        // Old: Alice(0), Bob(1), Carol(2), Dan(4) is actor New: Alice(1), Bob(2),
        // Carol(3) - all shifted but no ties created
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 1}],
                [carol, {level: "Manage", generation: 2}],
                [dan, {level: "Manage", generation: 4}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(alice, {level: "Manage", generation: 1});
            policy.accountGrantById.set(bob, {level: "Manage", generation: 2});
            policy.accountGrantById.set(carol, {level: "Manage", generation: 3});
        });

        expect(validateAccessPolicyUpdate(dan, oldPolicy, newPolicy)).toEqual({
            ok: true,
        });
    });

    test("tie at beginning of chain cannot be broken", () => {
        // Old: Alice(0), Bob(0) tied at start, Carol(1), Dan(3) is actor New: Alice(0),
        // Bob(1), Carol(2) - tie broken
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 0}],
                [carol, {level: "Manage", generation: 1}],
                [dan, {level: "Manage", generation: 3}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(bob, {level: "Manage", generation: 1});
            policy.accountGrantById.set(carol, {level: "Manage", generation: 2});
        });

        expect(validateAccessPolicyUpdate(dan, oldPolicy, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });
    });

    test("tie at end of chain cannot be broken", () => {
        // Old: Alice(0), Bob(1), Carol(1) tied at end, Dan(3) is actor New: Alice(0),
        // Bob(1), Carol(2) - tie broken
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 1}],
                [carol, {level: "Manage", generation: 1}],
                [dan, {level: "Manage", generation: 3}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(carol, {level: "Manage", generation: 2});
        });

        expect(validateAccessPolicyUpdate(dan, oldPolicy, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });
    });

    test("tie in middle of chain cannot be broken", () => {
        // Old: Alice(0), Bob(1), Carol(1), Dan(2), Eve(4) is actor New: Alice(0), Bob(1),
        // Carol(2), Dan(3) - Bob/Carol tie broken
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 1}],
                [carol, {level: "Manage", generation: 1}],
                [dan, {level: "Manage", generation: 2}],
                [eve, {level: "Manage", generation: 4}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(carol, {level: "Manage", generation: 2});
            policy.accountGrantById.set(dan, {level: "Manage", generation: 3});
        });

        expect(validateAccessPolicyUpdate(eve, oldPolicy, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });
    });

    test("all seniors tied remains valid when tie preserved", () => {
        // Old: Alice(0), Bob(0), Carol(0) all tied, Dan(1) is actor New: Alice(0), Bob(0),
        // Carol(0) - unchanged
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 0}],
                [carol, {level: "Manage", generation: 0}],
                [dan, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        // No changes to senior chain
        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(dan, {level: "Manage", generation: 2}); // Only change junior
        });

        expect(validateAccessPolicyUpdate(dan, oldPolicy, newPolicy)).toEqual({
            ok: true,
        });
    });

    test("actor as part of existing tie - removing peer is allowed", () => {
        // Old: Alice(0), Bob(0) tied (both owners), Carol(1) Alice removes Bob - peers can
        // remove each other
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 0}],
                [carol, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.delete(bob);
        });

        expect(validateAccessPolicyUpdate(alice, oldPolicy, newPolicy)).toEqual({
            ok: true,
        });
    });

    test("can add generation tie to actor that didn\u2019t have one before", () => {
        // Old: Alice(0), Bob(0) tied (both owners), Carol(1) Alice removes Bob - peers can
        // remove each other
        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 1}],
                [carol, {level: "Manage", generation: 2}], // <-- actor
                [dan, {level: "Manage", generation: 3}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(dan, {level: "Manage", generation: 2});
        });

        // ```
        // old: [{alice}, {bob}, {carol (actor)}, {dan}]
        // new: [{alice}, {bob}, {dan}, {carol}]
        // ```
        expect(validateAccessPolicyUpdate(carol, oldPolicy, newPolicy)).toEqual({
            ok: true,
        });
    });

    test("shifting all generations while preserving exact tie structure is allowed", () => {
        // Old: Alice(0), Bob(0), Carol(2), Dan(2), Eve(3), actor at gen 10 New: Alice(1),
        // Bob(1), Carol(4), Dan(4), Eve(5) - same tie structure, shifted
        const actor = generateId<AccountId>();

        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 0}],
                [carol, {level: "Manage", generation: 2}],
                [dan, {level: "Manage", generation: 2}],
                [eve, {level: "Manage", generation: 3}],
                [actor, {level: "Manage", generation: 10}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(alice, {level: "Manage", generation: 1});
            policy.accountGrantById.set(bob, {level: "Manage", generation: 1});
            policy.accountGrantById.set(carol, {level: "Manage", generation: 4});
            policy.accountGrantById.set(dan, {level: "Manage", generation: 4});
            policy.accountGrantById.set(eve, {level: "Manage", generation: 5});
        });

        expect(validateAccessPolicyUpdate(actor, oldPolicy, newPolicy)).toEqual({
            ok: true,
        });
    });

    test("cannot change tie structure even with same relative ordering", () => {
        // Old: Alice(0), Bob(1), Carol(2), actor at gen 10 New: Alice(0), Bob(0),
        // Carol(2) - Bob promoted into tie with Alice Same relative order (Alice, Bob,
        // Carol) but tie structure changed
        const actor = generateId<AccountId>();

        const oldPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 1}],
                [carol, {level: "Manage", generation: 2}],
                [actor, {level: "Manage", generation: 10}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(bob, {level: "Manage", generation: 0}); // Creates tie
        });

        expect(validateAccessPolicyUpdate(actor, oldPolicy, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t reorder manage grant generations",
        });
    });
});

describe("validateAccessPolicyUpdate with accounts removed from the space", () => {
    // Setup: alice (gen 0), bob (gen 1), charlie (gen 2). Bob is removed from the
    // space in most tests below, which simulates moving an entity into a site whose
    // access policy doesn't include managers that left the space.
    const alice = generateId<AccountId>();
    const bob = generateId<AccountId>();
    const charlie = generateId<AccountId>();

    const oldPolicy: LocalAccessPolicy = {
        type: "Local",
        accountGrantById: new Map([
            [alice, {level: "Manage", generation: 0}],
            [bob, {level: "Manage", generation: 1}],
            [charlie, {level: "Manage", generation: 2}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    };

    function isBobRemovedFromSpace(accountId: AccountId) {
        return accountId === bob;
    }

    test("actor can drop a removed senior manager and take over their generation", () => {
        // Charlie (gen 2) drops bob (gen 1) and takes over his generation. This would
        // normally be an illegal escalation past bob, but bob was removed from the space.
        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.delete(bob);
            policy.accountGrantById.set(charlie, {level: "Manage", generation: 1});
        });

        expect(
            validateAccessPolicyUpdate(charlie, oldPolicy, newPolicy, {
                isAccountRemovedFromSpace: isBobRemovedFromSpace,
            }),
        ).toEqual({ok: true});
    });

    test("actor can\u2019t drop a senior manager who is still a member of the space", () => {
        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.delete(bob);
            policy.accountGrantById.set(charlie, {level: "Manage", generation: 1});
        });

        // Same change as the previous test, but the callback reports everyone as a space
        // member, so dropping bob is an illegal revocation.
        expect(
            validateAccessPolicyUpdate(charlie, oldPolicy, newPolicy, {
                isAccountRemovedFromSpace: () => false,
            }),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        });

        // Not providing the callback at all behaves the same way.
        expect(validateAccessPolicyUpdate(charlie, oldPolicy, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        });
    });

    test("actor can demote a removed senior manager to a non-manage level", () => {
        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.set(bob, {level: "Edit"});
        });

        expect(
            validateAccessPolicyUpdate(charlie, oldPolicy, newPolicy, {
                isAccountRemovedFromSpace: isBobRemovedFromSpace,
            }),
        ).toEqual({ok: true});
    });

    test("removed account with a senior manage grant in the new policy doesn\u2019t block the update", () => {
        // Simulates moving an entity into a site whose policy includes a removed manager
        // at a generation that ties with the actor's.
        const oldPolicyWithoutBob: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[charlie, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicyWithoutBob, policy => {
            policy.accountGrantById.set(bob, {level: "Manage", generation: 0});
        });

        expect(
            validateAccessPolicyUpdate(charlie, oldPolicyWithoutBob, newPolicy, {
                isAccountRemovedFromSpace: isBobRemovedFromSpace,
            }),
        ).toEqual({ok: true});

        // Without space membership awareness this is an illegal promotion of bob to a
        // generation equal to the actor's.
        expect(validateAccessPolicyUpdate(charlie, oldPolicyWithoutBob, newPolicy)).toEqual({
            ok: false,
            reason: "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
        });
    });

    test("update fails when every manager in the new policy was removed from the space", () => {
        const oldPolicySoloCharlie: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[charlie, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Charlie demotes himself and hands manage access to bob, who was removed from the
        // space. The policy would be left without any active manager.
        const newPolicy = produce(oldPolicySoloCharlie, policy => {
            policy.accountGrantById.set(charlie, {level: "Edit"});
            policy.accountGrantById.set(bob, {level: "Manage", generation: 1});
        });

        expect(
            validateAccessPolicyUpdate(charlie, oldPolicySoloCharlie, newPolicy, {
                isAccountRemovedFromSpace: isBobRemovedFromSpace,
            }),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t update access policy so that no one has manage access",
        });
    });

    test("removed managers are ignored when comparing manage generation groups", () => {
        // Bob is tied with alice at gen 0 in the old policy. Once bob is removed from the
        // space, dropping him shouldn't read as "breaking the tie".
        const dave = generateId<AccountId>();
        const oldPolicyWithTie: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 0}],
                [dave, {level: "Manage", generation: 1}],
                [charlie, {level: "Manage", generation: 2}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        const newPolicy = produce(oldPolicyWithTie, policy => {
            policy.accountGrantById.delete(bob);
        });

        expect(
            validateAccessPolicyUpdate(charlie, oldPolicyWithTie, newPolicy, {
                isAccountRemovedFromSpace: isBobRemovedFromSpace,
            }),
        ).toEqual({ok: true});
    });

    test("actor can\u2019t use a removed manager to escalate past an active senior manager", () => {
        // Bob (gen 1) was removed from the space but alice (gen 0) is still active.
        // Charlie can take over bob's generation but can't touch alice.
        const newPolicy = produce(oldPolicy, policy => {
            policy.accountGrantById.delete(alice);
            policy.accountGrantById.delete(bob);
            policy.accountGrantById.set(charlie, {level: "Manage", generation: 0});
        });

        expect(
            validateAccessPolicyUpdate(charlie, oldPolicy, newPolicy, {
                isAccountRemovedFromSpace: isBobRemovedFromSpace,
            }),
        ).toEqual({
            ok: false,
            reason: "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        });
    });
});

describe("isSiteRelatedPolicyUpdate", () => {
    const siteA = generateId<SiteId>();
    const siteB = generateId<SiteId>();
    const alice = generateId<AccountId>();

    const localPolicy: LocalAccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    const siteAPolicy: ResolvedAccessPolicyWithGenerations = {
        type: "Site",
        siteId: siteA,
        accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    const siteBPolicy: ResolvedAccessPolicyWithGenerations = {
        type: "Site",
        siteId: siteB,
        accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    test("returns true when adding to site (Local → Site)", () => {
        expect(isSiteRelatedAccessPolicyUpdate(localPolicy, siteAPolicy)).toBe(true);
    });

    test("returns true when removing from site (Site → Local)", () => {
        expect(isSiteRelatedAccessPolicyUpdate(siteAPolicy, localPolicy)).toBe(true);
    });

    test("returns true when changing sites (Site A → Site B)", () => {
        expect(isSiteRelatedAccessPolicyUpdate(siteAPolicy, siteBPolicy)).toBe(true);
    });

    test("returns false when staying local (Local → Local)", () => {
        const updatedLocalPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        };
        expect(isSiteRelatedAccessPolicyUpdate(localPolicy, updatedLocalPolicy)).toBe(false);
    });

    test("returns false when staying in same site (Site A → Site A)", () => {
        const updatedSiteAPolicy: ResolvedAccessPolicyWithGenerations = {
            type: "Site",
            siteId: siteA,
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        };
        expect(isSiteRelatedAccessPolicyUpdate(siteAPolicy, updatedSiteAPolicy)).toBe(false);
    });

    test("returns true when creating new entity in site (null → Site)", () => {
        expect(isSiteRelatedAccessPolicyUpdate(null, siteAPolicy)).toBe(true);
    });

    test("returns false when creating new entity not in site (null → Local)", () => {
        expect(isSiteRelatedAccessPolicyUpdate(null, localPolicy)).toBe(false);
    });
});
