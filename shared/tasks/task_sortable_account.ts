import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.js";

type _TestAccountOptions =
    | {id: AccountId; name: string; nameVersion?: number}
    | {id: AccountId; initialName: string}
    | {id: AccountId; initialData: {name: string; nameVersion?: number}};

type TestAccountOptions = _TestAccountOptions | {account: _TestAccountOptions};

/**
 * The representation of an account in a task that can be sorted. We can't sort by
 * `AccountId` alone since that's randomly generated. So we denormalize the
 * account's name into the task and keep it up to date in realtime.
 *
 * Users expect when they sort by accounts to see accounts in alphabetical
 * order by name. That means account name needs to be integrated with our query
 * system. However in practice it lives in a separate DynamoDB table from our
 * task data and has less strict realtime requirements than our task query
 * system. So we store the account name directly in the task and index it in
 * OpenSearch.
 *
 * The account name within our task system may not be consistent with the
 * account name in the rest of the product. We don't have that requirement.
 * However. the account name should be consistent throughout our task system.
 * The rest of the product should eventually update to the right account name.
 */
// NOTE(calebmer, 2023-07-12): We don't yet have a system for keeping
// `AccountModel` up-to-date in realtime but I'd like us to have one
// eventually. My rough idea is to not actually maintain a realtime connection
// for account updates but rather if we get a new `AccountModel` from the
// network, somehow make sure we render the same `AccountModel` everywhere.
//
// In that case `AccountModel` would be more like a reference to a centralized
// map somewhere in the React component tree or HTTP response.
export class TaskSortableAccount {
    public readonly accountId: AccountId;
    public readonly workingAccountName: string;
    public readonly workingAccountNameVersion: number;

    constructor({
        accountId,
        workingAccountName,
        workingAccountNameVersion,
    }: {
        accountId: AccountId;
        workingAccountName: string;
        workingAccountNameVersion: number;
    }) {
        this.accountId = accountId;
        this.workingAccountName = workingAccountName;
        this.workingAccountNameVersion = workingAccountNameVersion;
    }

    public static readonly schema = Schema.object({
        accountId: Schema.id<AccountId>(),
        workingAccountName: LabelStringSchema,
        workingAccountNameVersion: Schema.integer.default(0),
    }).transform<TaskSortableAccount>({
        serialize: account => account,
        deserialize: account => new TaskSortableAccount(account),
    });

    public static from(accountStore: AccountClientStore, account: AccountModel) {
        const accountData = accountStore.getAccountStore(account).getSnapshot();

        return new TaskSortableAccount({
            accountId: account.id,
            workingAccountName: accountData.name,
            workingAccountNameVersion: accountData.version,
        });
    }

    /**
     * Create from a `TestSession` object we use in server tests (see
     * `createTestContext()`).
     */
    public static test(options: TestAccountOptions) {
        assert(process.env.NODE_ENV === "test");

        const account = "account" in options ? options.account : options;

        return new TaskSortableAccount({
            accountId: account.id,
            workingAccountName:
                "initialName" in account
                    ? account.initialName
                    : "initialData" in account
                    ? account.initialData.name
                    : account.name,
            workingAccountNameVersion: "nameVersion" in account ? account.nameVersion ?? 0 : 0,
        });
    }

    public isEqual(other: TaskSortableAccount): boolean {
        return (
            this.accountId === other.accountId &&
            this.workingAccountName === other.workingAccountName
        );
    }
}
