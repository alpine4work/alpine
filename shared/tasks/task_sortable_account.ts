import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";

/**
 * The representation of an account in a task that can be sorted. We can't sort by
 * `AccountId` alone since that's randomly generated. So we denormalize the
 * account's name into the task and keep it up to date in realtime.
 *
 * Users expect when they sort by accounts to see accounts in alphabetical order by
 * name. That means account name needs to be integrated with our query system.
 * However in practice it lives in a separate DynamoDB table from our task data and
 * has less strict realtime requirements than our task query system. So we store
 * the account name directly in the task and index it in OpenSearch.
 *
 * The account name within our task system may not be consistent with the account
 * name in the rest of the product. We don't have that requirement. However. the
 * account name should be consistent throughout our task system. The rest of the
 * product should eventually update to the right account name.
 */
export type TaskSortableAccount = SchemaType<typeof TaskSortableAccountSchema>;

export const TaskSortableAccountSchema = Schema.object({
    accountId: Schema.id<AccountId>(),
    workingAccountName: LabelStringSchema,
    workingAccountNameVersion: Schema.integer.default(0),
});

export function mergeTaskSortableAccounts(
    account1: TaskSortableAccount,
    account2: TaskSortableAccount,
): TaskSortableAccount {
    if (account1.accountId !== account2.accountId) {
        throw new FailedPreconditionError("Incompatible sortable accounts");
    }

    if (
        account1.workingAccountNameVersion === account2.workingAccountNameVersion &&
        account1.workingAccountName !== account2.workingAccountName
    ) {
        throw new FailedPreconditionError("Incompatible sortable accounts");
    }

    return account2.workingAccountNameVersion > account1.workingAccountNameVersion
        ? account2
        : account1;
}
