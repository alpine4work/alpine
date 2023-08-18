import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {areUint8ArraysEqual} from "~/shared/helpers/binary/are_uint8_arrays_equal.js";
import {compareHybridLogicalTimes} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";

// TypeScript errors here when new task properties are added. If you add a
// new task property you should make sure to update
// `areTaskIndexDocsEqual()`.
assertEqualTypes<
    keyof TaskIndexDoc,
    | "id"
    | "spaceId"
    | "creator"
    | "createdTime"
    | "rawDeletedTime"
    | "rawUndeletedTime"
    | "parent"
    | "addedChildTaskCount"
    | "removedChildTaskCount"
    | "addedClosedChildTaskCount"
    | "removedClosedChildTaskCount"
    | "collections"
    | "notepadPages"
    | "status"
    | "assignee"
    | "rawAssigneeStatus"
    | "title"
    | "dueDate"
    | "priority"
>();

assertEqualTypes<keyof TaskIndexDoc["parent"], "taskId" | "position">();
assertEqualTypes<keyof TaskIndexDoc["collections"], "raw">();
assertEqualTypes<keyof TaskIndexDoc["collections"]["raw"], "collections" | "positionById">();
assertEqualTypes<keyof TaskIndexDoc["notepadPages"], "raw">();
assertEqualTypes<keyof TaskIndexDoc["notepadPages"]["raw"], "positionById">();
assertEqualTypes<keyof TaskIndexDoc["title"], "raw">();

/**
 * Checks if two `TaskIndexDoc`s are equal to each other.
 */
export function areTaskIndexDocsEqual(task1: TaskIndexDoc, task2: TaskIndexDoc): boolean {
    // Optimization: Check if the two objects are referentially equal first...
    if (task1 === task2) return true;

    return (
        task1.id === task2.id &&
        task1.spaceId === task2.spaceId &&
        task1.creator.isEqual(task2.creator) &&
        task1.createdTime.isEqual(task2.createdTime) &&
        (task1.rawDeletedTime === task2.rawDeletedTime ||
            (task1.rawDeletedTime !== null &&
                task2.rawDeletedTime !== null &&
                compareHybridLogicalTimes(task1.rawDeletedTime, task2.rawDeletedTime) === 0)) &&
        (task1.rawUndeletedTime === task2.rawUndeletedTime ||
            (task1.rawUndeletedTime !== null &&
                task2.rawUndeletedTime !== null &&
                compareHybridLogicalTimes(task1.rawUndeletedTime, task2.rawUndeletedTime) === 0)) &&
        task1.parent.taskId.isEqual(task2.parent.taskId) &&
        task1.parent.position.isEqual(task2.parent.position) &&
        task1.addedChildTaskCount === task2.addedChildTaskCount &&
        task1.removedChildTaskCount === task2.removedChildTaskCount &&
        task1.addedClosedChildTaskCount === task2.addedClosedChildTaskCount &&
        task1.removedClosedChildTaskCount === task2.removedClosedChildTaskCount &&
        task1.collections.raw.collections.isEqual(task2.collections.raw.collections) &&
        task1.collections.raw.positionById.isEqual(task2.collections.raw.positionById) &&
        task1.notepadPages.raw.positionById.isEqual(task2.notepadPages.raw.positionById) &&
        task1.status.isEqual(task2.status) &&
        task1.assignee.isEqual(task2.assignee) &&
        task1.rawAssigneeStatus.isEqual(task2.rawAssigneeStatus) &&
        areUint8ArraysEqual(task1.title.raw, task2.title.raw) &&
        task1.dueDate.isEqual(task2.dueDate) &&
        task1.priority.isEqual(task2.priority)
    );
}
