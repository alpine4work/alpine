import {unknownAccountId} from "~/shared/accounts/account_model_without_space.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {TaskActionMaybeModel} from "~/shared/tasks/actions/task_action_model.js";

/**
 * Get all the `AccountId`s referenced by a task action.
 *
 * Not all `AccountId`s in `TaskAction` are considered referenced. We only consider
 * `AccountId`s to be referenced if they need to render in the UI (so we need to
 * load their `AccountModel`) or we sort by the account's name (so we need to index
 * tasks by the account name in OpenSearch).
 *
 * For example, the task assignee is considered referenced (we need to both render
 * the assignee and sort by assignee) but the `AccountId` in
 * `UpdateAssigneePosition` is not referenced since those accounts aren't rendered
 * in the UI.
 *
 * `prepareTaskActionForClient()` will replace accounts we're not allowed to see
 * with `unknownAccountId`. So we skip over any accounts with an unknown
 * `AccountId` in this function.
 */
export function collectReferencedAccountIdsFromTaskAction(
    accountIds: Set<AccountId>,
    action: TaskActionMaybeModel,
) {
    switch (action.type) {
        case "UpdateTask": {
            switch (action.taskAction.type) {
                case "Create": {
                    if (action.taskAction.creatorId !== unknownAccountId)
                        accountIds.add(action.taskAction.creatorId);
                    return;
                }
                case "UpdateStatus": {
                    if (action.taskAction.status.type === "Closed") {
                        if (action.taskAction.status.closerId !== unknownAccountId)
                            accountIds.add(action.taskAction.status.closerId);
                    }
                    return;
                }
                case "UpdateAssignee": {
                    if (action.taskAction.assignee) {
                        if (action.taskAction.assignee.assigneeId !== unknownAccountId)
                            accountIds.add(action.taskAction.assignee.assigneeId);
                        if (action.taskAction.assignee.assignerId !== unknownAccountId)
                            accountIds.add(action.taskAction.assignee.assignerId);
                    }
                    return;
                }
                case "Delete":
                case "Undelete":
                case "UpdateParentTaskId":
                case "UpdateParentPosition":
                case "UpdateChildrenCounts":
                case "AddCollection":
                case "RemoveCollection":
                case "UpdateCollectionPosition":
                case "UpdateAssigneeStatus":
                case "UpdateAssigneePosition":
                case "UpdateTitle":
                case "UpdateDueDate":
                case "UpdatePriority":
                case "UpdateLayout":
                case "UpdateAccessPolicy":
                case "UpdateNotepadPagePosition":
                case "UpdateAssigneeActivePosition": {
                    return;
                }
                default:
                    throw exhaustive(action.taskAction);
            }
        }
        case "UpdateCollection": {
            switch (action.collectionAction.type) {
                case "UpdateAccessPolicy": {
                    // The client doesn't expect access policy accounts to be loaded. We'll load these
                    // accounts when the sharing modal opens.
                    return;
                }
                case "Create":
                case "Delete":
                case "Undelete":
                case "UpdateName":
                case "UpdateColor": {
                    return;
                }
                default:
                    throw exhaustive(action.collectionAction);
            }
        }
        case "UpdateAccountName": {
            // We need to send an up-to-date `AccountModel` to the client with
            // `UpdateAccountName` actions.
            if (action.accountId !== unknownAccountId) accountIds.add(action.accountId);
            return;
        }
        case "UpdateNotepadPage": {
            return;
        }
        default:
            throw exhaustive(action);
    }
}
