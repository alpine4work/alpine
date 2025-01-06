import {
    AccessLevel,
    AccessPolicy,
    AccessPolicyAccountGrant,
} from "~/shared/access/access_policy.js";
import {emptyMap} from "~/shared/helpers/array/empty_map.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {AccountId} from "~/shared/id/types/id_types.js";

// Can only be imported in a test environment. We put this directly in the
// `//server/access` module instead of creating a new `testonly = True`
// `//server/access:test_helpers` module for simplicity. This module doesn't
// need any other test helper dependencies.
assert(process.env.NODE_ENV === "test");

export type TestAccessPolicyOption = AccessPolicy | TestAccessPolicy | "public" | "private";

export function buildTestAccessPolicyOption(
    option: TestAccessPolicyOption,
    actorAccountId: AccountId,
): AccessPolicy {
    if (typeof option === "string") {
        return TestAccessPolicy[option].build(actorAccountId);
    }

    if (option instanceof TestAccessPolicy) {
        return option.build(actorAccountId);
    }

    return option;
}

type TestAccessPolicyAccount = AccountId | {id: AccountId} | {account: {id: AccountId}};

type TestAccessPolicyAccountGrant =
    | TestAccessPolicyAccount
    | readonly [TestAccessPolicyAccount, AccessLevel];

function getTestAccessPolicyAccountId(account: TestAccessPolicyAccount): AccountId {
    if (typeof account === "string") return account;
    if ("account" in account) return account.account.id;
    return account.id;
}

function getTestAccessPolicyAccountGrant(
    accountGrant: TestAccessPolicyAccountGrant,
): [AccountId, AccessPolicyAccountGrant] {
    if (!isReadonlyArray(accountGrant))
        return [getTestAccessPolicyAccountId(accountGrant), {level: "Edit"}];

    return [getTestAccessPolicyAccountId(accountGrant[0]), {level: accountGrant[1]}];
}

export class TestAccessPolicy {
    public static readonly public = new TestAccessPolicy(() => ({
        accountGrantById: emptyMap,
        defaultGrant: {type: "Space", level: "Manage"},
    }));

    public static readonly private = new TestAccessPolicy(actorAccountId => ({
        accountGrantById: new Map([[actorAccountId, {level: "Manage"}]]),
        defaultGrant: null,
    }));

    public readonly build: (actorAccountId: AccountId) => AccessPolicy;

    private constructor(build: (actorAccountId: AccountId) => AccessPolicy) {
        this.build = build;
    }

    public with(account: TestAccessPolicyAccount, level: AccessLevel): TestAccessPolicy;
    public with(...accountGrants: Array<TestAccessPolicyAccountGrant>): TestAccessPolicy;
    public with(
        ...accountGrants:
            | Array<TestAccessPolicyAccountGrant>
            | [TestAccessPolicyAccount, AccessLevel]
    ): TestAccessPolicy {
        let actualAccountGrants: Array<TestAccessPolicyAccountGrant>;

        if (typeof accountGrants[1] === "string") {
            actualAccountGrants = [accountGrants as [TestAccessPolicyAccount, AccessLevel]];
        } else {
            actualAccountGrants = accountGrants as Array<TestAccessPolicyAccountGrant>;
        }

        return new TestAccessPolicy(actorAccountId => {
            const accessPolicy = this.build(actorAccountId);

            return {
                accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>(
                    concatIterables(
                        accessPolicy.accountGrantById,
                        actualAccountGrants.map(getTestAccessPolicyAccountGrant),
                    ),
                ),
                defaultGrant: accessPolicy.defaultGrant,
            };
        });
    }

    public withDefault(level: AccessLevel | null) {
        return new TestAccessPolicy(actorAccountId => {
            const accessPolicy = this.build(actorAccountId);

            return {
                accountGrantById: accessPolicy.accountGrantById,
                defaultGrant: level !== null ? {type: "Space", level} : null,
            };
        });
    }
}
