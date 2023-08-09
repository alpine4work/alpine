import {mergeTaskIndexDocs} from "~/server/tasks/index/merge_task_index_docs.js";
import {
    TaskIndexDoc,
    TaskPositionByAccountIdAndNotepadPageId,
    TaskPositionByCollectionIdMap,
} from "~/server/tasks/index/task_index_doc.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    TaskDueDateRegister,
    TaskParentTaskIdRegister,
} from "~/shared/tasks/actions/task_task_action.js";
import {TaskAssigneeRegister} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneeStatusRegister} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPositionRegister} from "~/shared/tasks/task_position.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatusRegister} from "~/shared/tasks/task_status.js";
import {emptyTaskTitle} from "~/shared/tasks/task_title.js";

function createEmptyTaskIndexDoc({
    spaceId,
    creator,
    createdTime,
}: {
    spaceId: SpaceId;
    creator: TaskSortableAccount;
    createdTime: HybridLogicalTime;
}): TaskIndexDoc {
    return {
        spaceId,
        creator,
        createdTime: TaskFilterableTime.test(createdTime),
        rawDeletedTime: null,
        rawUndeletedTime: null,
        parent: {
            taskId: new TaskParentTaskIdRegister(null, createdTime),
            position: new TaskPositionRegister(
                {orderTime: createdTime, orderKey: initialOrderKey},
                createdTime,
            ),
        },
        addedChildTaskCount: 0,
        removedChildTaskCount: 0,
        addedClosedChildTaskCount: 0,
        removedClosedChildTaskCount: 0,
        collections: {
            raw: {
                collections: TaskCollectionSet.empty,
                positionById: TaskPositionByCollectionIdMap.empty,
            },
        },
        notepadPages: {
            raw: {
                positionById: TaskPositionByAccountIdAndNotepadPageId.empty,
            },
        },
        status: new TaskStatusRegister({type: "Open"}, createdTime),
        assignee: new TaskAssigneeRegister(null, createdTime),
        rawAssigneeStatus: new TaskAssigneeStatusRegister({type: "Inactive"}, createdTime),
        title: {raw: emptyTaskTitle.get()},
        dueDate: new TaskDueDateRegister(null, createdTime),
        priority: new TaskPriorityRegister(null, createdTime),
    };
}

test("merging identical tasks returns a referentially equal value to the first one", () => {
    const spaceId = generateId<SpaceId>();
    const creator = new TaskSortableAccount({accountId: generateId(), workingAccountName: "Test"});
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    const task1 = createEmptyTaskIndexDoc({spaceId, creator, createdTime});
    const task2 = createEmptyTaskIndexDoc({spaceId, creator, createdTime});

    expect(mergeTaskIndexDocs(task1, task2)).toBe(task1);
    expect(mergeTaskIndexDocs(task1, task2)).not.toBe(task2);
    expect(mergeTaskIndexDocs(task2, task1)).toBe(task2);
    expect(mergeTaskIndexDocs(task2, task1)).not.toBe(task1);
});

test("merging tasks returns a referentially equal value to the first one if the first task didn't change", () => {
    const spaceId = generateId<SpaceId>();
    const creator = new TaskSortableAccount({accountId: generateId(), workingAccountName: "Test"});
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    const task1a = createEmptyTaskIndexDoc({spaceId, creator, createdTime});
    const task2 = createEmptyTaskIndexDoc({spaceId, creator, createdTime});

    const task1b = {
        ...task1a,
        priority: new TaskPriorityRegister("High", [createdTime[0], 1]),
    };

    expect(mergeTaskIndexDocs(task1b, task2)).toBe(task1b);
    expect(mergeTaskIndexDocs(task1b, task2)).not.toBe(task2);
    expect(mergeTaskIndexDocs(task2, task1b)).not.toBe(task2);
    expect(mergeTaskIndexDocs(task2, task1b)).not.toBe(task1b);
    expect(mergeTaskIndexDocs(task2, task1b)).toEqual(task1b);
});
