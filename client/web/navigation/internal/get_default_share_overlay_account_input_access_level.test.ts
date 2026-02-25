import {getDefaultShareOverlyAccountInputAccessLevel} from "~/client/web/navigation/internal/get_default_share_overlay_account_input_access_level.js";
import {AccessLevel, AccessPolicyWithoutGenerations} from "~/shared/access/access_policy.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

function createAccessPolicyWithoutGenerations({
    defaultGrant,
    accountGrantById = [],
}: {
    defaultGrant?: AccessLevel;
    accountGrantById?: ReadonlyArray<readonly [AccountId, AccessLevel]>;
}): AccessPolicyWithoutGenerations {
    return {
        accountGrantById: new Map(
            accountGrantById.map(([accountId, level]) => [accountId, {level}]),
        ),
        defaultGrant: defaultGrant ? {level: defaultGrant} : null,
        urlGrant: null,
    };
}

test("uses inherited default grant level when immediate policy has none", () => {
    const immediateAccessPolicy = createAccessPolicyWithoutGenerations({});
    const inheritedAccessPolicy = createAccessPolicyWithoutGenerations({
        defaultGrant: "View",
    });

    expect(
        getDefaultShareOverlyAccountInputAccessLevel(immediateAccessPolicy, inheritedAccessPolicy),
    ).toBe("View");
});

test("uses max default grant level across immediate and inherited policy", () => {
    const immediateAccessPolicy = createAccessPolicyWithoutGenerations({
        defaultGrant: "Manage",
    });
    const inheritedAccessPolicy = createAccessPolicyWithoutGenerations({
        defaultGrant: "View",
    });

    expect(
        getDefaultShareOverlyAccountInputAccessLevel(immediateAccessPolicy, inheritedAccessPolicy),
    ).toBe("Manage");
});

test("uses inherited account grants when choosing edit default", () => {
    const accountId = generateId<AccountId>();
    const immediateAccessPolicy = createAccessPolicyWithoutGenerations({});
    const inheritedAccessPolicy = createAccessPolicyWithoutGenerations({
        accountGrantById: [[accountId, "Edit"]],
    });

    expect(
        getDefaultShareOverlyAccountInputAccessLevel(immediateAccessPolicy, inheritedAccessPolicy),
    ).toBe("Edit");
});

test("does not default to edit when merged account grants become manage", () => {
    const accountId = generateId<AccountId>();
    const immediateAccessPolicy = createAccessPolicyWithoutGenerations({
        accountGrantById: [[accountId, "Manage"]],
    });
    const inheritedAccessPolicy = createAccessPolicyWithoutGenerations({
        accountGrantById: [[accountId, "Edit"]],
    });

    expect(
        getDefaultShareOverlyAccountInputAccessLevel(immediateAccessPolicy, inheritedAccessPolicy),
    ).toBe("Manage");
});
