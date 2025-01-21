import {TaskIndexDocBase} from "~/server/tasks/data/task_index_doc.js";
import {TaskAuthorizationActor} from "~/server/tasks/data/task_table.js";
import {maxHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
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
 *
 * If null is passed in for `actorAccountId` we wipe all potentially private
 * data from the task as a safety precaution. This may not be what you want if
 * you're using a system context.
 */
export function prepareTaskForClient(
    actor: TaskAuthorizationActor,
    task: TaskIndexDocBase & {id: TaskId},
): TaskModel {
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
            filterIterable(
                task.notepadPages.raw.positionById.actualEntries(),
                ([key]) =>
                    actor.type === "System" ||
                    (actor.type === "Session" && key.startsWith(actor.getAccountId())),
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
            (actor.type === "System" ||
                (actor.type === "Session" &&
                    task.rawAssigneeActivePosition.value.accountId !== actor.getAccountId()))
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
