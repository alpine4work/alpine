import {
    TaskAssigneeAccountIdRegister,
    TaskCollectionEssentialAttributesItemBase,
    TaskEssentialAttributesItemBase,
    TaskStatusTypeRegister,
} from "~/server/tasks/data/internal/task_table.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc, isTaskIndexDocDeleted} from "~/server/tasks/data/task_index_doc.js";

export function convertTaskIndexDocToItem(task: TaskIndexDoc): TaskEssentialAttributesItemBase {
    return {
        partitionType: "Task",
        sortRangeType: "EssentialAttributes",
        taskId: task.id,
        spaceId: task.spaceId,
        creatorId: task.creator.accountId,
        creatorFrom: task.creator.from,
        createdTime: task.createdTime.absoluteTime,
        deletedTime: isTaskIndexDocDeleted(task) ? task.rawDeletedTime : null,
        statusType: new TaskStatusTypeRegister(task.status.value.type, task.status.version),
        parentTaskId: task.parent.taskId,
        addedChildTaskCount: task.addedChildTaskCount,
        removedChildTaskCount: task.removedChildTaskCount,
        addedClosedChildTaskCount: task.addedClosedChildTaskCount,
        removedClosedChildTaskCount: task.removedClosedChildTaskCount,
        collections: task.collections.raw.collections,
        assigneeId: new TaskAssigneeAccountIdRegister(
            task.assignee.value?.assignee.accountId ?? null,
            task.assignee.version,
        ),
        layout: task.layout,
        accessPolicy: task.accessPolicy,
    };
}

/**
 * If you have a `TaskCollectionIndexDoc` then you have all the data that's in a
 * `TaskCollectionEssentialAttributesItem`. This function converts between the two
 * formats.
 *
 * Be careful when using this function! See the disclaimer on
 * `convertTaskIndexDocToItem()`.
 */
export function convertTaskCollectionIndexDocToItem(
    collection: TaskCollectionIndexDoc,
): TaskCollectionEssentialAttributesItemBase {
    return {
        partitionType: "TaskCollection",
        sortRangeType: "EssentialAttributes",
        collectionId: collection.id,
        spaceId: collection.spaceId,
        createdTime: collection.createdTime,
        creatorId: collection.creatorId,
        creatorFrom: collection.creatorFrom,
        rawDeletedTime: collection.rawDeletedTime,
        rawUndeletedTime: collection.rawUndeletedTime,
        name: collection.name,
        color: collection.color,
        accessPolicy: collection.accessPolicy,
        defaults: collection.defaults,
    };
}
