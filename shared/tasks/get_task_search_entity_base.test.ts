import {assert} from "~/shared/helpers/control/assert.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {
    TaskDueDateRegister,
    TaskParentTaskIdRegister,
} from "~/shared/tasks/actions/task_task_action.js";
import {getTaskSearchEntityBase} from "~/shared/tasks/get_task_search_entity_base.js";
import {TaskModel, TaskModelData} from "~/shared/tasks/model/task_model.js";
import {
    TaskAssigneeWithSortableAccount,
    TaskAssigneeWithSortableAccountRegister,
} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneePositionRegister} from "~/shared/tasks/task_assignee_position.js";
import {
    TaskAssigneeStatus,
    TaskAssigneeStatusRegister,
} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPositionRegister} from "~/shared/tasks/task_position.js";
import {TaskPositionByCollectionIdMap} from "~/shared/tasks/task_position_by_collection_id_map.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
import {TaskStatusWithSortableAccountRegister} from "~/shared/tasks/task_status.js";
import {
    TaskTitleModel,
    addFallbackToTaskTitle,
    createTaskTitleFromText,
} from "~/shared/tasks/title/task_title.js";

function makeRawData({
    title = "Test Task",
    status = {type: "Open"},
    statusVersion = [1, 0],
    assignee = null,
    assigneeStatus = {type: "Inactive"},
    assigneeStatusVersion = [2, 0],
    deletedTime = null,
    undeletedTime = null,
}: Partial<{
    title: string;
    status: any;
    statusVersion: [number, number];
    assignee: TaskAssigneeWithSortableAccount | null;
    assigneeStatus: TaskAssigneeStatus;
    assigneeStatusVersion: [number, number];
    deletedTime: [number, number] | null;
    undeletedTime: [number, number] | null;
}> = {}): TaskModelData {
    const accountId = generateId<AccountId>();
    const createdTime = [0, 0] as [number, number];
    return {
        id: generateId<TaskId>(),
        spaceId: generateId<SpaceId>(),
        creator: {accountId, workingAccountName: "Test", workingAccountNameVersion: 0},
        createdTime: TaskFilterableTime.test(createdTime),
        deletedTime,
        undeletedTime,
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
        collections: TaskCollectionSet.empty,
        positionByCollectionId: TaskPositionByCollectionIdMap.empty,
        status: new TaskStatusWithSortableAccountRegister(status, statusVersion),
        assignee: new TaskAssigneeWithSortableAccountRegister(assignee, createdTime),
        assigneeStatus: new TaskAssigneeStatusRegister(assigneeStatus, assigneeStatusVersion),
        assigneePosition: new TaskAssigneePositionRegister(null, createdTime),
        title: new TaskTitleModel(createTaskTitleFromText(title)),
        dueDate: new TaskDueDateRegister(null, createdTime),
        priority: new TaskPriorityRegister(null, createdTime),
    };
}

test("returns correct base for a normal task", () => {
    const rawData = makeRawData();
    const task = new TaskModel(rawData);
    const result = getTaskSearchEntityBase(task);
    expect(result.title).toBe(addFallbackToTaskTitle(rawData.title.getText()));
    expect(result.titleVersion.type).toBe("TaskTitle");
    if (result.titleVersion.type === "TaskTitle") {
        expect(result.titleVersion.snapshot).toEqual(rawData.title.getSnapshot());
        expect(result.titleVersion.deletedTime).toBeUndefined();
    }
    expect(result.media).toEqual({
        type: "TaskDisplayStatus",
        displayStatus: "OpenInactive",
        version:
            rawData.status.version > rawData.assigneeStatus.version
                ? rawData.status.version
                : rawData.assigneeStatus.version,
    });
});

test("returns null title for deleted task", () => {
    const deletedTime: [number, number] = [10, 0];
    const rawData = makeRawData({deletedTime});
    const task = new TaskModel(rawData);
    expect(task.isDeleted()).toBe(true);
    const result = getTaskSearchEntityBase(task);
    expect(result.title).toBeNull();
    expect(result.titleVersion.type).toBe("TaskTitle");
    if (result.titleVersion.type === "TaskTitle") {
        expect(result.titleVersion.snapshot).toEqual(rawData.title.getSnapshot());
        expect(result.titleVersion.deletedTime).toEqual(deletedTime);
    }
});

test("title uses fallback for empty or whitespace title", () => {
    for (const empty of ["", "   ", "\n\t"]) {
        const rawData = makeRawData({title: empty});
        const task = new TaskModel(rawData);
        const result = getTaskSearchEntityBase(task);
        expect(result.title).toBe("Untitled");
    }
});

test("`titleVersion.deletedTime` is max of `deletedTime` and `undeletedTime` if present", () => {
    const deletedTime: [number, number] = [10, 0];
    const undeletedTime: [number, number] = [20, 0];
    const rawData = makeRawData({deletedTime, undeletedTime});
    const task = new TaskModel(rawData);
    const result = getTaskSearchEntityBase(task);
    expect(result.titleVersion.type).toBe("TaskTitle");
    if (result.titleVersion.type === "TaskTitle") {
        expect(result.titleVersion.snapshot).toEqual(rawData.title.getSnapshot());
        expect(result.titleVersion.deletedTime).toEqual(undeletedTime);
    }
});

