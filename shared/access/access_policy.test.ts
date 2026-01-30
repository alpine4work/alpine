import {enableMapSet, produce} from "immer";
import {
    AccessLevel,
    AccessPolicy,
    compareAccessLevel,
    hasAccessLevel,
    maxAccessLevel,
    minAccessLevel,
    validateAccessPolicyUpdate,
} from "~/shared/access/access_policy.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

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

test("validates access policy updates without default grants", () => {
    const accountId1 = generateId<AccountId>();
    const accountId2 = generateId<AccountId>();
    const accountId3 = generateId<AccountId>();

    const accessPolicy1: AccessPolicy = {
        accountGrantById: new Map([[accountId1, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

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

    const accessPolicy2 = produce(accessPolicy1, accessPolicy => {
        accessPolicy.accountGrantById.set(accountId2, {level: "Manage", generation: 1});
    });

    expect(validateAccessPolicyUpdate(accountId1, accessPolicy1, accessPolicy2)).toEqual({
        ok: true,
    });

    expect(validateAccessPolicyUpdate(accountId1, accessPolicy2, accessPolicy1)).toEqual({
        ok: true,
    });

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

    const accessPolicy3 = produce(accessPolicy2, accessPolicy => {
        accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 2});
    });

    expect(validateAccessPolicyUpdate(accountId2, accessPolicy2, accessPolicy3)).toEqual({
        ok: true,
    });

    expect(validateAccessPolicyUpdate(accountId2, accessPolicy3, accessPolicy2)).toEqual({
        ok: true,
    });

    expect(validateAccessPolicyUpdate(accountId1, accessPolicy2, accessPolicy3)).toEqual({
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
                accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 3});
            }),
        ),
    ).toEqual({ok: false, reason: "Can\u2019t change account grant manage generation"});

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 3});
            }),
        ),
    ).toEqual({ok: false, reason: "Can\u2019t change account grant manage generation"});

    expect(
        validateAccessPolicyUpdate(
            accountId3,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 3});
            }),
        ),
    ).toEqual({ok: false, reason: "Can\u2019t change account grant manage generation"});

    expect(
        validateAccessPolicyUpdate(
            accountId1,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 1});
            }),
        ),
    ).toEqual({ok: false, reason: "Can\u2019t change account grant manage generation"});

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 1});
            }),
        ),
    ).toEqual({ok: false, reason: "Can\u2019t change account grant manage generation"});

    expect(
        validateAccessPolicyUpdate(
            accountId3,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.accountGrantById.set(accountId3, {level: "Manage", generation: 1});
            }),
        ),
    ).toEqual({ok: false, reason: "Can\u2019t change account grant manage generation"});

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
            accountId2,
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

    expect(
        validateAccessPolicyUpdate(
            accountId3,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.accountGrantById.delete(accountId3);
            }),
        ),
    ).toEqual({ok: true});

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
            accountId2,
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

test("validates access policy updates with default grants", () => {
    const accountId1 = generateId<AccountId>();
    const accountId2 = generateId<AccountId>();
    const accountId3 = generateId<AccountId>();

    const accessPolicy1: AccessPolicy = {
        accountGrantById: new Map([[accountId1, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    expect(
        validateAccessPolicyUpdate(
            accountId1,
            accessPolicy1,
            produce(accessPolicy1, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 0};
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t set new default grant manage generation to be less than or equal to our actor\u2019s manage generation",
    });

    const accessPolicy2 = produce(accessPolicy1, accessPolicy => {
        accessPolicy.defaultGrant = {level: "Manage", generation: 1};
    });

    expect(validateAccessPolicyUpdate(accountId1, accessPolicy1, accessPolicy2)).toEqual({
        ok: true,
    });

    expect(validateAccessPolicyUpdate(accountId1, accessPolicy2, accessPolicy1)).toEqual({
        ok: true,
    });

    expect(validateAccessPolicyUpdate(accountId2, accessPolicy1, accessPolicy2)).toEqual({
        ok: false,
        reason: "Can\u2019t update access policy unless actor has manage access",
    });

    expect(validateAccessPolicyUpdate(accountId2, accessPolicy2, accessPolicy1)).toEqual({
        ok: true,
    });

    expect(validateAccessPolicyUpdate(accountId3, accessPolicy1, accessPolicy2)).toEqual({
        ok: false,
        reason: "Can\u2019t update access policy unless actor has manage access",
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
    ).toEqual({ok: false, reason: "Can\u2019t change default grant manage generation"});

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 2};
            }),
        ),
    ).toEqual({ok: false, reason: "Can\u2019t change default grant manage generation"});

    expect(
        validateAccessPolicyUpdate(
            accountId3,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 2};
            }),
        ),
    ).toEqual({ok: false, reason: "Can\u2019t change default grant manage generation"});

    expect(
        validateAccessPolicyUpdate(
            accountId1,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 0};
            }),
        ),
    ).toEqual({ok: false, reason: "Can\u2019t change default grant manage generation"});

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 0};
            }),
        ),
    ).toEqual({ok: false, reason: "Can\u2019t change default grant manage generation"});

    expect(
        validateAccessPolicyUpdate(
            accountId3,
            accessPolicy3,
            produce(accessPolicy3, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 0};
            }),
        ),
    ).toEqual({ok: false, reason: "Can\u2019t change default grant manage generation"});

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

    expect(validateAccessPolicyUpdate(accountId2, accessPolicy4, accessPolicy3)).toEqual({
        ok: false,
        reason: "Can\u2019t set new default grant manage generation to be less than or equal to our actor\u2019s manage generation",
    });

    expect(validateAccessPolicyUpdate(accountId3, accessPolicy3, accessPolicy4)).toEqual({
        ok: true,
    });

    expect(validateAccessPolicyUpdate(accountId3, accessPolicy4, accessPolicy3)).toEqual({
        ok: false,
        reason: "Can\u2019t update access policy unless actor has manage access",
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
        reason: "Can\u2019t set new default grant manage generation to be less than or equal to our actor\u2019s manage generation",
    });

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy4,
            produce(accessPolicy4, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 1};
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t set new default grant manage generation to be less than or equal to our actor\u2019s manage generation",
    });

    expect(
        validateAccessPolicyUpdate(
            accountId2,
            accessPolicy4,
            produce(accessPolicy4, accessPolicy => {
                accessPolicy.defaultGrant = {level: "Manage", generation: 2};
            }),
        ),
    ).toEqual({
        ok: false,
        reason: "Can\u2019t set new default grant manage generation to be less than or equal to our actor\u2019s manage generation",
    });

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
