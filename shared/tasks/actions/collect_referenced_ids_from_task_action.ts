import {unknownAccountId} from "~/shared/accounts/account_model_without_space.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, SiteId} from "~/shared/id/types/id_types.js";
import {TaskActionMaybeModel} from "~/shared/tasks/actions/task_action_model.js";

/**
 * Get all the `AccountId`s and `SiteId`s referenced by a task action.
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
export function collectReferencedIdsFromTaskAction(
    accountIds: Set<AccountId>,
    siteIds: Set<SiteId>,
    action: TaskActionMaybeModel,
) {
    if (action.type === "UpdateTask" || action.type === "UpdateCollection") {
        collectReferencedAccountId(accountIds, action.actor?.accountId);
        collectReferencedAccountId(accountIds, action.actor?.from?.accountId);
    }

    switch (action.type) {
        case "UpdateTask": {
            switch (action.taskAction.type) {
                case "Create": {
                    collectReferencedAccountId(accountIds, action.taskAction.creator.accountId);

                    if (action.taskAction.accessPolicy?.type === "Site") {
                        siteIds.add(action.taskAction.accessPolicy.siteId);
                    }

                    return;
                }
                case "UpdateStatus": {
                    if (action.taskAction.status.type === "Closed") {
                        collectReferencedAccountId(accountIds, action.taskAction.status.closerId);
                    }
                    return;
                }
                case "UpdateAssignee": {
                    if (action.taskAction.assignee) {
                        collectReferencedAccountId(
                            accountIds,
                            action.taskAction.assignee.assigneeId,
                        );
                        collectReferencedAccountId(
                            accountIds,
                            action.taskAction.assignee.assignerId,
                        );
                    }
                    return;
                }
                case "UpdateAccessPolicy": {
                    if (action.taskAction.accessPolicy.type === "Site") {
                        siteIds.add(action.taskAction.accessPolicy.siteId);
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
                case "Create":
                case "UpdateAccessPolicy": {
                    if (action.collectionAction.accessPolicy.type === "Site") {
                        siteIds.add(action.collectionAction.accessPolicy.siteId);
                    }

                    return;
                }
                case "Delete":
                case "Undelete":
                case "UpdateName":
                case "UpdateColor":
                // Accounts referenced by default filters are rendered with
                // `TaskQueryFilterReferences` (loaded by route loaders) instead of the task
                // store's referenced accounts. So we don't consider them referenced here.
                case "UpdateDefaults": {
                    return;
                }
                default:
                    throw exhaustive(action.collectionAction);
            }
        }
        case "UpdateAccountName": {
            // We need to send an up-to-date `AccountModel` to the client with
            // `UpdateAccountName` actions.
            collectReferencedAccountId(accountIds, action.accountId);
            return;
        }
        case "UpdateNotepadPage": {
            return;
        }
        default:
            throw exhaustive(action);
    }
}

function collectReferencedAccountId(accountIds: Set<AccountId>, accountId: AccountId | undefined) {
    if (accountId === undefined || accountId === unknownAccountId) return;
    accountIds.add(accountId);
}
