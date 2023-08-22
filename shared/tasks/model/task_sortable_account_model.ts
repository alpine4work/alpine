import {AccountModel} from "~/shared/accounts/account_model.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * A `TaskSortableAccount` model that the server passes to the client. Models
 * are enriched with referenced data so the `AccountId` in
 * `TaskSortableAccount` is instead a `AccountModel`.
 *
 * See the `TaskSortableAccount` type for in-depth documentation on this class.
 *
 * Notably, account fields that we want to sort/group by in our task system are
 * sorted by account name. This means the account name needs to participate in
 * the task system so we normalize it. That way our database can index by
 * account name and clients have a correct view of the logical account name
 * even if it's behind the actual current account name.
 */
export class TaskSortableAccountModel extends Model(
    Schema.object({
        account: AccountModel.schema(),
        workingAccountName: LabelStringSchema,
    }),
) {}
