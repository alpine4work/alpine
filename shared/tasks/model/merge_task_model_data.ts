import {InternalError} from "~/shared/error/error.js";
import {maxHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {TaskModelData} from "~/shared/tasks/model/task_model.js";
import {mergeTaskSortableAccounts} from "~/shared/tasks/task_sortable_account.js";

/**
 * Merge two tasks together. Tasks are CRDTs and this is the CRDT merge function.
 * So this function is commutative and idempotent.
 *
 * If the returned task is identical to `task1` then we return `task1` so
 * optimizations can detect the task didn't change.
 */
export function mergeTaskModelData(task1: TaskModelData, task2: TaskModelData): TaskModelData {
    if (task1.id !== task2.id)
        throw new InternalError("Can only merge tasks with the same `TaskId`");

    if (task1.spaceId !== task2.spaceId)
        throw new InternalError("Incompatible task `spaceId` when merging");

    if (task1.creator.accountId !== task2.creator.accountId)
        throw new InternalError("Incompatible task `creator` when merging");

    if (!task1.createdTime.isEqual(task2.createdTime))
        throw new InternalError("Incompatible task `createdTime` when merging");

    const newTask: TaskModelData = {
        id: task1.id,
        spaceId: task1.spaceId,

        creator: mergeTaskSortableAccounts(task1.creator, task2.creator),
        createdTime: task1.createdTime,
        deletedTime:
            task1.deletedTime !== null && task2.deletedTime !== null
                ? maxHybridLogicalTime(task1.deletedTime, task2.deletedTime)
                : (task1.deletedTime ?? task2.deletedTime),
        undeletedTime:
            task1.undeletedTime !== null && task2.undeletedTime !== null
                ? maxHybridLogicalTime(task1.undeletedTime, task2.undeletedTime)
                : (task1.undeletedTime ?? task2.undeletedTime),

        parent: {
            taskId: task1.parent.taskId.merge(task2.parent.taskId),
            position: task1.parent.position.merge(task2.parent.position),
        },

        addedChildTaskCount: Math.max(task1.addedChildTaskCount, task2.addedChildTaskCount),
        removedChildTaskCount: Math.max(task1.removedChildTaskCount, task2.removedChildTaskCount),
        addedClosedChildTaskCount: Math.max(
            task1.addedClosedChildTaskCount,
            task2.addedClosedChildTaskCount,
        ),
        removedClosedChildTaskCount: Math.max(
            task1.removedClosedChildTaskCount,
            task2.removedClosedChildTaskCount,
        ),

        accessPolicy:
            task1.accessPolicy && task2.accessPolicy
                ? task1.accessPolicy.merge(task2.accessPolicy)
                : (task1.accessPolicy ?? task2.accessPolicy),
        collections: task1.collections.merge(task2.collections),
        positionByCollectionId: task1.positionByCollectionId.merge(task2.positionByCollectionId),

        status: task1.status.merge(task2.status),
        assignee: task1.assignee.merge(task2.assignee),
        assigneeStatus: task1.assigneeStatus.merge(task2.assigneeStatus),
        assigneePosition: task1.assigneePosition.merge(task2.assigneePosition),

        title: task1.title.isEqual(task2.title) ? task1.title : task1.title.apply(task2.title),
        dueDate: task1.dueDate.merge(task2.dueDate),
        priority: task1.priority.merge(task2.priority),
        layout:
            task1.layout && task2.layout
                ? task1.layout.merge(task2.layout)
                : (task1.layout ?? task2.layout),
    };

    // Optimization: If nothing changed between `task1` and the merged task then return
    // `task1` so the new task is referentially equal to the old one.
    if (isDeepEqual(task1, newTask)) return task1;

    return newTask;
}
