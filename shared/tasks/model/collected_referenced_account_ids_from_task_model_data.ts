import {AccountId} from "~/shared/id/types/id_types.js";
import {TaskModelData} from "~/shared/tasks/model/task_model.js";

/**
 * Get all the `AccountId`s referenced by a task model.
 *
 * We should only collect the tasks which are visible from this task model. So
 * no creator, closer, or assigner. This is important from a permissions
 * perspective! For anonymous actors that have link access to a collection we
 * load account stubs for any referenced accounts. We only want to load account
 * stubs for accounts the anonymous actor can actually see. An anonymous
 * account can see the assignee, but they can't see the task closer.
 */
export function collectReferencedAccountIdsFromTaskModelData(
    accountIds: Set<AccountId>,
    task: TaskModelData,
) {
    if (task.assignee.value) {
        accountIds.add(task.assignee.value.assignee.accountId);
    }
}
