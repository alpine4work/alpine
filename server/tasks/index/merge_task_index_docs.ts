import {TaskIndexDoc} from "~/server/tasks/index/task_index_doc.js";
import {InternalError} from "~/shared/error/error.js";
import {areUint8ArraysEqual} from "~/shared/helpers/binary/are_uint8_arrays_equal.js";
import {maxHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {mergeTaskTitles} from "~/shared/tasks/task_title.js";

/**
 * Merges two tasks together. Because tasks CRDTs we will always converge to
 * the latest document when merging. This function is commutative and
 * idempotent.
 *
 * If the new task is identical to the task we're passing in then we return the
 * same task so you can check referential equality to see if anything changed.
 * This optimization is not commutative since only the first task may be
 * preserved considered.
 *
 * The two tasks must be the same `TaskId`. If you merge two tasks that aren't
 * the same `TaskId` we'll throw an error since fields like the task created
 * time won't be the same.
 */
export function mergeTaskIndexDocs(task1: TaskIndexDoc, task2: TaskIndexDoc): TaskIndexDoc {
    if (task1.spaceId !== task2.spaceId) {
        throw new InternalError("Task `spaceId` should never change");
    }
    if (!task1.creator.isEqual(task2.creator)) {
        throw new InternalError("Task `creator` should never change");
    }
    if (!task1.createdTime.isEqual(task2.createdTime)) {
        throw new InternalError("Task `createdTime` should never change");
    }

    const newTask: TaskIndexDoc = {
        spaceId: task1.spaceId,
        creator: task1.creator,
        createdTime: task1.createdTime,
        rawDeletedTime:
            task1.rawDeletedTime === null
                ? task2.rawDeletedTime
                : task2.rawDeletedTime === null
                ? task1.rawDeletedTime
                : maxHybridLogicalTime(task1.rawDeletedTime, task2.rawDeletedTime),
        rawUndeletedTime:
            task1.rawUndeletedTime === null
                ? task2.rawUndeletedTime
                : task2.rawUndeletedTime === null
                ? task1.rawUndeletedTime
                : maxHybridLogicalTime(task1.rawUndeletedTime, task2.rawUndeletedTime),
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
        collections: {
            raw: {
                collections: task1.collections.raw.collections.merge(
                    task2.collections.raw.collections,
                ),
                positionById: task1.collections.raw.positionById.merge(
                    task2.collections.raw.positionById,
                ),
            },
        },
        notepadPages: {
            raw: {
                positionById: task1.notepadPages.raw.positionById.merge(
                    task2.notepadPages.raw.positionById,
                ),
            },
        },
        status: task1.status.merge(task2.status),
        assignee: task1.assignee.merge(task2.assignee),
        rawAssigneeStatus: task1.rawAssigneeStatus.merge(task2.rawAssigneeStatus),
        title: {
            // Return a referentially equal title if the titles are equal. This will matter
            // when we check whether the whole task is unchanged.
            raw: areUint8ArraysEqual(task1.title.raw, task2.title.raw)
                ? task1.title.raw
                : mergeTaskTitles(task1.title.raw, task2.title.raw),
        },
        dueDate: task1.dueDate.merge(task2.dueDate),
        priority: task1.priority.merge(task2.priority),
    };

    // If our new task is deeply equal to the old task then return the old task so
    // we can efficiently see whether the task has changed or not.
    //
    // Deep equality checks referential identity for anything that's not a plain
    // object.
    if (isDeepEqual(task1, newTask)) return task1;

    return newTask;
}
