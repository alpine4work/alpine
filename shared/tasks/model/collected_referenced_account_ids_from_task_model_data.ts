import {AccountId} from "~/shared/id/types/id_types.js";
import {TaskModelData} from "~/shared/tasks/model/task_model.js";

/**
 * Get all the `AccountId`s referenced by a task model.
 */
export function collectReferencedAccountIdsFromTaskModelData(
    accountIds: Set<AccountId>,
    task: TaskModelData,
) {
    accountIds.add(task.creator.accountId);

    if (task.status.value.type === "Closed") {
        accountIds.add(task.status.value.closer.accountId);
    }

    if (task.assignee.value) {
        accountIds.add(task.assignee.value.assignee.accountId);
        accountIds.add(task.assignee.value.assigner.accountId);
    }
}
