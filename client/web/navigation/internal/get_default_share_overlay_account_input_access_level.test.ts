import {getDefaultShareOverlyAccountInputAccessLevel} from "~/client/web/navigation/internal/get_default_share_overlay_account_input_access_level.js";
import {AccessLevel, ResolvedAccessPolicy} from "~/shared/access/access_policy.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

function createEffectiveAccessPolicy({
    defaultGrant,
    accountGrantById = [],
}: {
    defaultGrant?: AccessLevel;
    accountGrantById?: ReadonlyArray<readonly [AccountId, AccessLevel]>;
}): ResolvedAccessPolicy {
    return {
        type: "Local",
        accountGrantById: new Map(
            accountGrantById.map(([accountId, level]) => [accountId, {level}]),
        ),
        defaultGrant: defaultGrant ? {level: defaultGrant} : null,
        urlGrant: null,
    };
}

test("uses inherited default grant level when immediate policy has none", () => {
    const immediateAccessPolicy = createEffectiveAccessPolicy({});
    const inheritedAccessPolicy = createEffectiveAccessPolicy({
        defaultGrant: "View",
    });

    expect(
        getDefaultShareOverlyAccountInputAccessLevel(immediateAccessPolicy, inheritedAccessPolicy),
    ).toBe("View");
});

test("uses max default grant level across immediate and inherited policy", () => {
    const immediateAccessPolicy = createEffectiveAccessPolicy({
        defaultGrant: "Manage",
    });
    const inheritedAccessPolicy = createEffectiveAccessPolicy({
        defaultGrant: "View",
    });

    expect(
        getDefaultShareOverlyAccountInputAccessLevel(immediateAccessPolicy, inheritedAccessPolicy),
    ).toBe("Manage");
});

test("uses inherited account grants when choosing edit default", () => {
    const accountId = generateId<AccountId>();
    const immediateAccessPolicy = createEffectiveAccessPolicy({});
    const inheritedAccessPolicy = createEffectiveAccessPolicy({
        accountGrantById: [[accountId, "Edit"]],
    });

    expect(
        getDefaultShareOverlyAccountInputAccessLevel(immediateAccessPolicy, inheritedAccessPolicy),
    ).toBe("Edit");
});

test("does not default to edit when merged account grants become manage", () => {
    const accountId = generateId<AccountId>();
    const immediateAccessPolicy = createEffectiveAccessPolicy({
        accountGrantById: [[accountId, "Manage"]],
    });
    const inheritedAccessPolicy = createEffectiveAccessPolicy({
        accountGrantById: [[accountId, "Edit"]],
    });

    expect(
        getDefaultShareOverlyAccountInputAccessLevel(immediateAccessPolicy, inheritedAccessPolicy),
    ).toBe("Manage");
});
