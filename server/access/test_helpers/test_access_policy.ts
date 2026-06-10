import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {
    AccessLevel,
    AccessPolicy,
    AccessPolicyAccountGrant,
    AccessPolicyUrlGrant,
    LocalAccessPolicy,
} from "~/shared/access/access_policy.js";
import {reduceAccessPolicy} from "~/shared/access/access_policy_action.js";
import {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export class TestAccessPolicy {
    public readonly get: () => Promise<AccessPolicy>;
    public readonly set: (
        session: TestSpaceSession,
        accessPolicy: CreateOrUpdateAccessPolicy,
    ) => Promise<void>;

    constructor({
        get,
        set,
    }: {
        get: () => Promise<AccessPolicy>;
        set: (session: TestSpaceSession, accessPolicy: CreateOrUpdateAccessPolicy) => Promise<void>;
    }) {
        this.get = get;
        this.set = set;
    }

    public async grant(
        session: TestSpaceSession,
        account: AccountId | TestAccount | TestSession,
        level: AccessLevel = "Manage",
    ): Promise<LocalAccessPolicy> {
        const accountId: AccountId =
            typeof account === "string"
                ? account
                : "account" in account
                  ? account.account.id
                  : "id" in account
                    ? account.id
                    : account;

        const oldAccessPolicy = await this.get();

        if (oldAccessPolicy.type === "Site") {
            throw new FailedPreconditionError(
                "Can\u2019t use `TestAccessPolicy` to modify the access policy of an entity in a site",
            );
        }

        const oldAccountGrant = oldAccessPolicy.accountGrantById.get(accountId);

        const newAccessPolicy = reduceAccessPolicy(
            session.account.id,
            oldAccessPolicy,
            oldAccountGrant === undefined
                ? {
                      type: "AddAccountGrants",
                      accountGrantById: new Map([[accountId, {level}]]),
                  }
                : {
                      type: "SetAccountGrantLevel",
                      accountId,
                      level,
                  },
        );

        await this.set(session, newAccessPolicy);

        return newAccessPolicy;
    }

    public async grantAccounts(
        session: TestSpaceSession,
        accounts: Iterable<AccountId | TestAccount | TestSession>,
        level: AccessLevel = "Manage",
    ): Promise<LocalAccessPolicy> {
        const oldAccessPolicy = await this.get();

        if (oldAccessPolicy.type === "Site") {
            throw new FailedPreconditionError(
                "Can\u2019t use `TestAccessPolicy` to modify the access policy of an entity in a site",
            );
        }

        const accountGrantById = new Map<
            AccountId,
            DistributiveOmit<AccessPolicyAccountGrant, "generation">
        >(
            mapIterable(accounts, account => {
                const accountId: AccountId =
                    "account" in account
                        ? account.account.id
                        : "id" in account
                          ? account.id
                          : account;

                // The `AddAccountGrants` action noops if the account is already granted. Don't
                // support granting an account that was already granted.
                assert(!oldAccessPolicy.accountGrantById.has(accountId));

                return [accountId, {level}];
            }),
        );

        const newAccessPolicy = reduceAccessPolicy(session.account.id, oldAccessPolicy, {
            type: "AddAccountGrants",
            accountGrantById,
        });

        await this.set(session, newAccessPolicy);

        return newAccessPolicy;
    }

    public async revoke(
        session: TestSpaceSession,
        account: AccountId | TestAccount | TestSession,
    ): Promise<LocalAccessPolicy> {
        const accountId: AccountId =
            typeof account === "string"
                ? account
                : "account" in account
                  ? account.account.id
                  : "id" in account
                    ? account.id
                    : account;

        const oldAccessPolicy = await this.get();

        if (oldAccessPolicy.type === "Site") {
            throw new FailedPreconditionError(
                "Can\u2019t use `TestAccessPolicy` to modify the access policy of an entity in a site",
            );
        }

        const newAccessPolicy = reduceAccessPolicy(session.account.id, oldAccessPolicy, {
            type: "DeleteAccountGrant",
            accountId,
        });

        await this.set(session, newAccessPolicy);

        return newAccessPolicy;
    }

    public async grantDefault(
        session: TestSpaceSession,
        level: AccessLevel = "Manage",
    ): Promise<LocalAccessPolicy> {
        const oldAccessPolicy = await this.get();

        if (oldAccessPolicy.type === "Site") {
            throw new FailedPreconditionError(
                "Can\u2019t use `TestAccessPolicy` to modify the access policy of an entity in a site",
            );
        }

        const newAccessPolicy = reduceAccessPolicy(
            session.account.id,
            oldAccessPolicy,
            oldAccessPolicy.defaultGrant === null
                ? {
                      type: "AddDefaultGrant",
                      defaultGrant: {level},
                  }
                : {
                      type: "SetDefaultGrantLevel",
                      level,
                  },
        );

        await this.set(session, newAccessPolicy);

        return newAccessPolicy;
    }

    public async revokeDefault(session: TestSpaceSession): Promise<LocalAccessPolicy> {
        const oldAccessPolicy = await this.get();

        if (oldAccessPolicy.type === "Site") {
            throw new FailedPreconditionError(
                "Can\u2019t use `TestAccessPolicy` to modify the access policy of an entity in a site",
            );
        }

        const newAccessPolicy = reduceAccessPolicy(session.account.id, oldAccessPolicy, {
            type: "DeleteDefaultGrant",
        });

        await this.set(session, newAccessPolicy);

        return newAccessPolicy;
    }

    public async grantUrl(
        session: TestSpaceSession,
        level: AccessPolicyUrlGrant["level"] = "View",
    ): Promise<LocalAccessPolicy> {
        const oldAccessPolicy = await this.get();

        if (oldAccessPolicy.type === "Site") {
            throw new FailedPreconditionError(
                "Can\u2019t use `TestAccessPolicy` to modify the access policy of an entity in a site",
            );
        }

        const newAccessPolicy = reduceAccessPolicy(
            session.account.id,
            oldAccessPolicy,
            oldAccessPolicy.urlGrant === null
                ? {
                      type: "AddUrlGrant",
                      urlGrant: {level},
                  }
                : {
                      type: "SetUrlGrantLevel",
                      level,
                  },
        );

        await this.set(session, newAccessPolicy);

        return newAccessPolicy;
    }

    public async revokeUrl(session: TestSpaceSession): Promise<LocalAccessPolicy> {
        const oldAccessPolicy = await this.get();

        if (oldAccessPolicy.type === "Site") {
            throw new FailedPreconditionError(
                "Can\u2019t use `TestAccessPolicy` to modify the access policy of an entity in a site",
            );
        }

        const newAccessPolicy = reduceAccessPolicy(session.account.id, oldAccessPolicy, {
            type: "DeleteUrlGrant",
        });

        await this.set(session, newAccessPolicy);

        return newAccessPolicy;
    }
}
