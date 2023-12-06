import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

/**
 * Prepares a task action before we send it to the client. When we call this
 * function we've already authorized that the `TaskAction` is against an entity
 * the account has access to. However, the action may still contain some data
 * the account is not allowed to see. So filter out that data before sending an
 * event.
 *
 * If this function returns null then we shouldn't send the action to the
 * client.
 */
export function prepareTaskActionForClient(
    accountId: AccountId,
    action: TaskAction,
): TaskAction | null {
    switch (action.type) {
        case "UpdateTask": {
            switch (action.taskAction.type) {
                case "Create":
                case "Delete":
                case "Undelete":
                case "UpdateParentTaskId":
                case "UpdateParentPosition":
                case "UpdateChildrenCounts":
                case "AddCollection":
                case "RemoveCollection":
                case "UpdateCollectionPosition":
                case "UpdateStatus":
                case "UpdateAssignee":
                case "UpdateTitle":
                case "UpdateDueDate":
                case "UpdatePriority":
                case "UpdateAssigneeStatus":
                    return action;
                case "UpdateNotepadPagePosition": {
                    if (action.taskAction.accountId !== accountId) return null;
                    return action;
                }
                case "UpdateAssigneeActivePosition": {
                    if (action.taskAction.accountId !== accountId) return null;
                    return action;
                }
                default:
                    throw exhaustive(action.taskAction);
            }
        }
        case "UpdateCollection": {
            switch (action.collectionAction.type) {
                case "Create":
                case "Delete":
                case "Undelete":
                case "UpdateName":
                case "UpdateColor":
                case "UpdateAccessPolicy":
                    return action;
                default:
                    throw exhaustive(action.collectionAction);
            }
        }
        case "UpdateNotepadPage": {
            if (action.accountId !== accountId) return null;

            cast<"Create">(action.notepadPageAction.type);
            return action;
        }
        case "UpdateAccountName": {
            return action;
        }
        default:
            throw exhaustive(action);
    }
}
