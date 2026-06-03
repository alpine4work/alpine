import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {TaskUpdateAccountNameAction} from "~/shared/tasks/actions/task_action.js";
import {TaskAssigneeWithSortableAccountRegister} from "~/shared/tasks/task_assignee.js";
import {TaskStatusWithSortableAccountRegister} from "~/shared/tasks/task_status.js";

/**
 * Applies an `UpdateAccountName` action to a task. If the account is not
 * referenced in the task then the task will not be updated.
 *
 * This should have the same effect as when we run
 * `indexTaskUpdateAccountNameActionAssumingItsCommitted()` which uses the
 * OpenSearch [update by query API][1] to update our index. We use the update by
 * query API to perform a bulk `UpdateAccountName` update efficiently in OpenSearch
 * then we use this function to update our in-memory tasks in
 * `TaskRealtimeService`.
 *
 * [1]:
 *     https://opensearch.org/docs/latest/api-reference/document-apis/update-by-query/
 */
export function applyTaskUpdateAccountNameToTaskIndexDoc<
    Task extends Omit<TaskIndexDoc, "lastIndexSearchEntityJob">,
>(task: Task, action: TaskUpdateAccountNameAction): Task {
    if (task.creator.accountId === action.accountId) {
        if (
            task.creator.workingAccountNameVersion === action.accountNameVersion &&
            task.creator.workingAccountName !== action.accountName
        ) {
            throw new FailedPreconditionError("Incompatible account name update action");
        } else if (task.creator.workingAccountNameVersion < action.accountNameVersion) {
            task = {
                ...task,
                creator: {
                    accountId: action.accountId,
                    workingAccountName: action.accountName,
                    workingAccountNameVersion: action.accountNameVersion,
                    from: task.creator.from,
                },
            };
        }
    }

    if (
        task.status.value.type === "Closed" &&
        task.status.value.closer.accountId === action.accountId
    ) {
        if (
            task.status.value.closer.workingAccountNameVersion === action.accountNameVersion &&
            task.status.value.closer.workingAccountName !== action.accountName
        ) {
            throw new FailedPreconditionError("Incompatible account name update action");
        } else if (task.status.value.closer.workingAccountNameVersion < action.accountNameVersion) {
            task = {
                ...task,
                status: new TaskStatusWithSortableAccountRegister(
                    {
                        ...task.status.value,
                        closer: {
                            accountId: action.accountId,
                            workingAccountName: action.accountName,
                            workingAccountNameVersion: action.accountNameVersion,
                        },
                    },
                    task.status.version,
                ),
            };
        }
    }

    if (task.assignee.value && task.assignee.value.assignee.accountId === action.accountId) {
        if (
            task.assignee.value.assignee.workingAccountNameVersion === action.accountNameVersion &&
            task.assignee.value.assignee.workingAccountName !== action.accountName
        ) {
            throw new FailedPreconditionError("Incompatible account name update action");
        } else if (
            task.assignee.value.assignee.workingAccountNameVersion < action.accountNameVersion
        ) {
            task = {
                ...task,
                assignee: new TaskAssigneeWithSortableAccountRegister(
                    {
                        ...task.assignee.value,
                        assignee: {
                            accountId: action.accountId,
                            workingAccountName: action.accountName,
                            workingAccountNameVersion: action.accountNameVersion,
                        },
                    },
                    task.assignee.version,
                ),
            };
        }
    }

    if (task.assignee.value && task.assignee.value.assigner.accountId === action.accountId) {
        if (
            task.assignee.value.assigner.workingAccountNameVersion === action.accountNameVersion &&
            task.assignee.value.assigner.workingAccountName !== action.accountName
        ) {
            throw new FailedPreconditionError("Incompatible account name update action");
        } else if (
            task.assignee.value.assigner.workingAccountNameVersion < action.accountNameVersion
        ) {
            task = {
                ...task,
                assignee: new TaskAssigneeWithSortableAccountRegister(
                    {
                        ...task.assignee.value,
                        assigner: {
                            accountId: action.accountId,
                            workingAccountName: action.accountName,
                            workingAccountNameVersion: action.accountNameVersion,
                        },
                    },
                    task.assignee.version,
                ),
            };
        }
    }

    return task;
}
