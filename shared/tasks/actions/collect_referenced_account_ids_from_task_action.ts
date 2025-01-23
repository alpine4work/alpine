import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

/**
 * Get all the `AccountId`s referenced by a task action.
 *
 * Not all `AccountId`s in `TaskAction` are considered referenced. We only
 * consider `AccountId`s to be referenced if they need to render in the UI (so
 * we need to load their `AccountModel`) or we sort by the account's name (so
 * we need to index tasks by the account name in OpenSearch).
 *
 * For example, the task assignee is considered referenced (we need to both
 * render the assignee and sort by assignee) but the `AccountId` in a notepad
 * page ID is not referenced since those accounts aren't rendered in the UI.
 * (The client should also only ever see its own notepad pages anyway.)
 */
export function collectReferencedAccountIdsFromTaskAction(
    accountIds: Set<AccountId>,
    action: TaskAction,
) {
    switch (action.type) {
        case "UpdateTask": {
            switch (action.taskAction.type) {
                case "Create": {
                    return;
                }
                case "UpdateStatus": {
                    return;
                }
                case "UpdateAssignee": {
                    if (action.taskAction.assignee) {
                        accountIds.add(action.taskAction.assignee.assigneeId);
                    }
                    return;
                }
                case "UpdateNotepadPagePosition": {
                    // Even though there is an `AccountId` in `UpdateNotepadPagePosition` we don't
                    // consider it referenced since the UI doesn't need to render or sort based on
                    // the notepad page's `AccountId`.
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
                case "UpdateAssigneeActivePosition":
                case "UpdateTitle":
                case "UpdateDueDate":
                case "UpdatePriority": {
                    return;
                }
                default:
                    throw exhaustive(action.taskAction);
            }
        }
        case "UpdateCollection": {
            switch (action.collectionAction.type) {
                case "UpdateAccessPolicy": {
                    // The client doesn't expect access policy accounts to be loaded. We'll load
                    // these accounts when the sharing modal opens.
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
        case "UpdateNotepadPage": {
            cast<"Create">(action.notepadPageAction.type);
            // Even though there is an `AccountId` in `UpdateNotepadPage` we don't
            // consider it referenced since the UI doesn't need to render or sort based on
            // the notepad page's `AccountId`.
            return;
        }
        case "UpdateAccountName": {
            // We need to send an up-to-date `AccountModel` to the client with
            // `UpdateAccountName` actions.
            accountIds.add(action.accountId);
            return;
        }
        default:
            throw exhaustive(action);
    }
}
