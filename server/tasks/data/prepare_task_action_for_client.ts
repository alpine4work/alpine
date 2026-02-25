import {TaskRealtimeActorInterface} from "~/server/tasks/data/task_realtime_actor_interface.js";
import {unknownAccountId} from "~/shared/accounts/account_model_without_space.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
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
export async function prepareTaskActionForClient(
    action: TaskAction,
    {
        actor,
        isSpaceAccessAuthorized,
        isCollectionAccessAuthorized,
    }: {
        actor: TaskRealtimeActorInterface;
        isSpaceAccessAuthorized: boolean;
        isCollectionAccessAuthorized: (collectionId: TaskCollectionId) => Promise<boolean>;
    },
): Promise<TaskAction | null> {
    switch (action.type) {
        case "UpdateTask": {
            switch (action.taskAction.type) {
                case "Delete":
                case "Undelete":
                case "UpdateParentTaskId":
                case "UpdateParentPosition":
                case "UpdateChildrenCounts":
                case "UpdateTitle":
                case "UpdateDueDate":
                case "UpdatePriority":
                case "UpdateAssigneeStatus":
                case "UpdateAccessPolicy":
                    return action;
                case "Create": {
                    if (!isSpaceAccessAuthorized) {
                        return {
                            ...action,
                            taskAction: {
                                ...action.taskAction,
                                creatorId: unknownAccountId,
                            },
                        };
                    }
                    return action;
                }
                case "UpdateStatus": {
                    if (!isSpaceAccessAuthorized && action.taskAction.status.type === "Closed") {
                        return {
                            ...action,
                            taskAction: {
                                ...action.taskAction,
                                status: {
                                    type: "Closed",
                                    closerId: unknownAccountId,
                                    closedTime: action.taskAction.status.closedTime,
                                },
                            },
                        };
                    }
                    return action;
                }
                case "UpdateAssignee": {
                    if (!isSpaceAccessAuthorized && action.taskAction.assignee) {
                        return {
                            ...action,
                            taskAction: {
                                ...action.taskAction,
                                assignee: {
                                    assigneeId: action.taskAction.assignee.assigneeId,
                                    assignerId: unknownAccountId,
                                    assignedTime: action.taskAction.assignee.assignedTime,
                                },
                            },
                        };
                    }
                    return action;
                }
                case "AddCollection":
                case "RemoveCollection":
                case "UpdateCollectionPosition": {
                    if (!(await isCollectionAccessAuthorized(action.taskAction.collectionId))) {
                        return null;
                    }
                    return action;
                }
                case "UpdateAssigneePosition": {
                    if (
                        (actor.type !== "Session" && actor.type !== "ImpersonatedAccount") ||
                        action.taskAction.accountId !== actor.getAccountId()
                    ) {
                        return null;
                    }
                    return action;
                }
                case "UpdateNotepadPagePosition":
                case "UpdateAssigneeActivePosition": {
                    return null;
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
        case "UpdateAccountName": {
            return action;
        }
        case "UpdateNotepadPage": {
            return null;
        }
        default:
            throw exhaustive(action);
    }
}
