import {TaskIndexDocBase} from "~/server/tasks/data/task_index_doc.js";
import {TaskRealtimeActorInterface} from "~/server/tasks/data/task_realtime_actor_interface.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskAssigneeWithSortableAccountRegister} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneePositionRegister} from "~/shared/tasks/task_assignee_position.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskPositionByCollectionIdMap} from "~/shared/tasks/task_position_by_collection_id_map.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatusWithSortableAccountRegister} from "~/shared/tasks/task_status.js";
import {TaskTitleModel} from "~/shared/tasks/title/task_title.js";

const unknownTaskSortableAccount = new Lazy((): TaskSortableAccount => {
    const unknownAccount = AccountModel.getUnknown();

    return {
        accountId: unknownAccount.id,
        workingAccountName: unknownAccount.initialData.name,
        workingAccountNameVersion: unknownAccount.initialData.nameVersion,
    };
});

/**
 * Prepares an authorized task for the client. We assume the task is authorized
 * by this point but there's still some data within a task clients are not
 * allowed to see. (e.g. The position of this task in the assignee's active
 * section.)
 *
 * We also need to convert the task to a `TaskModel`.
 *
 * If null is passed in for `actorAccountId` we wipe all potentially private
 * data from the task as a safety precaution. This may not be what you want if
 * you're using a system context.
 */
export async function prepareTaskForClient(
    task: TaskIndexDocBase & {id: TaskId},
    {
        actor,
        isSpaceAccessAuthorized,
        isCollectionAccessAuthorized,
    }: {
        actor: TaskRealtimeActorInterface;
        isSpaceAccessAuthorized: boolean;
        isCollectionAccessAuthorized: (collectionId: TaskCollectionId) => Promise<boolean>;
    },
): Promise<TaskModel> {
    // Filter out any collections our client doesn't currently have access to. When
    // the authorization state of a task collection changes we'll backfill all
    // tasks that include the newly authorized collection. The client will merge in
    // these changes and now see the newly authorized collection in its various
    // tasks.
    //
    // If a collection was authorized and becomes unauthorized then we don't
    // actually remove the collections from the client's `TaskCollectionSet` CRDTs.
    // If the client used to know that a task was part of a collection then it's
    // not a security threat to leave evidence of this.
    const filteredCollections = TaskCollectionSet.from(
        filterMapIterable(
            await runAllPromises(
                mapIterable(task.collections.raw.collections.actualEntries(), entry =>
                    isCollectionAccessAuthorized(entry[0]).then(isAuthorized =>
                        isAuthorized ? entry : undefined,
                    ),
                ),
            ),
            entry => entry,
        ),
    );

    return new TaskModel({
        id: task.id,
        spaceId: task.spaceId,

        // Hide the task creator for accounts that don't have space authorization.
        // It won't be visible to users without space access.
        creator: isSpaceAccessAuthorized ? task.creator : unknownTaskSortableAccount.get(),
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
        //
        // NOTE(calebmer, 2025-01-29): To fix this we could follow a similar path to
        // collections. By emitting an `UpdateParentTask` action if a collection policy
        // attached to an unauthorized parent task makes the task authorized.
        parent: {
            taskId: task.parent.taskId,
            position: task.parent.rawPosition,
        },
        addedChildTaskCount: task.addedChildTaskCount,
        removedChildTaskCount: task.removedChildTaskCount,
        addedClosedChildTaskCount: task.addedClosedChildTaskCount,
        removedClosedChildTaskCount: task.removedClosedChildTaskCount,

        collections: filteredCollections,
        positionByCollectionId: TaskPositionByCollectionIdMap.from(
            filterIterable(task.collections.raw.positionById.actualEntries(), ([collectionId]) =>
                filteredCollections.has(collectionId),
            ),
        ),

        status: isSpaceAccessAuthorized
            ? task.status
            : new TaskStatusWithSortableAccountRegister(
                  task.status.value.type === "Closed"
                      ? {
                            type: "Closed",
                            // Hide the task closer for accounts that don't have space authorization.
                            // It won't be visible to users without space access.
                            closer: unknownTaskSortableAccount.get(),
                            closedTime: task.status.value.closedTime,
                        }
                      : task.status.value,
                  task.status.version,
              ),
        assignee: isSpaceAccessAuthorized
            ? task.assignee
            : new TaskAssigneeWithSortableAccountRegister(
                  task.assignee.value
                      ? {
                            assignedTime: task.assignee.value.assignedTime,
                            assignee: task.assignee.value.assignee,
                            // Hide the task assigner for accounts that don't have space authorization.
                            // It won't be visible to users without space access.
                            assigner: unknownTaskSortableAccount.get(),
                        }
                      : null,
                  task.assignee.version,
              ),
        assigneeStatus: task.rawAssigneeStatus,
        // You are not allowed to see the active task position for other accounts. So
        // replace with a register you'd get on position reset from status, assignee,
        // or assignee status change. This effectively un-applies any actions you
        // aren't allowed to see.
        assigneePosition:
            task.rawAssigneePosition.value &&
            (actor.type === "System" ||
                ((actor.type === "Session" || actor.type === "ImpersonatedAccount") &&
                    task.rawAssigneePosition.value.accountId !== actor.getAccountId()))
                ? new TaskAssigneePositionRegister(null, task.assignee.version)
                : task.rawAssigneePosition,

        title: new TaskTitleModel(task.title.raw),
        dueDate: task.dueDate,
        priority: task.priority,
    });
}
