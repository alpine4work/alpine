// This file contains helper functions for converting data structures in our
// internal format to data structures expected by `TaskRealtimeProtocol`. For
// instance converting `TaskIndexDoc` to `TaskModel`.

import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {maxHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel, TaskModelData} from "~/shared/tasks/model/task_model.js";
import {TaskTitleModel} from "~/shared/tasks/model/task_title_model.js";
import {TaskAssigneeActivePositionRegister} from "~/shared/tasks/task_assignee_active_position.js";
import {TaskPositionByAccountIdAndNotepadPageIdMap} from "~/shared/tasks/task_position_by_account_id_and_notepad_page_id.js";

/**
 * Prepares an authorized task for the client. We assume the task is authorized
 * by this point but there's still some data within a task clients are not
 * allowed to see. (e.g. The position of this task in the assignee's active
 * section.)
 *
 * We also need to convert the task to a `TaskModel`.
 */
export function prepareTaskForClient(accountId: AccountId, task: TaskIndexDoc): TaskModel {
    return new TaskModel({
        id: task.id,
        spaceId: task.spaceId,

        creator: task.creator,
        createdTime: task.createdTime,
        deletedTime: task.rawDeletedTime,
        undeletedTime: task.rawUndeletedTime,

        // NOTE(calebmer, #security): If a task has a parent that we're not authorized
        // to view, we still send the `TaskId` of the parent and the child's
        // `TaskPosition` in the parent. An attacker with technical sophistication
        // could use this to determine which tasks they *can* view share the same
        // parent and their relative positions.
        //
        // Example exploit: Let's say our company is working on a secret project. I and
        // a coworker both are assigned a child task to a parent task in this secret
        // project. We can compare the `parentTaskId` on our secret tasks to know we
        // are working on the same thing.
        //
        // The exploits you can perform with this information aren't that bad and it
        // would be a real pain to hide this information in realtime so we leave it
        // as is for now.
        parent: {
            taskId: task.parent.taskId,
            position: task.parent.rawPosition,
        },
        addedChildTaskCount: task.addedChildTaskCount,
        removedChildTaskCount: task.removedChildTaskCount,
        addedClosedChildTaskCount: task.addedClosedChildTaskCount,
        removedClosedChildTaskCount: task.removedClosedChildTaskCount,

        // NOTE(calebmer, #security): If a task has a collection that we're not
        // authorized to view, we still send the `TaskCollectionId` of the collection
        // and the `TaskPosition` in the collection. An attacker with technical
        // sophistication could use this to determine which tasks they *can* view are
        // in a secret collection.
        //
        // Example exploit: A team's manager might have a private "evidence for firing"
        // collection for an employee. You could observe that multiple tasks in a
        // shared team collection have this private `TaskCollectionId` and they're all
        // tasks of a certain employee and you might be able to guess what the
        // collection is for.
        //
        // The exploits you can perform with this information aren't that bad and it
        // would be a real pain to hide this information in realtime so we leave it
        // as is for now.
        collections: task.collections.raw.collections,
        positionByCollectionId: task.collections.raw.positionById,

        // Account is only allowed to see the positions of tasks in their own notepad
        // pages. The session account never changes so this doesn't need to respond in
        // realtime.
        positionByAccountIdAndNotepadPageId: reduceIterable(
            filterIterable(task.notepadPages.raw.positionById.actualEntries(), ([key]) =>
                key.startsWith(accountId),
            ),
            (positionById, [key, {value, version}]) =>
                value !== null
                    ? positionById.apply({type: "Set", key, value, version})
                    : // It's important that we also add deleted values to the map so if an event is
                      // a position update is received out-of-order the delete wins.
                      positionById.apply({type: "Delete", key, version}),
            TaskPositionByAccountIdAndNotepadPageIdMap.empty,
        ),

        status: task.status,
        assignee: task.assignee,
        assigneeStatus: task.rawAssigneeStatus,
        // You are not allowed to see the active task position for other accounts. So
        // replace with a register you'd get on position reset from status, assignee,
        // or assignee status change. This effectively un-applies any actions you
        // aren't allowed to see.
        assigneeActivePosition:
            task.rawAssigneeActivePosition.value &&
            task.rawAssigneeActivePosition.value.accountId !== accountId
                ? new TaskAssigneeActivePositionRegister(
                      null,
                      maxHybridLogicalTime(
                          task.status.version,
                          task.assignee.version,
                          task.rawAssigneeStatus.version,
                      ),
                  )
                : task.rawAssigneeActivePosition,

        title: TaskTitleModel.new(task.title.raw),
        dueDate: task.dueDate,
        priority: task.priority,
    });
}

export function prepareTaskCollectionForClient(
    collection: TaskCollectionIndexDoc,
): TaskCollectionModel {
    return new TaskCollectionModel({
        id: collection.id,
        spaceId: collection.spaceId,
        createdTime: collection.createdTime,
        deletedTime: collection.rawDeletedTime,
        undeletedTime: collection.rawUndeletedTime,
        name: collection.name,
        accessPolicy: collection.accessPolicy,
    });
}

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
                case "UpdateAccessPolicy":
                    return action;
                default:
                    throw exhaustive(action.collectionAction);
            }
        }
        case "UpdateNotepadPage": {
            cast<"Create">(action.notepadPageAction.type);
            return action;
        }
        default:
            throw exhaustive(action);
    }
}

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

/**
 * Get all the `AccountId`s referenced by a task action.
 */
export function collectReferencedAccountIdsFromTaskAction(
    accountIds: Set<AccountId>,
    action: TaskAction,
) {
    switch (action.type) {
        case "UpdateTask": {
            switch (action.taskAction.type) {
                case "Create": {
                    accountIds.add(action.taskAction.creator.accountId);
                    return;
                }
                case "UpdateNotepadPagePosition": {
                    accountIds.add(action.taskAction.accountId);
                    return;
                }
                case "UpdateStatus": {
                    if (action.taskAction.status.type === "Closed") {
                        accountIds.add(action.taskAction.status.closer.accountId);
                    }
                    return;
                }
                case "UpdateAssignee": {
                    if (action.taskAction.assignee) {
                        accountIds.add(action.taskAction.assignee.assignee.accountId);
                        accountIds.add(action.taskAction.assignee.assigner.accountId);
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
                case "Create":
                case "Delete":
                case "Undelete":
                case "UpdateName":
                case "UpdateAccessPolicy": {
                    // The client doesn't expect access policy accounts to be loaded. We'll load
                    // these accounts when the sharing modal opens.
                    return;
                }
                default:
                    throw exhaustive(action.collectionAction);
            }
        }
        case "UpdateNotepadPage": {
            cast<"Create">(action.notepadPageAction.type);
            accountIds.add(action.accountId);
            return action;
        }
        default:
            throw exhaustive(action);
    }
}
