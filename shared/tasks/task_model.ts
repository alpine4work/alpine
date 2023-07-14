import {AccountModel} from "~/shared/accounts/account_model.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/label_string_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskTitleSchema} from "~/shared/tasks/task_title.js";

// NOCOMMIT: New documentation for this. What's the relationship with
// `TaskSortableAccount`? This should probably be `TaskSortableAccountModel`.
export class TaskAccountModel extends Model(
    Schema.object({
        staleAccount: AccountModel.schema(),
        accountName: LabelStringSchema,
    }),
) {
    public get id(): AccountId {
        return this.staleAccount.id;
    }

    public isEqual(other: TaskAccountModel): boolean {
        return this.id === other.id && this.accountName === other.accountName;
    }
}

/**
 * Representation of a task in our task system.
 */
export class TaskModel extends Model(
    Schema.object({
        id: Schema.id<TaskId>(),

        /** The account who created the task. */
        creator: TaskAccountModel.schema(),

        /** The time at which the task was created. */
        createdTime: TaskFilterableTime.schema,

        /** The title of the task. */
        title: TaskTitleSchema,

        /** The collections our task is in. */
        collections: TaskCollectionSet.schema,
    }),
) {
    // Lets us use `TaskModel` as a member of a union.
    public readonly type = undefined;
}