test("`titleVersion.deletedTime` is undefined if neither `deletedTime` nor `undeletedTime`", () => {
    const rawData = makeRawData({deletedTime: null, undeletedTime: null});
    const task = new TaskModel(rawData);
    const result = getTaskSearchEntityBase(task);
    expect(result.titleVersion.type).toBe("TaskTitle");
    if (result.titleVersion.type === "TaskTitle") {
        expect(result.titleVersion.snapshot).toEqual(rawData.title.getSnapshot());
        expect(result.titleVersion.deletedTime).toBeUndefined();
    }
});

test("`media.displayStatus` and version reflect `status` and `assigneeStatus`", () => {
    const statusVersion: [number, number] = [5, 0];
    const assigneeStatusVersion: [number, number] = [2, 0];
    const rawData = makeRawData({
        status: {type: "Open"},
        statusVersion,
        assignee: {
            assignee: {
                accountId: generateId(),
                workingAccountName: "Bob",
                workingAccountNameVersion: 0,
            },
            assigner: {
                accountId: generateId(),
                workingAccountName: "Alice",
                workingAccountNameVersion: 0,
            },
            assignedTime: TaskFilterableTime.test([1, 0]),
        },
        assigneeStatus: {type: "Active", activatedTime: TaskFilterableTime.test([1, 0])},
        assigneeStatusVersion,
    });
    const task = new TaskModel(rawData);
    const result = getTaskSearchEntityBase(task);
    expect(result.media.displayStatus).toBe("OpenActive");
    expect(result.media.version).toEqual(statusVersion);
});

test("`media.version` is max of `status.version` and `assigneeStatus.version`", () => {
    const statusVersion: [number, number] = [1, 0];
    const assigneeStatusVersion: [number, number] = [7, 0];
    const rawData = makeRawData({
        statusVersion,
        assignee: {
            assignee: {
                accountId: generateId(),
                workingAccountName: "Bob",
                workingAccountNameVersion: 0,
            },
            assigner: {
                accountId: generateId(),
                workingAccountName: "Alice",
                workingAccountNameVersion: 0,
            },
            assignedTime: TaskFilterableTime.test([1, 0]),
        },
        assigneeStatus: {type: "Active", activatedTime: TaskFilterableTime.test([1, 0])},
        assigneeStatusVersion,
    });
    const task = new TaskModel(rawData);
    const result = getTaskSearchEntityBase(task);
    expect(result.media.displayStatus).toBe("OpenActive");
    expect(result.media.version).toEqual(assigneeStatusVersion);
});

test("`isDeleted` is false if `undeletedTime` > `deletedTime`", () => {
    const deletedTime: [number, number] = [10, 0];
    const undeletedTime: [number, number] = [20, 0];
    const rawData = makeRawData({deletedTime, undeletedTime});
    const task = new TaskModel(rawData);
    expect(task.isDeleted()).toBe(false);
    const result = getTaskSearchEntityBase(task);
    expect(result.title).not.toBeNull();
    expect(result.titleVersion.type).toBe("TaskTitle");
    assert(result.titleVersion.type === "TaskTitle");
    expect(result.titleVersion.snapshot).toEqual(rawData.title.getSnapshot());
    expect(result.titleVersion.deletedTime).toEqual(undeletedTime);
});

test("`isDeleted` is true if `deletedTime` > `undeletedTime`", () => {
    const deletedTime: [number, number] = [30, 0];
    const undeletedTime: [number, number] = [20, 0];
    const rawData = makeRawData({deletedTime, undeletedTime});
    const task = new TaskModel(rawData);
    expect(task.isDeleted()).toBe(true);
    const result = getTaskSearchEntityBase(task);
    expect(result.title).toBeNull();
    expect(result.titleVersion.type).toBe("TaskTitle");
    assert(result.titleVersion.type === "TaskTitle");
    expect(result.titleVersion.snapshot).toEqual(rawData.title.getSnapshot());
    expect(result.titleVersion.deletedTime).toEqual(deletedTime);
});

test("works with only `undeletedTime` set (not deleted)", () => {
    const undeletedTime: [number, number] = [15, 0];
    const rawData = makeRawData({undeletedTime});
    const task = new TaskModel(rawData);
    expect(task.isDeleted()).toBe(false);
    const result = getTaskSearchEntityBase(task);
    expect(result.title).not.toBeNull();
    expect(result.titleVersion.type).toBe("TaskTitle");
    assert(result.titleVersion.type === "TaskTitle");
    expect(result.titleVersion.snapshot).toEqual(rawData.title.getSnapshot());
    expect(result.titleVersion.deletedTime).toEqual(undeletedTime);
});

test("works with only `deletedTime` set (is deleted)", () => {
    const deletedTime: [number, number] = [15, 0];
    const rawData = makeRawData({deletedTime});
    const task = new TaskModel(rawData);
    expect(task.isDeleted()).toBe(true);
    const result = getTaskSearchEntityBase(task);
    expect(result.title).toBeNull();
    expect(result.titleVersion.type).toBe("TaskTitle");
    assert(result.titleVersion.type === "TaskTitle");
    expect(result.titleVersion.snapshot).toEqual(rawData.title.getSnapshot());
    expect(result.titleVersion.deletedTime).toEqual(deletedTime);
});
